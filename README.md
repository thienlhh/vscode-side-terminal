# Side Terminal

An independent sidebar terminal that runs alongside VS Code's built-in integrated terminal. Dock its view in the **Secondary Side Bar** to keep both available at once.

Side Terminal uses xterm and native PTYs (`node-pty`) for interactive shells, multiple tabs, ANSI output, resize, and clickable file/URL links. It operates independently: it does not move your built-in Terminal view, relocate other panels, or change global terminal settings.

> [!WARNING]
> **Early Development**: This extension is in active early development and is currently **only tested on macOS** (Apple Silicon / Intel). Windows and Linux support is experimental and has not yet been validated in live environments. Feedback and bug reports are welcome on [GitHub Issues](https://github.com/thienlhh/vscode-side-terminal/issues).

## Setup

1. Install the extension and reload VS Code.
2. Open **Side Terminal** from the Activity Bar.
3. Use the view's **Move View** menu to place it in the Secondary Side Bar.
4. Keep the built-in Terminal view in the bottom panel.

The extension requires Workspace Trust and a filesystem workspace. Its native PTY must be available for the host OS/architecture; failures are reported instead of falling back to a non-interactive pipe.

## Architecture & Reliability

- **Dedicated PTY Backend**: Side Terminal spawns owned PTY processes directly via `node-pty`. Sessions are private and not exposed via `vscode.window.terminals`.
- **Bounded Output & Backpressure**: Output is queued and acknowledged only after xterm parses each batch. The PTY automatically pauses when queued output reaches 128 KB and resumes when drained below 64 KB (max 256 KB queue limit), preventing renderer lockups under high-throughput output.
- **View Lifecycle & Replay**: Hiding or switching panels preserves running sessions. Recreating the webview view restores existing tab identities and replays unacknowledged batches and bounded recent history.
- **Dynamic Tab Titles**: Tab titles reflect the currently running foreground command (e.g., `codex`, `agy`, `git`, `npm`) or shell name when idle, with debouncing to prevent UI flicker on rapid sub-second commands.
- **Terminal File & Web Links**: Detects relative workspace paths, compiler formats (`file:line:col`), quoted paths, Windows drive letters, and HTTP/HTTPS URLs. Privileged URL schemes (`command:`, `file:`) are rejected.

## Settings

Appearance follows the corresponding `terminal.integrated.*` settings and editor font defaults. Existing `secondaryTerminal.*` appearance settings take precedence only when explicitly configured.

| Side Terminal override | Native setting |
| --- | --- |
| `cursorBlink` | `terminal.integrated.cursorBlinking` |
| `cursorStyle` | `terminal.integrated.cursorStyle` |
| `fontSize` | `terminal.integrated.fontSize` |
| `fontFamily` | `terminal.integrated.fontFamily` |
| `lineHeight` | `terminal.integrated.lineHeight` |
| `scrollback` | `terminal.integrated.scrollback` |

Validated ranges: font size 6–100 px, line height 1–3, scrollback 0–100,000 lines. Scrollback controls retained terminal history; separate bounded queues control incoming output.

Shell launch uses your configured native default profile, path, arguments, profile environment, platform terminal environment, and terminal working directory. `${env:NAME}`, `${userHome}`, and `${workspaceFolder}` substitutions are supported. For unsupported automatic/source-based profiles, configure an explicit executable path in `terminal.integrated.profiles.<platform>`.

## Commands & Keybindings

| Action | Command ID | macOS | Windows/Linux |
| --- | --- | --- | --- |
| Focus Side Terminal | `secondaryTerminal.show` | Cmd+Alt+T | Ctrl+Alt+T |
| Toggle Side Terminal | `secondaryTerminal.toggle` | — | — |
| Create Native Editor Terminal | `secondaryTerminal.openEditorTerminal` | Cmd+Alt+E | Ctrl+Alt+E |
| Previous/next tab | — | Alt+[ / Alt+] | Alt+[ / Alt+] |

The editor action creates a fresh native terminal in the editor area; it does not move the current side-terminal session.

## Coding Agents & Mirroring

Run interactive agent CLIs (e.g., `agy`, `codex`, `aider`) directly in a local Side Terminal tab as an owned interactive session.

`secondaryTerminal.mirrorAgentTerminals` optionally monitors recognized native agent terminals (Cline, Roo, Copilot, Antigravity, Claude, Codex, Aider):
- Mirrors are read-only and require VS Code 1.93+ with shell integration.
- They stream execution output and update tab titles on execution start/end.
- Closing a mirror tab hides the view without terminating the underlying native agent terminal.

## Explicit Limits & Boundaries

- **Early Platform Support**: Tested and validated exclusively on **macOS**. Windows (ConPTY) and Linux support is currently experimental.
- **Native Terminal Services**: Command decorations, task/debug terminal identity, shell integration terminal environment collections, and persistent session reconnects across VS Code window reloads are not provided.
- **Alternate Screen Replay**: Recreating a view replays bounded recent output; full-screen TUI apps (e.g., `vim`, `htop`) may require redrawing after view recreation.
- **Split Panes**: Multi-tab layout is supported; split panes within a tab are deferred.

## Development & Testing

Requires Node.js 18+.

- `npm run lint`: Type-checks codebase (`tsc --noEmit`).
- `npm run compile`: Builds extension and webview bundles using `esbuild`.
- `npm run watch`: Watches and rebuilds extension and webview during development.
- `npm run test:unit`: Runs isolated regression suite (33 tests covering backpressure flow control, PTY drain, link parsing, profile resolution, and tab title updates).
- `npm test`: Runs VS Code Electron integration test suite.
- `node test/browser/serve.cjs`: Launches standalone browser fixture to test webview rendering, accessibility, and high-throughput ANSI output independently.
- `npm run package`: Generates production minified bundles for VSIX packaging.
