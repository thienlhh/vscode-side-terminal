import * as assert from 'assert';
import * as vscode from 'vscode';
import { COMMANDS } from '../../src/constants';

suite('Side Terminal Extension Test Suite', () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension('thienle.side-terminal');
    assert.ok(ext, 'The extension under test must be installed');
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test('All commands should be registered', async () => {
    const commands = await vscode.commands.getCommands(true);

    assert.ok(
      commands.includes(COMMANDS.SHOW),
      `${COMMANDS.SHOW} should be registered in vscode.commands`
    );
    assert.ok(
      commands.includes(COMMANDS.TOGGLE),
      `${COMMANDS.TOGGLE} should be registered in vscode.commands`
    );
    assert.ok(
      commands.includes(COMMANDS.OPEN_EDITOR_TERMINAL),
      `${COMMANDS.OPEN_EDITOR_TERMINAL} should be registered in vscode.commands`
    );
  });

  test('openEditorTerminal creates terminal in editor area', async () => {
    const initialCount = vscode.window.terminals.length;
    const terminal = (await vscode.commands.executeCommand(
      COMMANDS.OPEN_EDITOR_TERMINAL
    )) as vscode.Terminal;

    assert.ok(terminal, 'Terminal should be returned by openEditorTerminal command');
    assert.strictEqual(
      vscode.window.terminals.length,
      initialCount + 1,
      'Terminals count should increment by 1'
    );
    assert.ok(
      terminal.name.includes('Editor Terminal'),
      'Terminal name should indicate Editor Terminal'
    );

    terminal.dispose();
  });

  test('TerminalViewProvider handles openFile, openUrl, and openEditorTerminal messages', async () => {
    const path = await import('path');
    const { TerminalViewProvider } = await import('../../src/provider/terminalViewProvider');
    const extensionRoot = path.resolve(__dirname, '../../../');
    const provider = new TerminalViewProvider(vscode.Uri.file(extensionRoot));

    let messageListener: ((msg: any) => void) | undefined;
    const postedMessages: any[] = [];

    const mockWebview: any = {
      options: {},
      html: '',
      cspSource: 'https:',
      asWebviewUri: (uri: vscode.Uri) => uri,
      onDidReceiveMessage: (listener: (msg: any) => void) => {
        messageListener = listener;
        return { dispose: () => {} };
      },
      postMessage: async (msg: any) => {
        postedMessages.push(msg);
        return true;
      }
    };

    const mockWebviewView: any = {
      webview: mockWebview,
      visible: true,
      show: () => {},
      onDidChangeVisibility: (_listener: () => void) => {
        return { dispose: () => {} };
      },
      onDidDispose: (_listener: () => void) => {
        return { dispose: () => {} };
      }
    };

    provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
    assert.ok(messageListener, 'Message listener should be registered');

    try {
    const native = vscode.window.createTerminal({ name: 'Native coexistence test' });
    try {
      const nativeTerminals = [...vscode.window.terminals];
      messageListener!({ type: 'ready' });
      assert.deepStrictEqual(vscode.window.terminals, nativeTerminals, 'Side Terminal must not replace or add native terminal sessions');
      assert.ok(postedMessages.some(msg => msg.type === 'addTab' && !msg.isAgent) || postedMessages.some(msg => msg.type === 'restoreTabs' && msg.tabs.some((tab: any) => !tab.isAgent)), 'A local side terminal must be announced');
    } finally {
      native.dispose();
    }

    // Test openEditorTerminal message
    const termPromise = new Promise<vscode.Terminal>((resolve) => {
      const sub = vscode.window.onDidOpenTerminal((term) => {
        sub.dispose();
        resolve(term);
      });
    });
    messageListener!({ type: 'openEditorTerminal' });
    const createdTerm = await termPromise;
    assert.ok(createdTerm.name.includes('Editor Terminal'), 'Terminal name should indicate Editor Terminal');
    createdTerm.dispose();

    // Test openFile message with existing README.md
    const editorPromise = new Promise<vscode.TextEditor>((resolve) => {
      const sub = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && editor.document.fileName.endsWith('README.md')) {
          sub.dispose();
          resolve(editor);
        }
      });
    });
    messageListener!({ type: 'openFile', path: 'README.md', line: 10, col: 1 });
    await editorPromise;

    let activeEditor = vscode.window.activeTextEditor;
    for (let i = 0; i < 20; i++) {
      if (activeEditor && activeEditor.selection.active.line === 9) {
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
      activeEditor = vscode.window.activeTextEditor;
    }

    assert.ok(activeEditor, 'README.md should be opened in active editor');
    assert.ok(activeEditor.document.fileName.endsWith('README.md'), 'Active editor file should be README.md');
    assert.strictEqual(activeEditor.selection.active.line, 9, 'Cursor should be on line 10 (0-indexed 9)');

    // Scheme allowlisting is exercised without launching the system browser.
    messageListener!({ type: 'openUrl', url: 'command:workbench.action.files.newUntitledFile' });
    assert.strictEqual(vscode.window.activeTextEditor, activeEditor, 'Command URLs must not change the editor');
    } finally {
      provider.dispose();
    }
  });
});
