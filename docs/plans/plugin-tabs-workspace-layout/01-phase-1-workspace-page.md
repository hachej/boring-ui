# Phase 1 — Workspace Page Plugin Panels

Status: implementation checklist

## Goal

Ship the smallest production slice for full-page plugin UI without building the future app-left-pane or workspace-tab system.

```txt
workspace-page = regular plugin React page
phase 1 host = existing shared Dockview/workbench content
open/activate behavior = auto-collapse the current workbench left sources pane
```

## Non-goals

```txt
[ ] no app-level left pane
[ ] no top-level workspace tabs
[ ] no marketplace / installed plugins page
[ ] no PluginPageShell requirement
[ ] no plugin-owned Dockview framework
[ ] no filetree extraction
```

## Todo

```txt
[x] Add public panel placements: workspace-page and shared-dockview
[x] Keep Files/filetree as an internal workspace-source panel, not public leftTabs
[x] Remove leftTabs/registerLeftTab from the public front plugin API
[x] Route workspace-page panels through the current shared Dockview host
[x] Auto-collapse the current workbench left pane when workspace-page opens or becomes active
[x] Keep shared-dockview/center panels in the shared Dockview without auto-collapse
[x] Add surface resolver metadata fields for agent-visible UI capabilities
[x] Expose availableSurfaces in get_ui_state
[x] Update Data Catalog builder to emit workspace-page instead of leftTabs, with workspacePage* aliases
[x] Add focused tests for capture/bootstrap/runtime payloads and workspace-page collapse behavior
[x] Run workspace typecheck/tests
```

## Future phases

```txt
[ ] app/session left pane
[ ] top-level workspace tabs
[ ] 1 workspace tab = 1 plugin instance
[ ] Files tab owns filetree
```
