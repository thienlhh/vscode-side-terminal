const assert = require('node:assert/strict');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { test } = require('node:test');

const serialTest = (name, fn) => test(name, { concurrency: false }, fn);

function disposable(fn) {
  return { dispose: fn };
}

function emitter() {
  const listeners = new Set();
  return {
    on(listener) {
      listeners.add(listener);
      return disposable(() => listeners.delete(listener));
    },
    fire(value) {
      for (const listener of [...listeners]) listener(value);
    },
    get size() {
      return listeners.size;
    }
  };
}

class FakePty {
  constructor() {
    this.data = emitter();
    this.exit = emitter();
    this.pauseCount = 0;
    this.resumeCount = 0;
    this.killCount = 0;
    this.writes = [];
  }

  onData(listener) { return this.data.on(listener); }
  onExit(listener) { return this.exit.on(listener); }
  emitData(value) { this.data.fire(value); }
  write(value) { this.writes.push(value); }
  resize() {}
  pause() { this.pauseCount++; }
  resume() { this.resumeCount++; }
  kill() { this.killCount++; }
}

function createEnvironment() {
  const events = {
    open: emitter(),
    close: emitter(),
    theme: emitter(),
    config: emitter(),
    shell: emitter()
  };
  const state = {
    trusted: true,
    mirror: true,
    terminals: [],
    ptys: [],
    errors: [],
    warnings: [],
    copied: [],
    clipboardReads: 0,
    openedSchemes: [],
    openedDocuments: [],
    revealedRanges: [],
    executedCommands: []
  };
  const workspace = {
    get isTrusted() { return state.trusted; },
    workspaceFolders: [],
    openTextDocument(uri) {
      state.openedDocuments.push(uri.fsPath);
      return Promise.resolve({ uri });
    },
    findFiles(pattern) {
      if (pattern.includes('fallback.ts')) {
        return Promise.resolve([Uri.file('/workspace/nested/fallback.ts')]);
      }
      return Promise.resolve([]);
    },
    getConfiguration() {
      return {
        get(key, fallback) {
          if (key === 'mirrorAgentTerminals') return state.mirror;
          return fallback;
        },
        inspect() { return undefined; }
      };
    },
    onDidChangeConfiguration: events.config.on
  };
  const Uri = {
    file(value) { return { fsPath: value, toString: () => value }; },
    joinPath(base, ...parts) { return Uri.file(path.join(base.fsPath, ...parts)); },
    parse(value) { return { scheme: value.split(':', 1)[0] }; }
  };
  const vscode = {
    Disposable: class {},
    Uri,
    window: {
      terminals: state.terminals,
      onDidOpenTerminal: events.open.on,
      onDidCloseTerminal: events.close.on,
      onDidChangeActiveColorTheme: events.theme.on,
      onDidStartTerminalShellExecution: events.shell.on,
      showErrorMessage(message) { state.errors.push(message); return Promise.resolve(); },
      showWarningMessage(message) { state.warnings.push(message); return Promise.resolve(); },
      showTextDocument(doc, options) {
        return Promise.resolve({
          document: doc,
          selection: options?.selection,
          revealRange(range, type) { state.revealedRanges.push({ range, type }); }
        });
      },
      show() {}
    },
    workspace,
    commands: {
      executeCommand(command, ...args) {
        state.executedCommands.push({ command, args });
        return Promise.resolve();
      }
    },
    env: {
      openExternal(uri) { state.openedSchemes.push(uri.scheme); return Promise.resolve(true); },
      clipboard: {
        writeText(data) { state.copied.push(data); return Promise.resolve(); },
        readText() { state.clipboardReads++; return Promise.resolve('known clipboard text'); }
      }
    },
    version: '1.100.0',
    Position: class Position { constructor(line, character) { this.line = line; this.character = character; } },
    Range: class Range { constructor(start, end) { this.start = start; this.end = end; } },
    Selection: class Selection { constructor(start, end) { this.start = start; this.end = end; } },
    TextEditorRevealType: { InCenter: 0 }
  };
  const nodePty = {
    spawn() {
      const pty = new FakePty();
      state.ptys.push(pty);
      return pty;
    }
  };
  return { events, state, vscode, nodePty };
}

const bundle = buildSync({
  entryPoints: [path.resolve(__dirname, '..', '..', 'src/provider/terminalViewProvider.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  external: ['vscode', 'node-pty'],
  write: false,
  logLevel: 'silent'
});

function loadProvider(environment) {
  const module = { exports: {} };
  const localRequire = (request) => {
    if (request === 'vscode') return environment.vscode;
    if (request === 'node-pty') return environment.nodePty;
    return require(request);
  };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(localRequire, module, module.exports);
  return module.exports.TerminalViewProvider;
}

function createView() {
  let receive;
  let disposed;
  const messages = [];
  const webview = {
    options: {},
    html: '',
    cspSource: 'vscode-resource:',
    asWebviewUri(uri) { return uri; },
    onDidReceiveMessage(listener) { receive = listener; return disposable(() => { receive = undefined; }); },
    postMessage(message) { messages.push(message); return Promise.resolve(true); }
  };
  const view = {
    webview,
    visible: true,
    description: undefined,
    badge: undefined,
    show() {},
    onDidChangeVisibility() { return disposable(() => {}); },
    onDidDispose(listener) { disposed = listener; return disposable(() => { disposed = undefined; }); }
  };
  return {
    view,
    messages,
    send(message) { assert.ok(receive, 'webview message listener is registered'); receive(message); },
    hasListener() { return !!receive; },
    dispose() { disposed?.(); }
  };
}

function setup() {
  const environment = createEnvironment();
  const TerminalViewProvider = loadProvider(environment);
  const provider = new TerminalViewProvider(environment.vscode.Uri.file('/extension'));
  const firstView = createView();
  provider.resolveWebviewView(firstView.view, {}, {});
  return { environment, provider, firstView, TerminalViewProvider };
}

function tabId(messages, isAgent) {
  const message = [...messages].reverse().find((item) => item.type === 'addTab' && item.isAgent === isAgent);
  return message?.id;
}

serialTest('registers global listeners once and disposes them across view recreation', () => {
  const { environment, provider, firstView } = setup();
  assert.equal(environment.events.open.size, 1);
  assert.equal(environment.events.close.size, 1);
  assert.equal(environment.events.config.size, 1);
  const secondView = createView();
  provider.resolveWebviewView(secondView.view, {}, {});
  assert.equal(environment.events.open.size, 1);
  assert.equal(environment.events.close.size, 1);
  assert.equal(firstView.hasListener(), false);
  secondView.send({ type: 'ready' });
  secondView.send({ type: 'ready' });
  assert.equal(environment.state.ptys.length, 1, 'duplicate ready must not create another shell');
  provider.dispose();
  assert.equal(environment.events.open.size, 0);
  assert.equal(environment.events.close.size, 0);
  assert.equal(environment.state.ptys[0].killCount, 1);
});

serialTest('keeps same-name agent terminals separate and closing a mirror does not dispose the source', () => {
  const { environment, provider, firstView } = setup();
  const first = { name: 'Codex', sendText() {}, show() {}, dispose() { this.disposed = true; } };
  const second = { name: 'Codex', sendText() {}, show() {}, dispose() { this.disposed = true; } };
  environment.state.terminals.push(first, second);
  firstView.send({ type: 'ready' });
  const ids = firstView.messages.filter((message) => message.type === 'addTab' && message.isAgent).map((message) => message.id);
  assert.deepEqual(ids, ['agent-1', 'agent-2']);
  firstView.send({ type: 'input', tabId: ids[0], data: 'secret' });
  assert.equal(first.sent, undefined, 'mirrored tabs are read-only');
  firstView.send({ type: 'closeTab', tabId: ids[0] });
  assert.equal(first.disposed, undefined);
  assert.equal(second.disposed, undefined);
  provider.dispose();
});

serialTest('rejects untrusted startup and malformed messages', () => {
  const { environment, provider, firstView } = setup();
  environment.state.trusted = false;
  firstView.send({ type: 'ready' });
  assert.equal(environment.state.ptys.length, 0);
  firstView.send({ type: 'input', tabId: 'term-1', data: 'x' });
  firstView.send({ type: 'resize', tabId: 'term-1', cols: 0, rows: 25 });
  firstView.send({ type: 'openUrl', url: 'x'.repeat(9000) });
  assert.equal(environment.state.ptys.length, 0);
  provider.dispose();
});

serialTest('clipboard actions require a registered tab and paste is restricted to local sessions', async () => {
  const { environment, provider, firstView } = setup();
  environment.state.terminals.push({ name: 'Codex', show() {} });
  firstView.send({ type: 'ready' });
  const id = tabId(firstView.messages, false);
  firstView.send({ type: 'copy', tabId: 'unknown', data: 'ignored' });
  firstView.send({ type: 'copy', tabId: id, data: 'selected output' });
  firstView.send({ type: 'paste', tabId: 'unknown' });
  firstView.send({ type: 'paste', tabId: 'agent-1' });
  firstView.send({ type: 'paste', tabId: id });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(environment.state.copied, ['selected output']);
  assert.equal(environment.state.clipboardReads, 1);
  assert.ok(firstView.messages.some(message => message.type === 'paste' && message.tabId === id && message.data === 'known clipboard text'));
  provider.dispose();
});

serialTest('external navigation permits HTTP/HTTPS and rejects command/file schemes', () => {
  const { environment, provider, firstView } = setup();
  firstView.send({ type: 'openUrl', url: 'https://example.invalid' });
  firstView.send({ type: 'openUrl', url: 'http://example.invalid' });
  firstView.send({ type: 'openUrl', url: 'command:workbench.action.files.newUntitledFile' });
  firstView.send({ type: 'openUrl', url: 'file:///private/file' });
  assert.deepEqual(environment.state.openedSchemes, ['https', 'http']);
  provider.dispose();
});

serialTest('resolves file links with coordinates, workspace fallback, and editor selection', async () => {
  const { environment, provider, firstView } = setup();
  // Existing workspace file
  firstView.send({ type: 'openFile', path: 'package.json', line: 10, col: 5 });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(environment.state.openedDocuments.some(doc => doc.endsWith('package.json')));
  assert.ok(environment.state.revealedRanges.length > 0);
  assert.equal(environment.state.revealedRanges[0].range.start.line, 9);
  assert.equal(environment.state.revealedRanges[0].range.start.character, 4);

  // Fallback search
  environment.vscode.workspace.workspaceFolders = [{ uri: environment.vscode.Uri.file('/workspace') }];
  firstView.send({ type: 'openFile', path: 'fallback.ts', line: 20 });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(environment.state.openedDocuments.some(doc => doc.endsWith('nested/fallback.ts')));

  // Unresolvable path
  firstView.send({ type: 'openFile', path: 'nonexistent-file-12345.xyz' });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(environment.state.warnings.some(w => w.includes('nonexistent-file-12345.xyz')));

  provider.dispose();
});

serialTest('stops forwarding an active mirror when mirroring is disabled', async () => {
  const { environment, provider, firstView } = setup();
  const agent = { name: 'Codex', sendText() {}, show() {} };
  environment.state.terminals.push(agent);
  firstView.send({ type: 'ready' });
  let release;
  let released = false;
  const gate = new Promise((resolve) => { release = resolve; });
  environment.events.shell.fire({
    terminal: agent,
    execution: {
      read() {
        return {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                await gate;
                return { value: 'must-not-forward', done: false };
              },
              async return() {
                released = true;
                return { value: undefined, done: true };
              }
            };
          }
        };
      }
    }
  });
  environment.state.mirror = false;
  environment.events.config.fire({ affectsConfiguration: (key) => key === 'secondaryTerminal.mirrorAgentTerminals' });
  assert.equal(released, true, 'the idle execution iterator must receive a close request before its next chunk arrives');
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(firstView.messages.some((message) => message.data === 'must-not-forward'), false);
  assert.equal(released, true, 'disabling mirroring must release the execution iterator');
  provider.dispose();
});

serialTest('restores bounded history and clears it without resurrecting output', async () => {
  const { environment, provider, firstView } = setup();
  firstView.send({ type: 'ready' });
  const pty = environment.state.ptys[0];
  pty.emitData('old output');
  await new Promise((resolve) => setTimeout(resolve, 20));
  const id = tabId(firstView.messages, false);
  const parsed = firstView.messages.find(message => message.type === 'data');
  firstView.send({ type: 'outputAck', tabId: id, seq: parsed.seq });
  firstView.dispose();
  const secondView = createView();
  provider.resolveWebviewView(secondView.view, {}, {});
  secondView.send({ type: 'ready' });
  const restore = secondView.messages.find((message) => message.type === 'restoreTabs');
  assert.ok(restore);
  assert.equal(restore.tabs.some((tab) => tab.snapshot?.includes('old output')), true, 'parsed output must be restored');
  secondView.send({ type: 'clearTab', tabId: id });
  secondView.dispose();
  const thirdView = createView();
  provider.resolveWebviewView(thirdView.view, {}, {});
  thirdView.send({ type: 'ready' });
  const cleared = thirdView.messages.find(message => message.type === 'restoreTabs');
  assert.equal(cleared.tabs.some(tab => tab.snapshot?.includes('old output')), false);
  provider.dispose();
});

serialTest('pauses noisy PTYs under output pressure and cleans them up on close', async () => {
  const { environment, provider, firstView } = setup();
  firstView.send({ type: 'ready' });
  const id = tabId(firstView.messages, false);
  const pty = environment.state.ptys[0];
  const initialResumeCount = pty.resumeCount;
  pty.emitData('x'.repeat(200 * 1024));
  assert.equal(pty.pauseCount, 1);
  await new Promise((resolve) => setTimeout(resolve, 25));
  for (let index = 0; index < firstView.messages.length; index++) {
    const message = firstView.messages[index];
    if (message.type === 'data') firstView.send({ type: 'outputAck', tabId: id, seq: message.seq });
  }
  assert.ok(pty.resumeCount > initialResumeCount, 'draining parsed output must resume the paused PTY');
  assert.equal(firstView.messages.filter(message => message.type === 'data').map(message => message.data).join('').length, 200 * 1024, 'owned PTY output must not be truncated under the queue limit');
  firstView.send({ type: 'closeTab', tabId: id });
  assert.equal(pty.killCount, 1);
  provider.dispose();
});
