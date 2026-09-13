# Tasks: Secondary Terminal Extension

- [x] Task 1: Initialize Project Structure & Manifest
  - Acceptance: `package.json`, `tsconfig.json`, `.vscode/launch.json`, and `.gitignore` exist with correct metadata, scripts, and dependencies.
  - Verify: Run `npm install` and verify dependencies resolve without errors.
  - Files: `package.json`, `tsconfig.json`, `.gitignore`, `.vscode/launch.json`

- [x] Task 2: Define Core Constants & Identifiers
  - Acceptance: `src/constants.ts` defines all command names, workbench action IDs, and status bar strings with strict types.
  - Verify: Run `npx tsc --noEmit` to verify type checking.
  - Files: `src/constants.ts`

- [x] Task 3: Implement Layout & Terminal Controllers
  - Acceptance: `src/commands/layoutController.ts` implements `showSecondaryTerminal`, `toggleSecondaryTerminal`, `moveToSecondarySideBar`, `moveToBottomPanel`; `src/commands/editorTerminal.ts` implements `openEditorTerminal`.
  - Verify: Functions export properly and compile with zero errors.
  - Files: `src/commands/layoutController.ts`, `src/commands/editorTerminal.ts`

- [x] Task 4: Implement Status Bar UI and Extension Entrypoint
  - Acceptance: `src/ui/statusBar.ts` creates and manages status bar disposable; `src/extension.ts` registers all commands and hooks up lifecycle disposables.
  - Verify: Run `npm run compile` to build extension bundle with `esbuild`.
  - Files: `src/ui/statusBar.ts`, `src/extension.ts`

- [x] Task 5: Automated Integration Tests
  - Acceptance: Test suite verifies extension activates, commands are registered in `vscode.commands.getCommands()`, and status bar item is present.
  - Verify: Run `npm test` successfully (2 passing).
  - Files: `test/runTest.ts`, `test/suite/extension.test.ts`, `test/suite/index.ts`

- [x] Task 6: Package & End-to-End Verification
  - Acceptance: Production `.vsix` extension package is built.
  - Verify: `npx @vscode/vsce package` outputs `.vsix` file cleanly (5.42 KB).
  - Files: `README.md`, `LICENSE`, `.vscodeignore`, `package.json`
