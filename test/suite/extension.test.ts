import * as assert from 'assert';
import * as vscode from 'vscode';
import { COMMANDS } from '../../src/constants';

suite('Secondary Terminal Extension Test Suite', () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension('local-dev.vscode-secondary-terminal');
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
});
