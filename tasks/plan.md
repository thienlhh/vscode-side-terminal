# Implementation Plan: Side Terminal parity and reliability

The current contract is `SPEC.md`: independent sidebar sessions coexist with the native bottom Terminal view. The original scaffold plan below is historical; `layoutController.ts` is not part of the active extension and must not be reintroduced to move native panel views.

## Current implementation order

1. Synchronize the manifest/lockfile and make build/watch scripts portable.
2. Dispose listeners and owned processes; restore tabs and bounded output on view recreation.
3. Bound output queues and acknowledge parsed batches; pause/resume owned PTYs.
4. Inherit applicable native appearance, explicit shell profiles, arguments, environment, and cwd. Preserve explicit side overrides.
5. Validate messages, map mirrors to unique terminal objects, and reconcile mirroring changes.
6. Run isolated regressions, real PTY smoke checks, VS Code coexistence/navigation tests, and browser QA. Record evidence and remaining OS/agent acceptance in `docs/VALIDATION.md`.

## Original scaffold plan (superseded)

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
