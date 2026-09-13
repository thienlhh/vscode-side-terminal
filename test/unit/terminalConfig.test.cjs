const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

function load(values = {}, overrides = {}, platform = 'linux', environment = {}) {
  const code = esbuild.transformSync(fs.readFileSync(path.join(__dirname, '../../src/provider/terminalConfig.ts'), 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  const config = section => ({
    get(key, fallback) { return values[`${section}.${key}`] ?? fallback; },
    inspect(key) { return { defaultValue: 12, globalValue: overrides[key] }; }
  });
  const module = { exports: {} };
  const mockedOs = { platform: () => platform, homedir: () => '/home/user', userInfo: () => ({ shell: '/bin/bash' }) };
  vm.runInNewContext(code, {
    module, exports: module.exports, process: { env: environment },
    require(name) {
      if (name === 'vscode') return { workspace: { workspaceFolders: [{ uri: { fsPath: '/project' } }], getConfiguration: config }, version: '1.137.0' };
      if (name === 'os') return mockedOs;
      if (name === 'fs') return { existsSync: file => ['/bin/bash', '/bin/zsh', '/custom/shell', '/tools/pwsh.exe'].includes(file) };
      return require(name);
    }
  });
  return module.exports;
}

test('inherits native appearance unless a side-terminal setting is explicitly overridden', () => {
  const config = load({ 'terminal.integrated.fontSize': 17, 'terminal.integrated.cursorBlinking': false, 'terminal.integrated.scrollback': 1200 }).getTerminalConfig();
  assert.equal(config.fontSize, 17);
  assert.equal(config.cursorBlink, false);
  assert.equal(config.scrollback, 1200);
  assert.equal(load({ 'terminal.integrated.fontSize': 17 }, { fontSize: 14 }).getTerminalConfig().fontSize, 14);
});

test('bounds invalid appearance settings and handles native automatic line height', () => {
  const config = load({ 'terminal.integrated.lineHeight': 0 }, { scrollback: -4, fontSize: Infinity }).getTerminalConfig();
  assert.equal(config.lineHeight, 1);
  assert.ok(config.scrollback >= 0);
  assert.ok(Number.isFinite(config.fontSize));
});

test('launches configured profile with resolved args and layered environment deletions', () => {
  const options = load({
    'terminal.integrated.defaultProfile.linux': 'Custom',
    'terminal.integrated.profiles.linux': { Custom: { path: '/custom/shell', args: ['--config', '${workspaceFolder}/shell.rc'], env: { REMOVE: null, PROFILE: '${env:BASE}' } } },
    'terminal.integrated.env.linux': { KEEP: 'configured', REMOVE: 'configured' },
    'terminal.integrated.cwd': '${workspaceFolder}/subdir'
  }, {}, 'linux', { KEEP: 'inherited', REMOVE: 'inherited', BASE: 'value' }).getShellLaunchOptions();
  assert.equal(options.shell, '/custom/shell');
  assert.equal(JSON.stringify(options.args), JSON.stringify(['--config', '/project/shell.rc']));
  assert.equal(options.cwd, '/project/subdir');
  assert.equal(options.env.KEEP, 'configured');
  assert.equal(options.env.PROFILE, 'value');
  assert.equal(options.env.REMOVE, undefined);
});

test('uses a Linux system shell and rejects unsupported profile substitutions', () => {
  assert.equal(load().getShellLaunchOptions().shell, '/bin/bash');
  assert.throws(() => load({
    'terminal.integrated.defaultProfile.linux': 'Bad',
    'terminal.integrated.profiles.linux': { Bad: { path: '${command:runAnything}' } }
  }).getShellLaunchOptions(), /variable|substitution/i);
});

test('Windows profile environment overrides and deletions are case-insensitive', () => {
  const options = load({
    'terminal.integrated.defaultProfile.windows': 'Custom',
    'terminal.integrated.profiles.windows': { Custom: { path: '/tools/pwsh.exe', env: { path: 'profile', TOKEN: null } } },
    'terminal.integrated.env.windows': { Path: 'native' }
  }, {}, 'win32', { PATH: 'inherited', Token: 'secret' }).getShellLaunchOptions();
  assert.equal(options.env.path, 'profile');
  assert.equal(options.env.PATH, undefined);
  assert.equal(options.env.Path, undefined);
  assert.equal(options.env.Token, undefined);
  assert.equal(options.env.TOKEN, undefined);
});

test('explicit profile argument arrays are preserved and invalid arguments fail clearly', () => {
  const profile = { path: '/custom/shell', args: [] };
  const values = { 'terminal.integrated.defaultProfile.osx': 'Custom', 'terminal.integrated.profiles.osx': { Custom: profile } };
  assert.equal(load(values, {}, 'darwin').getShellLaunchOptions().args.length, 0);
  profile.args = [42];
  assert.throws(() => load(values, {}, 'darwin').getShellLaunchOptions(), /args/);
});

test('handles null profile and environment configurations safely', () => {
  const values = {
    'terminal.integrated.defaultProfile.linux': 'bash',
    'terminal.integrated.profiles.linux': null,
    'terminal.integrated.env.linux': null
  };
  const options = load(values, {}, 'linux', { PATH: '/bin' }).getShellLaunchOptions();
  assert.equal(options.shell, '/bin/bash');
});

