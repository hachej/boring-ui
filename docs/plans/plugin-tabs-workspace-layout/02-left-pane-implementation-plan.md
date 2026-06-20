# Phase 2 — App Left Pane Implementation Plan

## Scope

Implement the Phase 2 app/session left pane as an opt-in workspace shell for the existing `WorkspaceAgentFront`.

- Public opt-in prop: `workspaceLayout="plugin-tabs"`.
- Default remains classic layout with existing `TopBar` + `ChatLayout` session drawer behavior unchanged.
- Phase 2 owns app/session navigation only: New chat, Search, Plugins, Skills, pinned sessions, regular sessions, collapse/expand.
- No workspace tab system, filetree ownership changes, plugin pane state model, panel params model, or `SurfaceShell` behavior rewrite.

## Architecture

### 1. Add a sibling plugin-tabs shell, not a mutation of classic

Create small layout components under workspace front code:

- `PluginTabsWorkspaceShell`
  - Renders the optional `AppLeftPane` beside existing main content.
  - When collapsed, renders no left pane or icon rail; only an absolute overlay button to restore it.
  - Receives the already-constructed main content node from `WorkspaceAgentFront`.
- `AppLeftPane`
  - Pure app/session navigation.
  - Uses existing session actions from `WorkspaceAgentFront`.
  - Uses registry read-only access only to find a workspace-page panel for the Plugins button.

Classic render path stays byte-for-byte equivalent except for extracting the current `ChatLayout` node into a local variable.

### 2. Keep ChatLayout responsible for chat/workbench mechanics

For `workspaceLayout="plugin-tabs"`:

- Do not render the classic `TopBar`.
- Do not enable the classic session drawer (`nav={null}`, no `onOpenNav`) to avoid duplicate session navigation.
- Suppress ChatLayout's classic left-edge session controls too: omit `onCreateChatPaneAfter` in plugin-tabs mode so the legacy floating `New chat` edge button cannot duplicate the app-left-pane New chat action. Session split/open remains available from the app-left-pane session rows.
- Continue using `ChatLayout` for chat panes, collapse chat, workbench open/close, surface queueing, and Dockview mechanics.
- Continue using `SurfaceShell` unchanged.

### 3. Session semantics

Rows compute a simple state:

```ts
type SessionRowState = "normal" | "open" | "active"
```

- `active`: `session.id === activeChatPaneId`.
- `open`: session is in `chatPaneIds` but not active.
- `normal`: otherwise.

Click behavior:

- active row: no-op.
- open inactive row: call `switchToChatPane(id)` to activate existing pane.
- normal row: call `switchToChatPane(id)` to replace/switch the current primary pane.
- split/open icon: call `openChatPane(id)`; existing panes focus/flash via existing parent logic.
- pin/unpin: call `toggleSessionPinned(id)` and stop propagation.

### 4. Primary actions

- New chat: call `resolvedCreate()`; existing parent logic decides local vs remote session creation.
- Search: open the existing command palette and extend that same palette with a plugin-tabs-only `Chat session search` section. Do not introduce a second palette. Result click calls `switchToChatPane(id)`; the row split/open affordance calls `openChatPane(id)`.
- Plugins: open/focus the current workspace/plugin content area without introducing a plugin catalog/list. Resolve "current" in this order:
  1. active open tab whose registered component is a non-core `workspace-page` panel,
  2. most recently open non-core `workspace-page` tab from the surface snapshot,
  3. first registered non-core `workspace-page` panel,
  4. otherwise just open the workbench area.
  Opening uses the same parent surface-open + pending-operation queue path used by UI command dispatch so closed/unready surfaces do not drop the request.
- Skills: add one small `workspace:skills` workspace-page panel only to the plugin-tabs render path by appending it to `WorkspaceAgentFront`'s `panels` prop when `workspaceLayout="plugin-tabs"`. It must not be part of `coreWorkspacePanels`, so classic workbench rails stay unchanged. The panel fetches `/api/v1/agent/skills` through `WorkspacePluginClient.getJson()` and displays the same endpoint data used by slash-command skill discovery. The left-pane Skills item opens/focuses this panel.

### 5. Plugin client extension

Add `getJson<T>(path)` to `WorkspacePluginClient`, using the same path/base validation, auth headers, workspace header/query handling, credentials, and response error behavior as `postJson`.

### 6. Persistence and collapsed overlay

- Reuse existing shell storage namespace.
- Add one boolean: `${shellStorageKey}:appLeftPaneCollapsed`.
- Do not persist app-left-pane selected primary action in Phase 2.
- Collapsed means the `<aside data-boring-workspace-part="app-left-pane">` is not rendered at all; no rail and no reserved width.
- Render exactly one restore control for app navigation. Position it on a small top-left overlay but offset below Dockview/tab headers (e.g. `top: 52px; left: 8px`) with a tight hitbox so it does not cover the first workspace/chat tab activation or close target. The workbench's own collapsed-source restore control remains inside `SurfaceShell`; this PR must not stack another control directly on top of that header area.

### 7. Tests

Add focused tests for:

- Default classic layout still renders the classic top bar/session drawer path and does not register/show the plugin-tabs Skills workspace page.
- `workspaceLayout="plugin-tabs"` renders the app left pane, primary actions, no Projects/Codex/Automations items, and no duplicate classic left-edge `New chat` floating control.
- Collapse removes the pane entirely and shows only the app-navigation restore overlay control, with no collapsed app-left-pane rail in the DOM.
- Session row states distinguish active/open/normal and pin/split controls do not accidentally switch via propagation.
- Search opens the existing command palette with a `Chat session search` section; selecting a session calls `switchToChatPane`, and the split icon calls `openChatPane`.
- Plugins opens/focuses active/last/fallback non-core workspace-page panels through the existing workbench/surface path.
- Skills opens the plugin-tabs-gated Skills workspace-page and fetches `/api/v1/agent/skills` with workspace scoping.
- `WorkspacePluginClient.getJson()` rejects unsafe paths and forwards workspace/auth context.

## Non-goals / guardrails

- Do not edit `SurfaceShell` except if strictly needed for a bug found by tests; current plan expects zero `SurfaceShell` changes.
- Do not change `WorkbenchLeftPane` ownership semantics.
- Do not add workspace tabs in this PR.
- Do not add plugin marketplace/catalog/list in this PR.
- Do not make `plugin-tabs` the default layout.
- Do not import `@hachej/boring-agent` from workspace front/shared code beyond existing `WorkspaceAgentFront` usage.
