# workspace-playground

Tier 1 canary for `@boring/workspace`.

This app mounts `WorkspaceProvider`, `TopBar`, and `ChatLayout` directly.
It also installs the reusable workspace data catalog plugin in
`src/plugins/playgroundDataCatalog/`, giving the workbench a Data tab, a
command-palette catalog, a center visualization panel, and a DuckDB-backed
`execute_sql` agent tool over the demo CSV fixtures without app-specific
workbench code.

Migration gotchas for the next apps:

- `ChatLayout` renders registered panel ids; app state must be passed as panel
  params when a stock panel needs sessions, a session id, or surface options.
- `ChatPanelHost` receives artifact-open and UI-bridge callbacks through panel
  params; canary apps own that wiring directly.
- `WorkspaceProvider` owns the command palette, so top-bar buttons should open
  it by dispatching the same `mod+k` keyboard event.
- Child apps should compose reusable plugin outputs inside their own domain
  plugins. `boring-macro-v2` can install the same data catalog base, then add
  its chart/deck panels and macro-specific server tools around it.
- Playwright should wait for visible chrome, not `networkidle`: the chat/UI
  bridge can keep long-lived requests open.
- The playground has no `@boring/core` wrapper; keep auth/config endpoints out
  of the boot path.
