import * as vscode from 'vscode';

/**
 * Creates and reveals a new terminal session in the editor area.
 * This provides simultaneous terminal access in the main workspace/bottom area
 * while the Secondary Side Bar terminal remains active.
 */
export async function openEditorTerminal(): Promise<vscode.Terminal> {
  const terminal = vscode.window.createTerminal({
    name: `Editor Terminal ${vscode.window.terminals.length + 1}`,
    location: vscode.TerminalLocation.Editor
  });

  terminal.show(false);
  return terminal;
}
