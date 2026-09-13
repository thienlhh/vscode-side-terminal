# Side Terminal: implementation contract

## Product requirement

An independent terminal in the Secondary Side Bar must remain available simultaneously with the built-in integrated terminal. Side Terminal must not move the built-in Terminal view, relocate other panel views, or change global terminal settings. Users can dock the extension view in the Secondary Side Bar.

Use xterm and an owned native PTY because the public VS Code API cannot embed the native terminal widget in an extension sidebar. Aim for native behavior where the platform permits it. Private side-terminal processes are not native `vscode.Terminal` sessions and cannot be discovered through native terminal APIs by other extensions.

## Required behavior

- Interactive PTY sessions support ANSI sequences, Unicode, resize, paste, and terminal-generated signals. If the PTY or selected shell cannot start, report the failure; never represent a pipe-backed process as an equivalent terminal.
- Hide/show preserves sessions. Recreating a view restores existing tab identities and bounded recent output. Extension disposal releases its subscriptions and owned processes. Native terminals belong to VS Code and their creating extensions.
- Output is batched and bounded. Acknowledgments come after xterm parses each batch, not merely after the webview receives it. Owned PTYs pause when the consumer falls behind. Mirrored output has a bounded queue and an explicit overflow indication.
- Appearance inherits applicable `terminal.integrated.*` settings and editor font defaults. Explicit `secondaryTerminal.*` appearance settings retain precedence. Font size, line height, and scrollback are validated and bounded.
- Shell launch follows configured `terminal.integrated.defaultProfile.<platform>` and path-based profiles, arguments, profile environment, `terminal.integrated.env.<platform>`, and `terminal.integrated.cwd`. Environment entries set to `null` are removed. Supported substitutions are `${env:NAME}`, `${userHome}`, and `${workspaceFolder}`. Unsupported profile sources/substitutions require an explicit path/configuration instead of silently choosing another shell.
- Relative file links resolve against workspace folders; nested paths and Windows drive letters preserve their path and trailing line/column coordinates.
- Webview messages are validated before privileged operations. Session operations use registered IDs. Only HTTP/HTTPS external URL navigation is permitted. Scripts use a nonce CSP and resources are limited to shipped assets.
- The extension requires a trusted filesystem workspace. No telemetry or external output collection is introduced.

## Agent mirroring

Mirroring is an optional output monitor. Each native terminal object receives a distinct ID; its name is a display label. Two terminals with the same name must not mix output or close each other. Turning mirroring off removes mirrors and stops forwarding active execution streams.

Only shell-integration execution output is available through the public API. That API is available on VS Code 1.93 and newer and requires shell integration to activate in the source terminal. VS Code 1.80 remains supported for local side-terminal sessions. Mirrored screens are read-only: native TUIs and prompts remain in the source terminal, whose dimensions and full screen state cannot be reproduced by this API.

## Explicit limits and deferred work

- Private PTYs do not inherit the complete native terminal service: command decorations, native task/debug-terminal identity, other extensions' terminal environment collections, and persistent-session reconnection across an extension-host restart are not provided.
- Bounded recent output replay is not an exact terminal screen snapshot; a long-running alternate-screen application may need to redraw after view recreation.
- Automatic shell/profile discovery, all VS Code substitution variables, and arbitrary source-based profiles are not guaranteed. Configure a path-based profile for unsupported cases.
- The editor-terminal action creates a fresh native terminal; it does not transfer an existing side-terminal process.
- Split panes, full native persistence, and deeper native agent-extension integrations are deferred until the simultaneous-terminal baseline is validated.

## Validation gates

1. Clean locked install, dependency consistency, type checking, builds, and both watch targets pass.
2. Isolated regressions cover lifecycle, unique IDs, message validation, mirroring toggles, output bounds/acknowledgments, settings/profile resolution, and file links.
3. A real PTY check covers resize, Unicode, alternate-screen output, and Ctrl+C on the validation host.
4. VS Code integration checks confirm commands, editor-terminal creation, navigation, and side-terminal coexistence without changing the native terminal collection.
5. Browser QA checks the actual bundled xterm frontend, tab lifecycle, rendering, keyboard controls, resize, and sustained output. Cross-platform live agent acceptance remains separately evidenced.

Current evidence and remaining manual gates are recorded in `docs/VALIDATION.md`.
