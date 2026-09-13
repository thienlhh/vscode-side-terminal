import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { COMMANDS } from '../constants';
import { OutputBuffer } from './outputBuffer';
import { getShellLaunchOptions, getTerminalConfig } from './terminalConfig';

let nodePty: typeof import('node-pty') | null | undefined;

function loadNodePty(): typeof import('node-pty') | null {
  if (nodePty !== undefined) return nodePty;
  try {
    nodePty = require('node-pty');
  } catch {
    nodePty = null;
  }
  return nodePty ?? null;
}

const MAX_INPUT_LENGTH = 64 * 1024;
const MAX_CLIPBOARD_LENGTH = 16 * 1024 * 1024;
const MAX_URL_LENGTH = 8 * 1024;
const MAX_PATH_LENGTH = 4 * 1024;
const MAX_TABS_RESTORED = 100;
const MAX_HISTORY_LENGTH = 64 * 1024;
const MAX_RESTORE_HISTORY = 512 * 1024;
const MAX_TERMINAL_COLS = 1000;
const MAX_TERMINAL_ROWS = 500;
const MAX_LINE_OR_COLUMN = 1_000_000;

/**
 * Determines if a terminal belongs to an AI agent rather than a standard user interactive shell.
 */
function isRecognizedAgentTerminal(term: vscode.Terminal): boolean {
  const name = term.name.toLowerCase().trim();
  const standardShells = new Set([
    'zsh',
    'bash',
    'sh',
    'fish',
    'pwsh',
    'powershell',
    'cmd',
    'tmux',
    'javascript debug terminal',
    'node',
    'python',
    'ruby',
    'git bash'
  ]);

  // Exclude standard user shells
  if (standardShells.has(name)) return false;

  // Only match recognized AI agents or task runners
  return /(?:^|\b)(?:cline|copilot|roo(?:\s*code)?|agent|antigravity|claude|codex|aider)(?:\b|$)/i.test(name);
}

interface LocalSession {
  id: string;
  title: string;
  tabNumber: number;
  ptyProcess: import('node-pty').IPty;
  history: string;
  dataSubscription?: { dispose(): void };
  exitSubscription?: { dispose(): void };
}

interface AgentSession {
  id: string;
  title: string;
  terminal: vscode.Terminal;
  history: string;
}

type WebviewMessage = Record<string, unknown>;

function isRecord(value: unknown): value is WebviewMessage {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

function isBoundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function appendHistory(history: string, data: string): string {
  return (history + data).slice(-MAX_HISTORY_LENGTH);
}

const fileExists = (filePath: string): Promise<boolean> => fs.promises.access(filePath).then(() => true, () => false);

export class TerminalViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'secondary-terminal.view';
  private _view?: vscode.WebviewView;
  private readonly _localSessions = new Map<string, LocalSession>();
  private readonly _agentSessions = new Map<string, AgentSession>();
  private readonly _agentIdsByTerminal = new Map<vscode.Terminal, string>();
  private readonly _hiddenAgentTerminals = new Set<vscode.Terminal>();
  private readonly _subscriptions: vscode.Disposable[] = [];
  private readonly _viewSubscriptions: vscode.Disposable[] = [];
  private readonly _outputBuffer: OutputBuffer;
  private _nextSessionNumber = 1;
  private _nextAgentNumber = 1;
  private _mirrorGeneration = 0;
  private _nextReaderId = 1;
  private readonly _activeReaders = new Map<number, { tabId: string; iterator: AsyncIterator<string> }>();
  private _shellIntegrationWarningShown = false;
  private _viewReady = false;
  private _disposed = false;

  constructor(private readonly _extensionUri: vscode.Uri) {
    this._outputBuffer = new OutputBuffer((message) => {
      if (!this._view || !this._viewReady) return false;
      return this._view.webview.postMessage(message);
    }, {
      onBackpressureChange: (tabId, backpressured) => {
        const session = this._localSessions.get(tabId);
        if (!session?.ptyProcess) return;
        try {
          if (backpressured) session.ptyProcess.pause();
          else session.ptyProcess.resume();
        } catch {
          // The process may have exited while output was draining.
        }
      }
    });
    this._registerGlobalListeners();
  }

  public dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._mirrorGeneration++;
    this._cancelReaders();
    this._viewReady = false;
    this._outputBuffer.detach();
    this._outputBuffer.dispose();
    this._disposeViewSubscriptions();
    for (const subscription of this._subscriptions.splice(0)) subscription.dispose();
    for (const id of Array.from(this._localSessions.keys())) this._disposeLocalSession(id, false);
    this._agentSessions.clear();
    this._agentIdsByTerminal.clear();
    this._hiddenAgentTerminals.clear();
    this._view = undefined;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    if (this._disposed) return;
    this._disposeViewSubscriptions();
    this._viewReady = false;
    this._detachOutput();
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, 'dist'),
        vscode.Uri.joinPath(this._extensionUri, 'media')
      ]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    this._viewSubscriptions.push(
      webviewView.webview.onDidReceiveMessage((message: unknown) => this._handleMessage(message)),
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) this._postMessage({ type: 'viewVisible' });
      }),
      webviewView.onDidDispose(() => {
        if (this._view === webviewView) {
          this._viewReady = false;
          this._detachOutput();
          this._view = undefined;
          this._disposeViewSubscriptions();
        }
      })
    );
    this._reportShellIntegrationAvailability();
    this._updateBadge();
  }

  public focus(): void {
    if (this._view) {
      this._view.show(true);
    }
  }

  private _sendConfig(): void {
    if (this._view) this._postMessage({ type: 'config', config: getTerminalConfig() });
  }

  private _isMirroringEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('secondaryTerminal')
      .get('mirrorAgentTerminals', true);
  }

  private _updateBadge(): void {
    if (!this._view) return;
    const count = this._localSessions.size + this._agentSessions.size;
    if (count > 0) {
      this._view.description = `${count} tab${count > 1 ? 's' : ''}`;
      this._view.badge = {
        value: count,
        tooltip: `${count} open terminal tab${count > 1 ? 's' : ''}`
      };
    } else {
      this._view.description = undefined;
      this._view.badge = undefined;
    }
  }

  private _getNextTabNumber(): number {
    const numbers = new Set(Array.from(this._localSessions.values()).map((session) => session.tabNumber));
    let next = 1;
    while (numbers.has(next)) next++;
    return next;
  }

  private _registerGlobalListeners(): void {
    this._subscriptions.push(
      vscode.window.onDidChangeActiveColorTheme(() => this._postMessage({ type: 'themeChanged' })),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('secondaryTerminal') || event.affectsConfiguration('terminal.integrated') || event.affectsConfiguration('editor.fontFamily') || event.affectsConfiguration('editor.fontSize')) this._sendConfig();
        if (event.affectsConfiguration('secondaryTerminal.mirrorAgentTerminals')) this._reconcileMirroring();
      }),
      vscode.window.onDidOpenTerminal((terminal) => {
        if (this._isMirroringEnabled()) this._addAgentTerminal(terminal);
      }),
      vscode.window.onDidCloseTerminal((terminal) => this._removeAgentTerminal(terminal))
    );
    const event = vscode.window.onDidStartTerminalShellExecution;
    if (typeof event === 'function') this._subscriptions.push(event.call(vscode.window, (value) => void this._readShellExecution(value)));
  }

  private _handleMessage(raw: unknown): void {
    if (!isRecord(raw) || typeof raw.type !== 'string') return;
    switch (raw.type) {
      case 'ready':
        if (Object.keys(raw).length === 1 && !this._viewReady) {
          this._viewReady = true;
          this._sendConfig();
          this._restoreTabs();
        }
        break;
      case 'createTab':
        if (Object.keys(raw).length === 1) this._createLocalSession();
        break;
      case 'input':
        if (isString(raw.tabId, 256) && isString(raw.data, MAX_INPUT_LENGTH) && this._isKnownTab(raw.tabId)) this._handleInput(raw.tabId, raw.data);
        break;
      case 'copy':
        if (Object.keys(raw).length === 3 && isString(raw.tabId, 256) && this._isKnownTab(raw.tabId) && isString(raw.data, MAX_CLIPBOARD_LENGTH)) {
          void Promise.resolve(vscode.env.clipboard.writeText(raw.data)).catch(() => vscode.window.showWarningMessage('Could not copy the terminal selection.'));
        }
        break;
      case 'paste':
        if (Object.keys(raw).length === 2 && isString(raw.tabId, 256) && this._localSessions.has(raw.tabId)) {
          const tabId = raw.tabId;
          void Promise.resolve(vscode.env.clipboard.readText()).then(data => {
            if (!this._localSessions.has(tabId)) return;
            if (data.length > MAX_CLIPBOARD_LENGTH) {
              void vscode.window.showWarningMessage('The clipboard content is too large to paste into Side Terminal.');
              return;
            }
            this._postMessage({ type: 'paste', tabId, data });
          }).catch(() => vscode.window.showWarningMessage('Could not paste from the clipboard.'));
        }
        break;
      case 'resize':
        if (isString(raw.tabId, 256) && isBoundedInteger(raw.cols, 1, MAX_TERMINAL_COLS) && isBoundedInteger(raw.rows, 1, MAX_TERMINAL_ROWS) && this._isKnownTab(raw.tabId)) this._handleResize(raw.tabId, raw.cols, raw.rows);
        break;
      case 'closeTab':
        if (Object.keys(raw).length === 2 && isString(raw.tabId, 256)) this._handleClose(raw.tabId);
        break;
      case 'openUrl':
        if (Object.keys(raw).length === 2 && isString(raw.url, MAX_URL_LENGTH)) void this._handleOpenUrl(raw.url);
        break;
      case 'openFile':
        if (isString(raw.path, MAX_PATH_LENGTH) && (raw.line === undefined || isBoundedInteger(raw.line, 1, MAX_LINE_OR_COLUMN)) && (raw.col === undefined || isBoundedInteger(raw.col, 1, MAX_LINE_OR_COLUMN))) void this._handleOpenFile(raw.path, raw.line as number | undefined, raw.col as number | undefined);
        break;
      case 'openEditorTerminal':
        if (Object.keys(raw).length === 1) void vscode.commands.executeCommand(COMMANDS.OPEN_EDITOR_TERMINAL);
        break;
      case 'outputAck':
        if (Object.keys(raw).length === 3 && isString(raw.tabId, 256) && isBoundedInteger(raw.seq, 1, Number.MAX_SAFE_INTEGER)) {
          const parsed = this._outputBuffer.ack(raw.tabId, raw.seq);
          const session = this._localSessions.get(raw.tabId) ?? this._agentSessions.get(raw.tabId);
          if (session && parsed) session.history = appendHistory(session.history, parsed);
        }
        break;
      case 'clearTab':
        if (Object.keys(raw).length === 2 && isString(raw.tabId, 256)) {
          const local = this._localSessions.get(raw.tabId);
          const agent = this._agentSessions.get(raw.tabId);
          if (local) local.history = '';
          if (agent) agent.history = '';
        }
        break;
      default:
        break;
    }
  }

  private _createLocalSession(): void {
    if (vscode.workspace.isTrusted === false) {
      void vscode.window.showWarningMessage('Side Terminal is disabled in Restricted Mode. Trust this workspace to start a shell.');
      return;
    }
    if (this._localSessions.size + this._agentSessions.size >= MAX_TABS_RESTORED) {
      void vscode.window.showWarningMessage(`Side Terminal supports up to ${MAX_TABS_RESTORED} tabs.`);
      return;
    }
    const tabNumber = this._getNextTabNumber();
    const pty = loadNodePty();
    if (!pty) {
      void vscode.window.showErrorMessage('Side Terminal requires node-pty to start a shell.');
      return;
    }
    let launchOptions: ReturnType<typeof getShellLaunchOptions>;
    try {
      launchOptions = getShellLaunchOptions();
    } catch (error) {
      void vscode.window.showErrorMessage(`Side Terminal could not start the configured shell: ${String(error)}`);
      return;
    }
    const tabId = `term-${Date.now()}-${this._nextSessionNumber++}`;
    const title = `Terminal ${tabNumber}`;

    let ptyProcess: import('node-pty').IPty;
    try {
      ptyProcess = pty.spawn(launchOptions.shell, launchOptions.args, { name: 'xterm-256color', cols: 80, rows: 25, cwd: launchOptions.cwd, env: launchOptions.env });
    } catch (error) {
      void vscode.window.showErrorMessage(`Side Terminal could not start the configured shell: ${String(error)}`);
      return;
    }
    const session: LocalSession = { id: tabId, title, tabNumber, ptyProcess, history: '' };
    this._localSessions.set(tabId, session);
    session.dataSubscription = ptyProcess.onData((data: string) => {
      if (this._localSessions.get(tabId) === session) {
        this._outputBuffer.append(tabId, data);
      }
    });
    session.exitSubscription = ptyProcess.onExit(() => {
      if (this._localSessions.delete(tabId)) {
        this._outputBuffer.remove(tabId);
        session.dataSubscription?.dispose();
        session.exitSubscription?.dispose();
        this._postMessage({ type: 'removeTab', tabId });
        this._updateBadge();
      }
    });
    this._postMessage({ type: 'addTab', id: tabId, title, isAgent: false });

    this._updateBadge();
  }

  private _disposeLocalSession(tabId: string, announce: boolean): void {
    const session = this._localSessions.get(tabId);
    if (!session) return;
    this._localSessions.delete(tabId);
    try { session.ptyProcess.resume(); } catch { /* already exited */ }
    this._outputBuffer.remove(tabId);
    session.dataSubscription?.dispose();
    session.exitSubscription?.dispose();
    try { session.ptyProcess.kill(); } catch { /* already exited */ }
    if (announce) this._postMessage({ type: 'removeTab', tabId });
    this._updateBadge();
  }

  private _isKnownTab(tabId: string): boolean {
    return this._localSessions.has(tabId) || this._agentSessions.has(tabId);
  }

  private _addAgentTerminal(terminal: vscode.Terminal): void {
    if (!isRecognizedAgentTerminal(terminal) || this._hiddenAgentTerminals.has(terminal) || this._agentIdsByTerminal.has(terminal) || this._localSessions.size + this._agentSessions.size >= MAX_TABS_RESTORED) return;
    const id = `agent-${this._nextAgentNumber++}`;
    const session = { id, title: `🤖 ${terminal.name}`, terminal, history: '' };
    this._agentSessions.set(id, session);
    this._agentIdsByTerminal.set(terminal, id);
    this._postMessage({ type: 'addTab', id, title: session.title, isAgent: true, readOnly: true });
    this._updateBadge();
  }

  private _removeAgentTerminal(terminal: vscode.Terminal): void {
    this._hiddenAgentTerminals.delete(terminal);
    const id = this._agentIdsByTerminal.get(terminal);
    if (!id) return;
    this._agentIdsByTerminal.delete(terminal);
    this._agentSessions.delete(id);
    this._cancelReaders(id);
    this._outputBuffer.remove(id);
    this._postMessage({ type: 'removeTab', tabId: id });
    this._updateBadge();
  }

  private _restoreTabs(): void {
    if (this._localSessions.size === 0) this._createLocalSession();
    if (this._isMirroringEnabled()) for (const terminal of vscode.window.terminals) this._addAgentTerminal(terminal);
    const tabs: Array<{ id: string; title: string; isAgent: boolean; snapshot?: string }> = [];
    let historyBudget = MAX_RESTORE_HISTORY;
    for (const session of this._localSessions.values()) {
      if (tabs.length >= MAX_TABS_RESTORED) break;
      const snapshot = historyBudget > 0 ? session.history.slice(-historyBudget) : '';
      historyBudget -= snapshot.length;
      tabs.push({ id: session.id, title: session.title, isAgent: false, ...(snapshot ? { snapshot } : {}) });
    }
    for (const session of this._agentSessions.values()) {
      if (tabs.length >= MAX_TABS_RESTORED) break;
      const snapshot = historyBudget > 0 ? session.history.slice(-historyBudget) : '';
      historyBudget -= snapshot.length;
      tabs.push({ id: session.id, title: session.title, isAgent: true, ...(snapshot ? { snapshot } : {}) });
    }
    this._postMessage({ type: 'restoreTabs', tabs });
    this._outputBuffer.attach();
    for (const session of this._localSessions.values()) {
      if (!this._outputBuffer.isBackpressured(session.id)) {
        try { session.ptyProcess.resume(); } catch { /* already exited */ }
      }
    }
    this._updateBadge();
  }

  private _handleInput(tabId: string, data: string): void {
    if (this._agentSessions.has(tabId)) return;
    try {
      this._localSessions.get(tabId)?.ptyProcess.write(data);
    } catch {
      // The process may exit between message validation and forwarding.
    }
  }

  private _handleResize(tabId: string, cols: number, rows: number): void {
    const session = this._localSessions.get(tabId);
    if (session?.ptyProcess?.resize) {
      try { session.ptyProcess.resize(cols, rows); } catch { /* process exited */ }
    }
  }

  private _handleClose(tabId: string): void {
    const agent = this._agentSessions.get(tabId);
    if (agent) {
      this._agentSessions.delete(tabId);
      this._cancelReaders(tabId);
      this._agentIdsByTerminal.delete(agent.terminal);
      this._hiddenAgentTerminals.add(agent.terminal);
      this._outputBuffer.remove(tabId);
      this._postMessage({ type: 'removeTab', tabId });
      this._updateBadge();
      return;
    }
    this._disposeLocalSession(tabId, true);
  }

  private _reconcileMirroring(): void {
    if (!this._isMirroringEnabled()) {
      this._mirrorGeneration++;
      this._cancelReaders();
      for (const session of this._agentSessions.values()) {
        this._outputBuffer.remove(session.id);
        this._postMessage({ type: 'removeTab', tabId: session.id });
      }
      this._agentSessions.clear();
      this._agentIdsByTerminal.clear();
      this._hiddenAgentTerminals.clear();
      this._updateBadge();
      return;
    }
    this._reportShellIntegrationAvailability();
    for (const terminal of vscode.window.terminals) this._addAgentTerminal(terminal);
    this._updateBadge();
  }

  private _reportShellIntegrationAvailability(): void {
    const supported = typeof vscode.window.onDidStartTerminalShellExecution === 'function';
    if (!supported && !this._shellIntegrationWarningShown && this._isMirroringEnabled()) {
      this._shellIntegrationWarningShown = true;
      void vscode.window.showWarningMessage('Side Terminal agent mirroring is unavailable in this VS Code version because shell integration is not supported.');
    }
  }

  private async _readShellExecution(event: vscode.TerminalShellExecutionStartEvent): Promise<void> {
    if (!this._isMirroringEnabled() || !event?.terminal || !isRecognizedAgentTerminal(event.terminal)) return;
    this._addAgentTerminal(event.terminal);
    const tabId = this._agentIdsByTerminal.get(event.terminal);
    if (!tabId || !event.execution || typeof event.execution.read !== 'function') return;
    const readerId = this._nextReaderId++;
    const generation = this._mirrorGeneration;
    try {
      const iterator = event.execution.read()[Symbol.asyncIterator]();
      this._cancelReaders(tabId);
      this._activeReaders.set(readerId, { tabId, iterator });
      const commandLine = event.execution.commandLine?.value;
      if (commandLine && this._isMirroringEnabled() && generation === this._mirrorGeneration) {
        const marker = `\r\n\x1b[36m$ ${commandLine}\x1b[0m\r\n`;
        this._outputBuffer.append(tabId, marker);
      }
      for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) {
        if (!this._activeReaders.has(readerId) || !this._isMirroringEnabled() || generation !== this._mirrorGeneration || !this._agentSessions.has(tabId)) break;
        if (typeof chunk === 'string' && chunk.length > 0) {
          this._outputBuffer.append(tabId, chunk);
        }
      }
    } catch {
      // Shell streams close when their source terminal exits.
    } finally {
      this._activeReaders.delete(readerId);
    }
  }

  private _cancelReaders(tabId?: string): void {
    for (const [id, reader] of this._activeReaders) {
      if (tabId !== undefined && reader.tabId !== tabId) continue;
      this._activeReaders.delete(id);
      try { void Promise.resolve(reader.iterator.return?.()).catch(() => undefined); } catch { /* source already closed */ }
    }
  }

  private _postMessage(message: unknown): void {
    if (this._view) void Promise.resolve(this._view.webview.postMessage(message)).catch(() => undefined);
  }

  private _detachOutput(): void {
    this._outputBuffer.detach();
    for (const session of this._localSessions.values()) {
      try { session.ptyProcess.pause(); } catch { /* already exited */ }
    }
  }

  private _disposeViewSubscriptions(): void {
    for (const subscription of this._viewSubscriptions.splice(0)) subscription.dispose();
  }

  private async _handleOpenUrl(urlStr: string): Promise<void> {
    try {
      const uri = vscode.Uri.parse(urlStr);
      if (uri.scheme === 'http' || uri.scheme === 'https') {
        await vscode.env.openExternal(uri);
      }
    } catch (err) {
      console.error('Failed to open external url:', err);
    }
  }

  private async _handleOpenFile(filePath: string, line?: number, col?: number): Promise<void> {
    try {
      let targetPath = filePath.trim();
      targetPath = targetPath.replace(/^["'(\[]+|["')\]]+$/g, '');

      let resolvedUri: vscode.Uri | null = null;
      if (path.isAbsolute(targetPath)) {
        if (await fileExists(targetPath)) {
          resolvedUri = vscode.Uri.file(targetPath);
        }
      } else {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
          for (const folder of folders) {
            const candidate = path.join(folder.uri.fsPath, targetPath);
            if (await fileExists(candidate)) {
              resolvedUri = vscode.Uri.file(candidate);
              break;
            }
          }
        }
      }

      if (resolvedUri) {
        const doc = await vscode.workspace.openTextDocument(resolvedUri);
        const lineNum = Math.max(0, (line || 1) - 1);
        const colNum = Math.max(0, (col || 1) - 1);
        const position = new vscode.Position(lineNum, colNum);
        const selection = new vscode.Range(position, position);

        const editor = await vscode.window.showTextDocument(doc, {
          selection,
          preview: false
        });
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
      } else {
        vscode.window.showWarningMessage(`Could not locate file: ${filePath}`);
      }
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css')
    );
    const xtermCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'xterm.css')
    );

    const nonce = randomBytes(16).toString('base64');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${xtermCssUri}">
  <link rel="stylesheet" href="${styleUri}">
  <title>Side Terminal</title>
</head>
<body>
  <div id="header-bar">
    <div id="tab-list" role="tablist" aria-label="Terminal tabs"></div>
    <div id="header-actions">
      <button id="new-tab-btn" class="header-action-btn" title="New Terminal (+)" aria-label="New Terminal">+</button>
      <button id="open-editor-btn" class="header-action-btn" title="Create Terminal in Editor Area" aria-label="Create Editor Terminal">&#x2922;</button>
      <button id="clear-tab-btn" class="header-action-btn" title="Clear Terminal" aria-label="Clear Terminal">&#x2298;</button>
    </div>
  </div>
  <div id="terminal-container"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
