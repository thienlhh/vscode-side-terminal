# Technical Specification: Side Bar Terminal for VS Code & Antigravity (v0.2.5)

## 1. Overview
Side Bar Terminal provides an independent terminal environment inside the Secondary Side Bar (Auxiliary Bar) of VS Code and Antigravity IDE. It runs alongside the native bottom panel terminal without relocating or interfering with existing panels, offering multi-tab management, live interactive shells, and an AI Agent Bridge.

---

## 2. Implemented Architecture & Features (v0.2.5)

### 2.1 View & Container Architecture
- **Webview View Container**: Registered as `secondary-terminal-container` in the Activity Bar with view ID `secondary-terminal.view`.
- **Docking Flexibility**: Defaults to Activity Bar; users can drag and pin it into the Secondary Side Bar (right-hand auxiliary bar).
- **Native Bottom Terminal Isolation**: Zero calls to `workbench.action.movePanelToSecondarySideBar`, keeping bottom panel terminals (Output, Problems, Debug, standard shells) 100% untouched.

### 2.2 Shell Engine & PTY Management
- **Native PTY Backend**: Backed by `node-pty` with automatic permission normalization on macOS (`chmod 0o755` on `prebuilds/darwin-*/spawn-helper`).
- **Graceful Fallback**: Automatically falls back to `child_process.spawn` if native bindings are unavailable.
- **Frontend Terminal**: Emulated using `@xterm/xterm` (v6.0) with `@xterm/addon-fit`.
- **Bidirectional Streaming**: Handles raw keystrokes, signals (`Ctrl+C`, `Ctrl+D`), window resizing (`cols`/`rows`), and ANSI escapes.

### 2.3 Multi-Tab Lifecycle & Navigation
- **Contiguous Tab Indexing**: Generates sequential names (`Terminal 1`, `Terminal 2`) and reuses the lowest available index when tabs are closed.
- **View Header & Badge Sync**: Dynamically updates the sidebar view description and badge counter to match the count of active open tabs.
- **Visual Tab Bar**: Compact, theme-integrated tab bar with active indicator, close buttons (`×`), and a new tab button (`+`).

### 2.4 Theme Awareness & Dynamic Configuration
- **Live Theme Synchronization**: Listens to VS Code theme changes via `MutationObserver` on `document.body` classes (`vscode-dark`, `vscode-light`, `vscode-high-contrast`) and `vscode.window.onDidChangeActiveColorTheme`. Extracts CSS variables to dynamically style background, foreground, selection, and all 16 ANSI color registers.
- **Tab Hover Contrast**: Theme tokens (`--vscode-tab-hoverForeground`, `--vscode-tab-hoverBackground`) prevent hover text fade-out.
- **Dynamic Configuration Dispatch**: Updates to `secondaryTerminal.*` settings dispatch immediately across all active tabs without shell restarts:
  - `secondaryTerminal.cursorBlink` (`boolean`, default: `true`)
  - `secondaryTerminal.cursorStyle` (`"block"` | `"underline"` | `"bar"`, default: `"block"`)
  - `secondaryTerminal.fontSize` (`number`, default: `12`)
  - `secondaryTerminal.fontFamily` (`string`, default: `"Menlo, Monaco, 'Courier New', monospace, Consolas"`)
  - `secondaryTerminal.lineHeight` (`number`, default: `1.2`)
  - `secondaryTerminal.scrollback` (`number`, default: `5000`)
  - `secondaryTerminal.mirrorAgentTerminals` (`boolean`, default: `true`)

### 2.5 Cursor Sequence Interception & State Guarding
- **DECSCUSR Interceptor (`CSI Ps SP q`)**: Overrides xterm's default handler (`params[0] || 1`) which erroneously treated reset `0` as blinking block `1`. Parameter `0` now strictly restores user settings, and blinking is locked to `false` when disabled in configuration.
- **DEC Mode 12 Interceptor (`CSI ? 12 h`)**: Blocks escape sequences requesting cursor blinking when `cursorBlink: false`.
- **Runtime Options Guard**: Monitors `term._core.optionsService.onOptionChange` to ensure background CLI tools (such as `agy` or ratatui applications) cannot force cursor blinking.

### 2.6 AI Agent Bridge
- **Selective Shell Filtering**: Inspects `vscode.window.onDidOpenTerminal` and ignores standard interactive shells (`zsh`, `bash`, `fish`, `pwsh`, `tmux`, etc.).
- **Agent Recognition**: Automatically discovers and mirrors terminals created by AI coding agents (Cline, Roo Code, Copilot, Antigravity) with prefix `🤖 <Agent>`.
- **Execution Streaming**: Streams command output via `vscode.window.onDidStartTerminalShellExecution` into dedicated agent tabs.

---

## 3. Limitations When Running Coding AI Agents & Mitigation Strategies

| Area | Technical Limitation | Mitigation Approach |
| :--- | :--- | :--- |
| **Column Width & TUI Layouts** | Secondary Side Bar is narrow (300–450px / ~40–60 columns). Rich terminal UIs (`agy`, `claude`, `codex`, `aider`) that display side-by-side git diffs, wide tables, or box borders experience line wrapping and visual clipping. | **1.** Use `Cmd + Alt + E` (`secondaryTerminal.openEditorTerminal`) to open a full-width terminal in the editor area beside your code when reviewing extensive diffs.<br>**2.** Configure CLI tools to use linear/unified diffs (e.g., `git config --global diff.noprefix true`, or tool-specific single-column flags). |
| **Input Forwarding vs. Raw TTY Interactivity** | When mirroring external agent extension terminals (Cline, Roo Code), input is routed via `terminal.sendText()`. This sends line-buffered text and cannot convey low-level raw key events (arrow keys, interactive curses menus, hotkey signals). | **1.** Run the agent's CLI directly inside a native Side Terminal tab (which has a full PTY backing) rather than relying on extension mirroring if interactive menu control is needed.<br>**2.** Keep input prompts in agent configurations set to non-interactive or automated confirmation mode where available. |
| **File Path Navigation & Links** | Unlike native VS Code terminals, Webview terminals do not automatically resolve stack traces or file paths (`src/file.ts:42:10`) to clickable links that jump to editor lines. | **1.** Implement a custom xterm `LinkProvider` via `@xterm/addon-web-links` or regex pattern matchers that message the extension host to call `vscode.workspace.openTextDocument()`.<br>**2.** For standard URLs (`http://`, `https://`), xterm link addons can open them directly. |
| **Shell Integration Decorations** | Native VS Code terminals inject custom shell integration scripts for command status markers, exit code gutter glyphs, and sticky headers. The Side Terminal PTY runs a raw user shell. | **1.** Individual commands are tracked by tab separation.<br>**2.** Optional future enhancement: inject standard OSC 133 shell integration sequences into the PTY session. |
| **Split Panes** | Native terminal panels allow splitting terminals horizontally and vertically within the same view. Side Terminal only supports tabs. | Use multiple tabs (`Terminal 1`, `Terminal 2`) and switch via tab clicks or keybindings. Split views in narrow sidebars cause extreme column compression. |
| **Webview Lifecycle & Throttling** | When the sidebar is collapsed or moved offscreen, VS Code throttles the webview DOM rendering. | Background Node PTY processes remain alive in the extension host. When the sidebar is reopened, `switchTab()` triggers `fitAddon.fit()` and re-focuses the terminal automatically. |
| **Memory Footprint with Deep Scrollback** | Keeping multiple tabs with high scrollback history (10,000+ lines) stores ANSI buffers in webview DOM memory. | Adjust `secondaryTerminal.scrollback` in settings (default: 5000 lines) to balance history needs with memory usage. |

---

## 4. Verification & Testing

- **Mocha Unit & Integration Tests**: Validates command registration, tab creation, and editor placement (`npm test`).
- **Compilation & Type Checking**: Verified clean builds with `tsc --noEmit` and `esbuild`.
- **End-to-End Packaging**: Packaged via `@vscode/vsce package` and tested inside Antigravity IDE (`v0.2.5`).
