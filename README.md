# Side Terminal

An independent sidebar terminal that runs alongside VS Code's built-in integrated terminal. Dock its view in the **Secondary Side Bar** to keep both available at once.

Side Terminal uses xterm and native PTYs for interactive shells, multiple tabs, ANSI output, resize, and clickable file/URL links. It does not move your built-in Terminal view or change your global terminal settings.

## Setup

1. Install the extension and reload VS Code.
2. Open **Side Terminal** from the Activity Bar.
3. Use the view's **Move View** menu to place it in the Secondary Side Bar.
4. Keep the built-in Terminal view in the bottom panel.

The extension requires Workspace Trust and a filesystem workspace. Its native PTY must be available for the host OS/architecture; failures are reported instead of falling back to a non-interactive pipe.

## Settings

Appearance follows the corresponding `terminal.integrated.*` settings and editor font defaults. Existing `secondaryTerminal.*` appearance settings take precedence only when you explicitly configure them.

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

## Commands

| Action | macOS | Windows/Linux |
| --- | --- | --- |
| Focus Side Terminal | Cmd+Alt+T | Ctrl+Alt+T |
| Create a native editor terminal | Cmd+Alt+E | Ctrl+Alt+E |
| Previous/next side tab | Alt+[ / Alt+] | Alt+[ / Alt+] |

The editor action creates a fresh native terminal. It does not move the current side-terminal session.

## Coding agents

Run interactive agent CLIs directly in a local Side Terminal tab. They use the owned PTY; other extensions cannot discover these private processes through `vscode.window.terminals`.

`secondaryTerminal.mirrorAgentTerminals` optionally monitors recognized native agent terminals. Mirrors are read-only and require VS Code 1.93+ with working shell integration. They show execution output, not a synchronized native terminal screen. Use the original terminal for interactive prompts and TUIs.

Closing a monitor hides its tab and leaves the source session running.

Native command decorations, task/debug integration, and reconnection across extension-host restarts are not implemented. See [SPEC.md](SPEC.md) for the contract and deferred capabilities.

## Development

Use Node.js 18 or newer. Run `npm ci`, then `npm run lint`, `npm run compile`, and `npm test`. `npm run watch` rebuilds both extension and webview. `npm run package` produces minified bundles; `vscode:prepublish` invokes it when packaging a VSIX.

Tests include isolated regressions, a real PTY smoke check, and VS Code integration checks. See [validation evidence](docs/VALIDATION.md) for results and remaining platform/agent checks.
