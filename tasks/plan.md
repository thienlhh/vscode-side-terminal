# Implementation Plan: Secondary Terminal Extension

## 1. Component Architecture & Dependencies
The extension is built in 4 modular components:
1. **Manifest & Configuration (`package.json`, `tsconfig.json`)**:
   Declares commands, activation events, default keybindings, menus, and status bar contributions.
2. **Constants & IDs (`src/constants.ts`)**:
   Defines command IDs, internal VS Code workbench action IDs, configuration keys, and UI labels.
3. **Layout & Terminal Controllers (`src/commands/`)**:
   - `layoutController.ts`: Handles moving, focusing, and toggling the native terminal view between the bottom panel and the Secondary Side Bar (Auxiliary Bar).
   - `editorTerminal.ts`: Creates and manages editor-located terminals (`vscode.TerminalLocation.Editor`) for concurrent multi-terminal workflows.
4. **UI Layer (`src/ui/statusBar.ts`)**:
   Provides a persistent, lightweight status bar button with tooltip and toggle action.

## 2. Implementation Order
1. **Scaffold & Build Setup**: Initialize `package.json`, `tsconfig.json`, build scripts (`esbuild`), and VS Code launch configurations.
2. **Core Constants & Command Definitions**: Define all command IDs and settings.
3. **Layout Controller**: Implement `show`, `toggle`, `moveToSecondarySideBar`, and `moveToBottomPanel`.
4. **Editor Terminal Controller**: Implement `openEditorTerminal`.
5. **UI Layer**: Implement status bar item and command registration in `extension.ts`.
6. **Integration & Automated Tests**: Set up `@vscode/test-electron` test suite to verify command registration and activation.
7. **Verification & Packaging**: Test in VS Code Extension Host and package as `.vsix`.

## 3. Risks & Mitigations
- **Risk**: Internal VS Code command names may vary across versions.
  - *Mitigation*: Use canonical workbench commands (`workbench.action.focusAuxiliaryBar`, `workbench.action.terminal.focus`, `workbench.action.moveView`, `workbench.action.terminal.newEditor`) with graceful error handling and fallback messages.
- **Risk**: Focus state timing during sidebar opening.
  - *Mitigation*: Chain promises properly (`await`) so the auxiliary bar reveals before terminal focus is requested.

## 4. Verification Checkpoints
- **Checkpoint 1**: TypeScript compilation (`npm run compile`) passes with 0 errors and 0 warnings.
- **Checkpoint 2**: Automated tests (`npm test`) run cleanly in headless VS Code instance.
- **Checkpoint 3**: Interactive test in Extension Development Host confirms Secondary Side Bar opens with native terminal tabs.
