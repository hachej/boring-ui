# workspace-playground

Tier 1 canary for `@boring/workspace`.

This app mounts `WorkspaceProvider`, `TopBar`, and `ChatLayout` directly.

Migration gotchas for the next apps:

- `ChatLayout` renders registered panel ids; app state must be passed as panel
  params when a stock panel needs sessions, a session id, or surface options.
- `ChatPanelHost` receives artifact-open and UI-bridge callbacks through panel
  params; canary apps own that wiring directly.
- `WorkspaceProvider` owns the command palette, so top-bar buttons should open
  it by dispatching the same `mod+k` keyboard event.
- Playwright should wait for visible chrome, not `networkidle`: the chat/UI
  bridge can keep long-lived requests open.
- The playground has no `@boring/core` wrapper; keep auth/config endpoints out
  of the boot path.
