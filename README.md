# Side Bar Terminal for VS Code & Antigravity

A dedicated, high-performance Side Bar Terminal extension that runs independently from the bottom panel terminal, featuring multi-tab management, live interactive shell sessions, and an **Agent Bridge** to mirror and interact with AI coding agents (Cline, Roo Code, Copilot, Antigravity).

---

## Key Features

- 🖥️ **Independent Side Bar Terminal**: Lives in its own sidebar view container without moving or touching your bottom panel terminal.
- 📑 **Full Tab Management**: Create multiple terminal tabs (`Terminal 1`, `Terminal 2`), switch between them, and close them with one click.
- 🤖 **AI Agent Bridge**: Automatically detects terminals spawned by AI coding agents, mirrors them as tabs (`🤖 <Agent Name>`), and streams command output in real time.
- ⚡ **Native Shell Support**: Powered by `node-pty` and `@xterm/xterm` with full ANSI color support, resizing, and bash/zsh shell prompts.
- 🔘 **One-Click Shortcuts**: `Cmd + Alt + T` (macOS) or `Ctrl + Alt + T` (Windows/Linux) instantly focuses and reveals the side terminal.

---

## Keyboard Shortcuts

| Command | macOS | Windows / Linux | Description |
| :--- | :--- | :--- | :--- |
| `secondaryTerminal.toggle` | `Cmd + Alt + T` | `Ctrl + Alt + T` | Focus / Reveal Side Bar Terminal |
| `secondaryTerminal.openEditorTerminal` | `Cmd + Alt + E` | `Ctrl + Alt + E` | Open Terminal in Editor Area |

---


---

## Configuration Settings

Customize the Side Bar Terminal in your settings (`Cmd + ,` -> search `Side Terminal` or `secondaryTerminal`):

| Setting | Default | Options / Description |
| :--- | :--- | :--- |
| `secondaryTerminal.cursorBlink` | `true` | Controls whether the terminal cursor blinks. |
| `secondaryTerminal.cursorStyle` | `"block"` | `"block"`, `"underline"`, or `"bar"`. |
| `secondaryTerminal.fontSize` | `12` | Font size in pixels. |
| `secondaryTerminal.fontFamily` | `"Menlo, Monaco, ..."` | Custom terminal font family. |
| `secondaryTerminal.lineHeight` | `1.2` | Line height relative to font size. |
| `secondaryTerminal.scrollback` | `5000` | Maximum scrollback lines retained. |
| `secondaryTerminal.mirrorAgentTerminals` | `true` | Automatically mirror AI agent terminals into the side terminal. |

## Installation & Setup

1. In VS Code / Antigravity, reload the window (`Cmd + Shift + P` -> `Developer: Reload Window`).
2. Look for the **Terminal icon** in your Activity Bar (or Secondary Side Bar).
3. You can drag the icon or view into the **Secondary Side Bar** (right side) to pin it there permanently.
4. Press **`Cmd + Alt + T`** to open and focus it immediately!
