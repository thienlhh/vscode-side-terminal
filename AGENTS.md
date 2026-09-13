# AGENTS.md

Context and operational guidelines for AI coding agents working on `vscode-secondary-terminal`.

---

## 1. Initial Load: Core Context & Commands

### Essential Commands
- **Compile bundles**: `npm run compile` (runs `scripts/build.mjs` with `esbuild`)
- **Type check**: `npm run lint` (`tsc --noEmit`)
- **Fast unit tests**: `npm run test:unit` (runs `scripts/test-unit.cjs`; fast, isolated Node test runner, ~1.3s)
- **Full integration suite**: `npm test` (runs unit tests + headless VS Code Electron integration tests)
- **Pre-commit gate**: `npm run lint && npm run test:unit && npm run compile`

### Architecture Map
```
src/
├── extension.ts                   # Extension entry point, command registration, status bar
├── constants.ts                   # Command IDs, view types, and configuration keys
├── commands/
│   └── editorTerminal.ts          # Creates fresh native terminal in editor area
├── provider/
│   ├── terminalViewProvider.ts    # WebviewViewProvider, PTY lifecycle, tab title updates, IPC
│   ├── outputBuffer.ts            # Bounded output queue, backpressure flow control, batch ACKs
│   └── terminalConfig.ts          # Setting inheritance (terminal.integrated.*), profile & env resolution
├── ui/
│   └── statusBar.ts               # Status bar item controller
└── webview/
    ├── main.ts                    # Webview frontend (xterm.js, tabs, fit addon, keyboard nav)
    └── linkParser.ts              # Link coordinate detection (HTTP/S URLs & file:line:col)
scripts/
├── build.mjs                      # esbuild config (node/CJS for extension, browser/IIFE for webview)
└── test-unit.cjs                  # Node test runner for unit tests
```

### Invariants & Non-Negotiable Rules
1. **Coexistence over relocation**: Never reintroduce logic that moves or mutates VS Code's native bottom Terminal view or panel layouts.
2. **Private PTY isolation**: Side Terminal sessions are owned via `node-pty`. They are not native `vscode.Terminal` sessions and must never be registered in or assumed to exist in `vscode.window.terminals`.
3. **Strict flow control**: Never bypass `OutputBuffer`. PTY output must be bounded (256 KB max queue, 128 KB pause threshold, 64 KB resume threshold) and drained via batch acknowledgments (`outputAck`) to prevent UI freezes.
4. **Message validation**: All webview messages must validate session IDs, bounds (`cols <= 1000`, `rows <= 500`), string lengths, and payload shapes before execution.
5. **URL allowlisting**: Only `http:` and `https:` schemes may be opened externally via `vscode.env.openExternal`. Privileged schemes (`command:`, `file:`, `vscode:`) must be rejected.
6. **Agent terminal isolation**: Mirrored agent tabs (`secondaryTerminal.mirrorAgentTerminals`) are strictly read-only (`disableStdin: true`, `readOnly: true`). Closing an agent mirror tab only hides the view; it must never terminate the underlying source terminal.
7. **Tab title reflection**: Foreground process names take precedence over generic runtimes (`GENERIC_PROCESS_NAMES`: `node`, `python`, `sh`). Workspace directories, spinners (`[\u2800-\u28ff]`), and ellipsis-truncated titles must never overwrite running command titles.

---

## 2. Deferred On-Demand References

Load these files only when working on their specific subsystems:

- **Adding / modifying settings**:
  Inspect `package.json` (`contributes.configuration`) and test resolution in `src/provider/terminalConfig.ts` & `test/unit/terminalConfig.test.cjs`.
- **Modifying link parsing rules**:
  Inspect `src/webview/linkParser.ts` and verify with `test/unit/provider.test.cjs` (subtests covering POSIX, Windows drive letters, quoted spaces, and compiler patterns).
- **Modifying webview UI / xterm styling**:
  Inspect `media/style.css`, `src/webview/main.ts`, and test with the standalone browser fixture (`node test/browser/serve.cjs`).
- **Debugging Electron integration tests**:
  Inspect `test/runTest.ts`, `test/suite/extension.test.ts`, and the fixture workspace at `test/fixtures/workspace/`.
- **Packaging / release**:
  Inspect `.vscodeignore` and `scripts/build.mjs`. Minified output resides in `dist/`.
