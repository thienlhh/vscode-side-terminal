# Side Terminal Validation

This document records the verification results, evidence, and remaining platform acceptance gates for the Side Terminal extension.

## 1. Automated Verification Gates

### Gate 1: Type Checking & Code Quality
- **Command:** `npm run lint` (`tsc --noEmit`)
- **Status:** PASSED
- **Evidence:** Clean compilation with 0 errors and 0 warnings under strict TypeScript settings.

### Gate 2: Build & Packaging
- **Command:** `npm run package`
- **Status:** PASSED
- **Artifacts:**
  - `dist/extension.js` (minified CommonJS bundle for Node extension host)
  - `dist/webview.js` (minified IIFE bundle for webview browser runtime)
  - `dist/xterm.css` (bundled terminal stylesheet)

### Gate 3: Unit & Regression Suite
- **Command:** `npm run test:unit` (`node scripts/test-unit.cjs`)
- **Status:** PASSED (24/24 tests)
- **Coverage Areas:**
  - **Output Buffer & Backpressure:**
    - Batching and sequenced ACKs (`outputAck`).
    - Bounded queue limits (256 KB max, 128 KB pause, 64 KB resume).
    - Unacknowledged batch replay across webview recreation.
    - Surrogate-pair preservation during batch slicing and truncation.
  - **PTY Lifecycle & Real PTY Drain:**
    - Real PTY sustained drain (8 MiB drained through bounded flow control with zero dropped bytes).
    - Terminal resize, Unicode strings (`日本語 🚀`), alternate screen buffer, and Ctrl+C interrupt signals.
  - **Terminal Link Parser:**
    - Relative/nested POSIX paths with `:line[:col]` coordinates.
    - Absolute Windows drive paths (e.g. `C:\repo\src\main.ts:42:7`).
    - Quoted paths with spaces and zero-padded line/column numbers.
  - **Settings & Profile Resolution:**
    - Inheritance from `terminal.integrated.*` unless overridden by `secondaryTerminal.*`.
    - Sanitized bounds for font size, line height, and scrollback.
    - Variable expansion (`${workspaceFolder}`, `${userHome}`, `${env:*}`).
    - Safe handling of `null` or missing profile/environment settings in `settings.json`.
  - **Provider & Security:**
    - Rejection of untrusted workspace shells when Workspace Trust is not granted.
    - Restriction of clipboard paste to local sessions (agents are read-only).
    - Allowlisting of URL navigation (`http`/`https` only; `command:` and `file:` schemes rejected).
    - Agent terminal discovery, separation of same-name agent sessions, and clean stream cancellation when mirroring is disabled.

### Gate 4: VS Code Integration Test
- **Command:** `npm test`
- **Status:** PASSED
- **Evidence:** Verified command registration (`secondaryTerminal.show`, `secondaryTerminal.toggle`, `secondaryTerminal.openEditorTerminal`), native terminal coexistence, and editor file link navigation in an isolated Electron test host.

---

## 2. Browser QA Fixture

A standalone QA fixture is provided at `test/browser/serve.cjs` to test the shipped webview bundle independently:
- **Run:** `node test/browser/serve.cjs`
- **Covers:**
  - DOM rendering and accessibility (`role="tab"`, screen reader mode).
  - High-throughput ANSI output stress testing.
  - Multi-tab management, switching, and keyboard navigation (`Alt+[` / `Alt+]`).
  - Large clipboard paste chunking and surrogate-pair preservation.

---

## 3. Platform & Agent Acceptance Checklist

| Environment / Feature | Status | Notes |
| :--- | :--- | :--- |
| **macOS (Darwin x64 / arm64)** | Verified | Primary development and validation environment. |
| **Linux (x64)** | Verified via unit tests | Profile resolution defaults to `/bin/bash` or `os.userInfo().shell`. |
| **Windows (win32)** | Verified via unit tests | Case-insensitive environment deletion and PowerShell/cmd profile detection verified in unit suites. |
| **Native Coexistence** | Verified | Native terminal list (`vscode.window.terminals`) remains unaffected by Side Terminal PTYs. |
| **Shell Integration (VS Code 1.93+)** | Verified | Stream reading gracefully skips on VS Code < 1.93; agent output streaming verified on 1.93+. |
| **AI Agent Terminal Monitors** | Verified | Read-only tabs created for detected agent sessions (Cline, Roo, Copilot, Antigravity, Claude, Codex, Aider). |
