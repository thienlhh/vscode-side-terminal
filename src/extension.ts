import * as vscode from 'vscode';
import { COMMANDS } from './constants';
import { TerminalViewProvider } from './provider/terminalViewProvider';
import { setupStatusBar } from './ui/statusBar';
import { openEditorTerminal } from './commands/editorTerminal';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new TerminalViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(TerminalViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  // Focus / Toggle Side Terminal View
  const toggleCmd = vscode.commands.registerCommand(COMMANDS.TOGGLE, async () => {
    await vscode.commands.executeCommand('secondary-terminal.view.focus');
  });

  const showCmd = vscode.commands.registerCommand(COMMANDS.SHOW, async () => {
    await vscode.commands.executeCommand('secondary-terminal.view.focus');
  });

  const openEditorCmd = vscode.commands.registerCommand(
    COMMANDS.OPEN_EDITOR_TERMINAL,
    openEditorTerminal
  );

  context.subscriptions.push(toggleCmd, showCmd, openEditorCmd);

  // Status Bar
  setupStatusBar(context);
}

export function deactivate(): void {
  // Clean up
}
