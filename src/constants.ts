/**
 * Extension command identifiers as declared in package.json
 */
export const COMMANDS = {
  SHOW: 'secondaryTerminal.show',
  TOGGLE: 'secondaryTerminal.toggle',
  MOVE_TO_SECONDARY: 'secondaryTerminal.moveToSecondarySideBar',
  MOVE_TO_BOTTOM: 'secondaryTerminal.moveToBottomPanel',
  OPEN_EDITOR_TERMINAL: 'secondaryTerminal.openEditorTerminal'
} as const;

/**
 * Built-in VS Code workbench command identifiers
 */
export const VSCODE_COMMANDS = {
  FOCUS_AUXILIARY_BAR: 'workbench.action.focusAuxiliaryBar',
  TOGGLE_AUXILIARY_BAR: 'workbench.action.toggleAuxiliaryBar',
  TERMINAL_FOCUS: 'workbench.action.terminal.focus',
  TERMINAL_TOGGLE: 'workbench.action.terminal.toggleTerminal',
  TERMINAL_NEW_EDITOR: 'workbench.action.terminal.newEditor',
  MOVE_VIEW: 'workbench.action.moveView',
  FOCUS_ACTIVE_EDITOR_GROUP: 'workbench.action.focusActiveEditorGroup'
} as const;

/**
 * Known View and Container IDs
 */
export const VIEW_IDS = {
  TERMINAL_VIEW: 'terminal',
  TERMINAL_CONTAINER: 'workbench.panel.terminal',
  AUXILIARY_BAR_CONTAINER: 'workbench.view.auxiliary',
  PANEL_CONTAINER: 'workbench.view.panel'
} as const;

/**
 * Status bar constants
 */
export const STATUS_BAR = {
  TEXT: '$(terminal) Side Terminal',
  TOOLTIP: 'Toggle Secondary Side Bar Terminal (Cmd+Alt+T / Ctrl+Alt+T)',
  PRIORITY: 100
} as const;
