# 03 — Workspace Pane

Phase 3. Add the tabbed workspace pane after plugin content pages and the app left pane are in place.

## Purpose

Workspace pane is a tabbed host for Files tabs and multi-pane plugin default panes.

```txt
┌────────────────────────────────────────────────────────────────────────────┐
│ [ AGENTS.md x ] [ Usage x ] [ PR Tracker x ] [ + ]             [⛶] [›]    │
├────────────────────────────────────────────────────────────────────────────┤
│ julien › gt › boring-ui-v2 › AGENTS.md                          [folder]  │
└────────────────────────────────────────────────────────────────────────────┘
```

No right plugin rail. No Dockview tabs in this layout.

## Empty workspace page

Closing the last workspace tab shows a dedicated page listing possible tab types. It must reuse the same registry source as the `+` picker.

```txt
┌────────────────────────────────────────────────────────────────────────────┐
│ Workspace                                                                  │
│                                                                            │
│ Open a tab                                                                 │
│  - File                                                                    │
│  - <multi-pane plugin default pane>                                        │
└────────────────────────────────────────────────────────────────────────────┘
```

## Tab model

```ts
export type WorkspaceTabKind = "files" | "plugin"
export type WorkspaceTabInstancePolicy = "single-pane" | "multi-pane"

export interface WorkspaceTab {
  id: WorkspaceTabId
  pluginId: string
  component: string
  title: string
  kind: WorkspaceTabKind
  params: Record<string, unknown>
  instancePolicy: WorkspaceTabInstancePolicy
  uiState?: WorkspaceTabUiState
}

export interface WorkspaceTabUiState {
  filetreeOpen?: boolean
  filetreeSide?: "left" | "right"
}
```

Tab IDs:

```txt
single-pane plugin: plugin:<pluginId>
Files tab instance: files:<sequence>
multi-pane plugin: plugin:<pluginId>:<sequence>
```

Files tab id is not the path because filetree click can replace the tab path/content.

## WorkspaceTabsController

Do not scatter tab behavior in component handlers.

```ts
type WorkspaceTabsAction =
  | { type: "openTab"; tab: WorkspaceTab }
  | { type: "activateTab"; tabId: WorkspaceTabId }
  | { type: "closeTab"; tabId: WorkspaceTabId }
  | { type: "updateParams"; tabId: WorkspaceTabId; params: Record<string, unknown> }
  | { type: "updateTitle"; tabId: WorkspaceTabId; title: string }
  | { type: "toggleFiletree"; tabId: WorkspaceTabId }
```

Close behavior:

```txt
closing active tab:
  activate nearest tab to left if present
  else nearest right
  else activeTabId = null + show empty workspace page

closing inactive tab:
  keep current active tab
```

## `+` picker

```txt
[ + ]
  File
  <multi-pane plugin default pane>
```

Rules:

```txt
- + opens dropdown
- + does not silently create tab
- lists Files and workspaceTab-enabled multi-pane plugins only
- single-pane plugins are not listed
- multi-pane plugin entry opens its default pane as a new tab
```

## Files tab

`+ > File` creates empty Files tab with filetree open on the left.

```txt
┌────────────────────────────────────────────────────────────────────┐
│ [ File x ] [ + ]                                                   │
├────────────────────────────────────────────────────────────────────┤
│ File                                                       [folder]│
├───────────────────────┬────────────────────────────────────────────┤
│ Filetree              │ Pick a file from this tab's filetree        │
│ README.md             │                                            │
│ AGENTS.md             │                                            │
└───────────────────────┴────────────────────────────────────────────┘
```

Filetree click:

```txt
if target file already open elsewhere:
  activate existing Files tab

else:
  auto-save dirty current file
  if save succeeds, replace current tab path/content
  if save fails, do not replace; show error/recoverable notice

always keep filetree open after successful click
```

Agent `openFile(path)`:

```txt
if path already visible in Files tab:
  activate that tab
else:
  create dedicated Files tab for that path
  filetree closed by default
```

## Workspace fullscreen

```txt
fullscreen enter:
  collapse chat region
  keep left pane visible if expanded
  if left pane collapsed, keep only top-left overlay icon

fullscreen exit:
  restore chat region
```

## Persistence

Workspace tabs persist per workspace id. See `05-state-persistence-routing.md`.

## Acceptance

```txt
[ ] One workspace tab strip
[ ] No persistent right plugin rail
[ ] + opens tab picker
[ ] Empty workspace page reuses picker data source
[ ] Files appears in picker
[ ] Multi-pane plugins appear in picker
[ ] Single-pane plugins do not appear in picker
[ ] Filetree defaults left inside Files tab
[ ] Folder button toggles active Files tab filetree
[ ] Filetree click activates existing tab if already open
[ ] Filetree click auto-saves dirty file before replacement
[ ] Closing last tab shows empty workspace page
[ ] Fullscreen keeps left pane behavior correct
```
