# Changelog

All notable changes to the "Side Terminal" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.7] - 2026-09-13

### Added
- Open VSX version and repository license status badges in README.
- Extension release changelog (`CHANGELOG.md`).

## [0.2.6] - 2026-09-13

### Added
- **Flow Control & Backpressure (`OutputBuffer`)**: Bounded output queue (256 KB max capacity, 128 KB pause threshold, 64 KB resume threshold) with sequenced client acknowledgments (`outputAck`) and surrogate-pair preservation to prevent webview freezes under high output throughput.
- **Enhanced Link Detection**:
  - Multi-line wrap reconstruction in webview to preserve and highlight links spanning wrapped terminal lines.
  - Support for compiler error patterns (`file:line:col`, trailing colons, parenthesized coordinates like `tsc` and C#).
  - Support for dotfiles, extensionless build files, and GitHub line anchors (`#L1-L10`).
  - Host path resolution supporting home tilde expansion (`~/`), Git Bash / WSL drive syntax, and recursive workspace fallback search.
  - Strict external URL scheme allowlist (HTTP/HTTPS only; privileged schemes like `command:` and `file:` are rejected).
- **Configuration & Appearance Inheritance**:
  - Automatic inheritance of native `terminal.integrated.*` settings (font family, font size, line height, cursor blink, cursor style, scrollback).
  - Shell profile and platform environment resolution with `${env:NAME}`, `${userHome}`, and `${workspaceFolder}` variable expansion.
- **Dynamic Tab Titles**:
  - Reflect active foreground command names (e.g., `git`, `npm`, `codex`, `agy`) or shell name when idle.
  - Filter out raw OSC noise, path titles, directory paths, and spinner characters.
- **AI Agent Terminal Monitoring**:
  - Read-only mirroring for recognized native agent terminals (Cline, Roo, Copilot, Antigravity, Claude, Codex, Aider).
  - Mirrored tab closure hides the view without terminating the underlying source terminal.
- **View Lifecycle & State Restoration**:
  - Sessions persist across view hide/show. Recreated webviews restore tab states and replay unacknowledged batches and bounded recent history.
  - Tab navigation shortcuts (`Alt+[` and `Alt+]`).
- **Testing & Tooling**:
  - Fast isolated Node.js test runner (`npm run test:unit`) with comprehensive regression test suite.
  - Standalone browser test fixture (`node test/browser/serve.cjs`) for independent webview UI and ANSI rendering testing.

### Changed
- Prepared manifest and packaging for Open VSX publication under `thienle/side-terminal`.
- Refactored link parsing into table-driven coordinate patterns and unified webview range mapping.

## [0.2.5] - 2026-09-13

### Added
- Initial release of Side Bar Terminal extension.
- Dedicated Webview container with independent PTY backend (`node-pty`).
- Multi-tab lifecycle with contiguous indexing and status bar integration.
- Live VS Code theme awareness and runtime settings sync.
- Terminal cursor sequence interception (`DECSCUSR` and DEC mode 12).
- Native editor terminal command (`secondaryTerminal.openEditorTerminal`).
