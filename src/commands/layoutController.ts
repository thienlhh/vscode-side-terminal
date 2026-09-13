import * as vscode from 'vscode';
import { VSCODE_COMMANDS } from '../constants';

/**
 * Moves terminal to Secondary Side Bar, reveals the bar, and focuses the terminal.
 */
export async function showSecondaryTerminal(): Promise<void> {
  try {
    // 1. Move panel views (including terminal) to Secondary Side Bar
    await vscode.commands.executeCommand('workbench.action.movePanelToSecondarySideBar');

    // 2. Ensure at least one terminal session exists
    if (vscode.window.terminals.length === 0) {
      const terminal = vscode.window.createTerminal();
      terminal.show();
    }

    // 3. Reveal auxiliary bar & focus terminal
    await vscode.commands.executeCommand(VSCODE_COMMANDS.FOCUS_AUXILIARY_BAR);
    await vscode.commands.executeCommand(VSCODE_COMMANDS.TERMINAL_FOCUS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to show Secondary Terminal: ${message}`);
  }
}

/**
 * Toggles the Secondary Side Bar terminal.
 */
export async function toggleSecondaryTerminal(): Promise<void> {
  try {
    // 1. Ensure panel/terminal is in Secondary Side Bar
    await vscode.commands.executeCommand('workbench.action.movePanelToSecondarySideBar');

    if (vscode.window.terminals.length === 0) {
      const terminal = vscode.window.createTerminal();
      terminal.show();
    }

    // 2. Toggle Auxiliary Bar visibility
    await vscode.commands.executeCommand(VSCODE_COMMANDS.TOGGLE_AUXILIARY_BAR);

    // 3. Direct focus to terminal
    await vscode.commands.executeCommand(VSCODE_COMMANDS.TERMINAL_FOCUS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to toggle Secondary Terminal: ${message}`);
  }
}

/**
 * Moves terminal view explicitly into the Secondary Side Bar.
 */
export async function moveToSecondarySideBar(): Promise<void> {
  try {
    await vscode.commands.executeCommand('workbench.action.movePanelToSecondarySideBar');
    await vscode.commands.executeCommand(VSCODE_COMMANDS.FOCUS_AUXILIARY_BAR);
    await vscode.commands.executeCommand(VSCODE_COMMANDS.TERMINAL_FOCUS);
    vscode.window.showInformationMessage('Terminal moved to Secondary Side Bar.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Could not move terminal to Secondary Side Bar: ${message}`);
  }
}

/**
 * Moves terminal view back to the bottom panel.
 */
export async function moveToBottomPanel(): Promise<void> {
  try {
    await vscode.commands.executeCommand('workbench.action.moveSecondarySideBarToPanel');
    await vscode.commands.executeCommand(VSCODE_COMMANDS.TERMINAL_FOCUS);
    vscode.window.showInformationMessage('Terminal moved to Bottom Panel.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Could not move terminal to Bottom Panel: ${message}`);
  }
}
