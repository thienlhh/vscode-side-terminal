import * as vscode from 'vscode';
import { COMMANDS, STATUS_BAR } from '../constants';

/**
 * Creates and registers the Secondary Terminal status bar item.
 */
export function setupStatusBar(context: vscode.ExtensionContext): vscode.StatusBarItem {
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    STATUS_BAR.PRIORITY
  );

  statusBarItem.text = STATUS_BAR.TEXT;
  statusBarItem.tooltip = STATUS_BAR.TOOLTIP;
  statusBarItem.command = COMMANDS.TOGGLE;
  statusBarItem.show();

  context.subscriptions.push(statusBarItem);
  return statusBarItem;
}
