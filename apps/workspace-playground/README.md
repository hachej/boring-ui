# workspace-playground

Tier 1 canary for `@boring/workspace`.

This app mounts `WorkspaceProvider`, `TopBar`, and `ChatLayout` directly
instead of the legacy `ChatCenteredShell`.

Migration gotchas for the next apps:

- `ChatLayout` renders registered panel ids; app state must be passed as panel
  params when a stock panel needs sessions, a session id, or surface options.
- `ChatPanelHost` still consumes `ChatShellContext` for artifact open hooks and
  UI bridge state, so canary apps must provide that bridge until Phase G deletes
  the centered-shell compatibility layer.
- `WorkspaceProvider` owns the command palette, so top-bar buttons should open
  it by dispatching the same `mod+k` keyboard event.
- Playwright should wait for visible chrome, not `networkidle`: the chat/UI
  bridge can keep long-lived requests open.
- The playground has no `@boring/core` wrapper; keep auth/config endpoints out
  of the boot path.
