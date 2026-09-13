import * as vscode from 'vscode';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { COMMANDS } from '../constants';

let nodePty: typeof import('node-pty') | null = null;
try {
  nodePty = require('node-pty');
} catch {
  // Graceful fallback
}

function fixPtyPermissions() {
  try {
    const ptyPath = require.resolve('node-pty');
    const ptyDir = path.dirname(path.dirname(ptyPath));
    const prebuildsDir = path.join(ptyDir, 'prebuilds');
    if (fs.existsSync(prebuildsDir)) {
      for (const arch of fs.readdirSync(prebuildsDir)) {
        const helper = path.join(prebuildsDir, arch, 'spawn-helper');
        if (fs.existsSync(helper)) {
          fs.chmodSync(helper, 0o755);
        }
      }
    }
  } catch {
    // Ignore error
  }
}

/**
 * Determines if a terminal belongs to an AI agent rather than a standard user interactive shell.
 */
function isRecognizedAgentTerminal(term: vscode.Terminal): boolean {
  const name = term.name.toLowerCase().trim();
  const standardShells = [
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
  ];

  // Exclude standard user shells
  if (standardShells.includes(name)) {
    return false;
  }

  // Only match recognized AI agents or task runners
  const agentKeywords = ['cline', 'copilot', 'roo', 'agent', 'antigravity', 'claude'];
  return agentKeywords.some((k) => name.includes(k));
}

interface LocalSession {
  id: string;
  title: string;
  tabNumber: number;
  ptyProcess: any;
  isNodePty: boolean;
}

export class TerminalViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'secondary-terminal.view';
  private _view?: vscode.WebviewView;
  private _localSessions: Map<string, LocalSession> = new Map();
  private _agentTabIds: Set<string> = new Set();

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.type) {
        case 'ready': {
          this._sendConfig();
          this._initTabs();
          break;
        }
        case 'createTab': {
          this._createLocalSession();
          break;
        }
        case 'input': {
          this._handleInput(message.tabId, message.data);
          break;
        }
        case 'resize': {
          this._handleResize(message.tabId, message.cols, message.rows);
          break;
        }
        case 'closeTab': {
          this._handleClose(message.tabId);
          break;
        }
        case 'openUrl': {
          this._handleOpenUrl(message.url);
          break;
        }
        case 'openFile': {
          this._handleOpenFile(message.path, message.line, message.col);
          break;
        }
        case 'openEditorTerminal': {
          vscode.commands.executeCommand(COMMANDS.OPEN_EDITOR_TERMINAL);
          break;
        }
      }
    });

    // Visibility listener to re-fit terminals when tab/sidebar is shown
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this._view?.webview.postMessage({ type: 'viewVisible' });
      }
    });

    // Theme change listener
    vscode.window.onDidChangeActiveColorTheme(() => {
      this._view?.webview.postMessage({ type: 'themeChanged' });
    });

    // Configuration change listener
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('secondaryTerminal')) {
        this._sendConfig();
      }
    });

    // Watch for AI agent terminals (ignoring regular user shells)
    vscode.window.onDidOpenTerminal((term) => {
      if (!this._isMirroringEnabled() || !isRecognizedAgentTerminal(term)) {
        return;
      }

      const tabId = `agent-${term.name}`;
      this._agentTabIds.add(tabId);
      this._view?.webview.postMessage({
        type: 'addTab',
        id: tabId,
        title: `🤖 ${term.name}`,
        isAgent: true
      });
      this._updateBadge();
    });

    vscode.window.onDidCloseTerminal((term) => {
      const tabId = `agent-${term.name}`;
      if (this._agentTabIds.has(tabId)) {
        this._agentTabIds.delete(tabId);
        this._view?.webview.postMessage({
          type: 'removeTab',
          tabId
        });
        this._updateBadge();
      }
    });

    // Stream execution data if TerminalShellExecution API is supported
    if ('onDidStartTerminalShellExecution' in (vscode.window as any)) {
      (vscode.window as any).onDidStartTerminalShellExecution(async (e: any) => {
        if (!this._isMirroringEnabled() || !isRecognizedAgentTerminal(e.terminal)) {
          return;
        }

        const tabId = `agent-${e.terminal.name}`;
        this._agentTabIds.add(tabId);
        this._view?.webview.postMessage({
          type: 'addTab',
          id: tabId,
          title: `🤖 ${e.terminal.name}`,
          isAgent: true
        });
        this._updateBadge();

        const cmd = e.execution.commandLine?.value;
        if (cmd) {
          this._view?.webview.postMessage({
            type: 'data',
            tabId,
            data: `\r\n\x1b[36m$ ${cmd}\x1b[0m\r\n`
          });
        }

        try {
          const stream = e.execution.read();
          for await (const chunk of stream) {
            this._view?.webview.postMessage({
              type: 'data',
              tabId,
              data: chunk
            });
          }
        } catch {
          // Finished reading
        }
      });
    }

    this._updateBadge();
  }

  public focus(): void {
    if (this._view) {
      this._view.show(true);
    }
  }

  private _getTerminalConfig() {
    const cfg = vscode.workspace.getConfiguration('secondaryTerminal');
    return {
      cursorBlink: cfg.get<boolean>('cursorBlink', true),
      cursorStyle: cfg.get<'block' | 'underline' | 'bar'>('cursorStyle', 'block'),
      fontSize: cfg.get<number>('fontSize', 12),
      fontFamily: cfg.get<string>(
        'fontFamily',
        "Menlo, Monaco, 'Courier New', monospace, Consolas"
      ),
      lineHeight: cfg.get<number>('lineHeight', 1.2),
      scrollback: cfg.get<number>('scrollback', 5000)
    };
  }

  private _sendConfig(): void {
    this._view?.webview.postMessage({
      type: 'config',
      config: this._getTerminalConfig()
    });
  }

  private _isMirroringEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('secondaryTerminal')
      .get('mirrorAgentTerminals', true);
  }

  private _updateBadge(): void {
    if (!this._view) return;
    const count = this._localSessions.size + this._agentTabIds.size;
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

  private _initTabs(): void {
    // 1. Create initial local terminal if none exist
    if (this._localSessions.size === 0) {
      this._createLocalSession();
    }

    // 2. Discover active AI agent terminals (ignoring regular user shells)
    if (this._isMirroringEnabled()) {
      vscode.window.terminals.forEach((term) => {
        if (isRecognizedAgentTerminal(term)) {
          const tabId = `agent-${term.name}`;
          this._agentTabIds.add(tabId);
          this._view?.webview.postMessage({
            type: 'addTab',
            id: tabId,
            title: `🤖 ${term.name}`,
            isAgent: true
          });
        }
      });
    }

    this._updateBadge();
  }

  /**
   * Computes the lowest unused tab number among currently open local tabs
   */
  private _getNextTabNumber(): number {
    const activeNumbers = new Set(
      Array.from(this._localSessions.values()).map((s) => s.tabNumber)
    );
    let next = 1;
    while (activeNumbers.has(next)) {
      next++;
    }
    return next;
  }

  private _createLocalSession(): void {
    const tabNumber = this._getNextTabNumber();
    const tabId = `term-${Date.now()}-${tabNumber}`;
    const title = `Terminal ${tabNumber}`;

    const shell = process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : '/bin/zsh');
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();

    let ptyProcess: any = null;
    let isNodePty = false;

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM_PROGRAM: 'vscode',
      TERM_PROGRAM_VERSION: vscode.version || '1.80.0'
    };

    if (nodePty) {
      try {
        fixPtyPermissions();
        ptyProcess = nodePty.spawn(shell, [], {
          name: 'xterm-256color',
          cols: 80,
          rows: 25,
          cwd,
          env
        });

        ptyProcess.onData((data: string) => {
          this._view?.webview.postMessage({ type: 'data', tabId, data });
        });

        ptyProcess.onExit(() => {
          this._view?.webview.postMessage({ type: 'removeTab', tabId });
          this._localSessions.delete(tabId);
          this._updateBadge();
        });

        isNodePty = true;
      } catch (err) {
        console.error('node-pty spawn failed, falling back to child_process:', err);
        ptyProcess = null;
      }
    }

    if (!ptyProcess) {
      // Child process fallback
      const cp = require('child_process');
      ptyProcess = cp.spawn(shell, [], {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      ptyProcess.stdout?.on('data', (d: Buffer) => {
        this._view?.webview.postMessage({ type: 'data', tabId, data: d.toString() });
      });

      ptyProcess.stderr?.on('data', (d: Buffer) => {
        this._view?.webview.postMessage({ type: 'data', tabId, data: d.toString() });
      });

      ptyProcess.on('exit', () => {
        this._view?.webview.postMessage({ type: 'removeTab', tabId });
        this._localSessions.delete(tabId);
        this._updateBadge();
      });
      isNodePty = false;
    }

    this._localSessions.set(tabId, { id: tabId, title, tabNumber, ptyProcess, isNodePty });

    this._view?.webview.postMessage({
      type: 'addTab',
      id: tabId,
      title,
      isAgent: false
    });

    this._updateBadge();
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
        if (fs.existsSync(targetPath)) {
          resolvedUri = vscode.Uri.file(targetPath);
        }
      } else {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
          for (const folder of folders) {
            const candidate = path.join(folder.uri.fsPath, targetPath);
            if (fs.existsSync(candidate)) {
              resolvedUri = vscode.Uri.file(candidate);
              break;
            }
          }
        }
        if (!resolvedUri && this._extensionUri?.fsPath) {
          const candidate = path.join(this._extensionUri.fsPath, targetPath);
          if (fs.existsSync(candidate)) {
            resolvedUri = vscode.Uri.file(candidate);
          }
        }
        if (!resolvedUri) {
          const candidate = path.resolve(targetPath);
          if (fs.existsSync(candidate)) {
            resolvedUri = vscode.Uri.file(candidate);
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

  private _handleInput(tabId: string, data: string): void {
    if (tabId.startsWith('agent-')) {
      const termName = tabId.replace('agent-', '');
      const target = vscode.window.terminals.find((t) => t.name === termName);
      if (target) {
        target.sendText(data, false);
      }
    } else {
      const session = this._localSessions.get(tabId);
      if (session) {
        if (session.isNodePty) {
          session.ptyProcess.write(data);
        } else if (session.ptyProcess.stdin) {
          session.ptyProcess.stdin.write(data);
        }
      }
    }
  }

  private _handleResize(tabId: string, cols: number, rows: number): void {
    const session = this._localSessions.get(tabId);
    if (session && session.isNodePty && session.ptyProcess?.resize) {
      try {
        session.ptyProcess.resize(cols, rows);
      } catch {
        // Ignored
      }
    }
  }

  private _handleClose(tabId: string): void {
    if (tabId.startsWith('agent-')) {
      const termName = tabId.replace('agent-', '');
      const target = vscode.window.terminals.find((t) => t.name === termName);
      target?.dispose();
      this._agentTabIds.delete(tabId);
    } else {
      const session = this._localSessions.get(tabId);
      if (session) {
        try {
          session.ptyProcess.kill();
        } catch {
          // Ignored
        }
        this._localSessions.delete(tabId);
      }
    }
    this._updateBadge();
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

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}; font-src ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${xtermCssUri}">
  <link rel="stylesheet" href="${styleUri}">
  <title>Side Terminal</title>
</head>
<body>
  <div id="header-bar">
    <div id="tab-list"></div>
    <div id="header-actions">
      <div id="new-tab-btn" class="header-action-btn" title="New Terminal (+)">+</div>
      <div id="open-editor-btn" class="header-action-btn" title="Open Terminal in Editor Area (Cmd+Alt+E / Ctrl+Alt+E)">&#x2922;</div>
      <div id="clear-tab-btn" class="header-action-btn" title="Clear Terminal (Cmd+K / Ctrl+L)">&#x2298;</div>
    </div>
  </div>
  <div id="terminal-container"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
