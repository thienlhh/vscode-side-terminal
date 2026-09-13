import * as vscode from 'vscode';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

export interface TerminalConfig {
  cursorBlink: boolean;
  cursorStyle: 'block' | 'underline' | 'bar';
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  scrollback: number;
}

function configuration(section: string) {
  return vscode.workspace.getConfiguration(section, vscode.workspace.workspaceFolders?.[0]?.uri);
}

export function getTerminalConfig(): TerminalConfig {
  const side = configuration('secondaryTerminal');
  const native = configuration('terminal.integrated');
  const editor = configuration('editor');
  function value<T>(key: string, nativeKey: string, fallback: T): T {
    const inspected = side.inspect<T>(key);
    return inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue ?? native.get<T>(nativeKey, fallback);
  }
  function number(key: string, nativeKey: string, fallback: number, min: number, max: number) {
    const configured = value(key, nativeKey, fallback);
    return typeof configured === 'number' && Number.isFinite(configured) ? Math.min(max, Math.max(min, configured)) : fallback;
  }
  const style = value<string>('cursorStyle', 'cursorStyle', 'block');
  const family = value('fontFamily', 'fontFamily', editor.get<string>('fontFamily', 'monospace'));
  return {
    cursorBlink: value<boolean>('cursorBlink', 'cursorBlinking', false) === true,
    cursorStyle: style === 'underline' || style === 'bar' ? style : 'block',
    fontSize: number('fontSize', 'fontSize', editor.get<number>('fontSize', 14), 6, 100),
    fontFamily: typeof family === 'string' && family.trim() ? family : editor.get<string>('fontFamily', 'monospace'),
    lineHeight: number('lineHeight', 'lineHeight', 1, 1, 3),
    scrollback: Math.floor(number('scrollback', 'scrollback', 1000, 0, 100000))
  };
}

interface ShellProfile {
  path?: string | string[];
  source?: string;
  args?: string[];
  env?: Record<string, string | null>;
}

export function getShellLaunchOptions(): { shell: string; args: string[]; cwd: string; env: Record<string, string> } {
  const platform = os.platform();
  const platformKey = platform === 'darwin' ? 'osx' : platform === 'win32' ? 'windows' : 'linux';
  const native = configuration('terminal.integrated');
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const home = os.homedir();
  function expand(value: string): string {
    return value.replace(/\$\{([^}]+)\}/g, (_match, variable: string) => {
      if (variable === 'workspaceFolder') {
        if (workspace) return workspace;
        throw new Error('Cannot resolve ${workspaceFolder}: no workspace folder is open.');
      }
      if (variable === 'userHome') return home;
      if (variable.startsWith('env:')) return process.env[variable.slice(4)] ?? '';
      throw new Error(`Unsupported terminal profile variable: ${variable}. Use an explicit path or an environment variable.`);
    });
  }
  function resolveExecutable(executable: string): string | undefined {
    if (path.isAbsolute(executable) || executable.includes('/') || executable.includes('\\')) {
      return fs.existsSync(executable) ? executable : undefined;
    }
    const pathValue = process.env.PATH ?? process.env.Path ?? '';
    const extensions = platform === 'win32' && !path.extname(executable) ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
    for (const directory of pathValue.split(platform === 'win32' ? ';' : ':').filter(Boolean)) {
      for (const extension of extensions) {
        const candidate = path.join(directory, `${executable}${extension}`);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    return undefined;
  }
  const profileName = native.get<string | null>(`defaultProfile.${platformKey}`, null);
  const profiles = native.get<Record<string, ShellProfile | null>>(`profiles.${platformKey}`, {}) ?? {};
  const profile = profileName ? profiles?.[profileName] : undefined;
  let candidates: string[];
  if (profile?.path) {
    candidates = (Array.isArray(profile.path) ? profile.path : [profile.path]).map(expand);
  } else if (platform === 'win32') {
    const source = profile?.source ?? profileName ?? 'PowerShell';
    if (/^(powershell|pwsh)$/i.test(source)) candidates = ['pwsh.exe', 'powershell.exe'];
    else if (/^command prompt$|^cmd$/i.test(source)) candidates = [process.env.COMSPEC ?? 'cmd.exe'];
    else if (/^git bash$/i.test(source)) candidates = [path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe')];
    else throw new Error(`Terminal profile "${source}" needs an explicit executable path for Side Terminal.`);
  } else if (profileName) {
    if (!/^(bash|zsh|fish|sh|dash|ksh|pwsh)$/i.test(profileName)) throw new Error(`Terminal profile "${profileName}" needs an explicit executable path for Side Terminal.`);
    candidates = [profileName];
  } else {
    let systemShell: string | null = null;
    try { systemShell = os.userInfo().shell; } catch { /* Use platform defaults below. */ }
    candidates = [process.env.SHELL, systemShell, platform === 'darwin' ? '/bin/zsh' : '/bin/bash', '/bin/sh'].filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  }
  const shell = candidates.map(resolveExecutable).find((candidate): candidate is string => candidate !== undefined);
  if (!shell) throw new Error(`Cannot find terminal shell: ${candidates.join(', ')}. Configure terminal.integrated.profiles.${platformKey} with an installed executable.`);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (typeof value === 'string') env[key] = value;
  function applyEnvironment(values: Record<string, string | null> | null | undefined) {
    if (!values || typeof values !== 'object') return;
    for (const [key, value] of Object.entries(values)) {
      if (platform === 'win32') {
        for (const existing of Object.keys(env)) {
          if (existing.toLowerCase() === key.toLowerCase()) {
            delete env[existing];
          }
        }
      }
      if (value === null) {
        delete env[key];
      } else if (typeof value === 'string') {
        env[key] = expand(value);
      } else {
        throw new Error(`Invalid environment value for ${key}.`);
      }
    }
  }
  applyEnvironment(native.get<Record<string, string | null>>(`env.${platformKey}`, {}));
  applyEnvironment(profile?.env ?? {});
  delete env.ELECTRON_RUN_AS_NODE;
  env.TERM_PROGRAM = 'vscode';
  env.TERM_PROGRAM_VERSION = vscode.version;
  env.COLORTERM ??= 'truecolor';
  const configuredArgs = profile?.args;
  if (configuredArgs && (!Array.isArray(configuredArgs) || !configuredArgs.every(arg => typeof arg === 'string'))) throw new Error('Terminal profile args must be an array of strings.');
  const args = configuredArgs ? configuredArgs.map(expand) : platform === 'darwin' && /^(bash|zsh|sh|fish|ksh)$/.test(path.basename(shell)) ? ['-l'] : [];
  const configuredCwd = native.get<string>('cwd', '');
  const cwd = configuredCwd ? path.resolve(workspace ?? home, expand(configuredCwd)) : workspace ?? home;
  return { shell, args, cwd, env };
}
