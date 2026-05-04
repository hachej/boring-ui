# UI primitives refactor progress

Goal: centralize generic shadcn-style primitives in `@boring/ui`, then consume them from agent/workspace/core/app surfaces so generated panes can rely on stable primitives instead of bespoke package-local UI.

## Scope

- Move duplicated primitives to `@boring/ui` when generic and package-independent.
- Keep domain/product components in their owning packages.
- Preserve existing package import paths by re-exporting from local wrappers first.
- Avoid consumer `@source` leaks; package CSS scans explicit `@boring/ui` primitive source files only.

## Checklist

### Move generic duplicated primitives

- [x] Button
- [x] Badge
- [x] Input
- [x] Textarea
- [x] Separator
- [x] Tooltip
- [x] Dialog
- [x] DropdownMenu
- [x] Select
- [x] Command
- [x] Tabs
- [x] HoverCard
- [x] Collapsible
- [x] ButtonGroup
- [x] InputGroup
- [x] Card
- [x] Label
- [x] Checkbox
- [x] AlertDialog
- [x] Popover
- [x] ScrollArea
- [x] Sheet

### Add shared atoms

- [x] IconButton
- [x] Kbd
- [x] Spinner
- [x] EmptyState
- [x] ErrorState
- [x] Panel primitives (`Pane`, `PaneHeader`, `PaneTitle`, `PaneBody`, `PaneFooter`, `PaneToolbar`)
- [x] Form/field primitives
- [x] StatusBadge
- [x] Notice / callout primitive

### Consume primitives / reduce bespoke UI

- [x] Core `AppErrorBoundary`
- [x] Workspace `ConflictBanner`
- [x] Workspace `EmptyPane`
- [x] Workspace `PanelErrorBoundary`
- [x] Workspace `TopBar`
- [x] Workspace `FileTreeView` context menu
- [x] Workspace `WorkbenchLeftPane` tabs/search controls
- [x] Agent `ModelPicker`
- [x] Agent `DebugDrawer`
- [x] Agent bare primitives cleanup
- [x] Agent `ChatPanel` generic action cleanup

### Simplification / no-retro cleanup

- [x] Replace core `@boring/workspace/ui-shadcn` imports with `@boring/ui`
- [x] Remove workspace `ui-shadcn` public export and build entry
- [x] Remove package-local wrapper files for primitives moved to `@boring/ui`
- [x] Promote remaining generic agent primitives (`button-group`, `input-group`, `collapsible`, `hover-card`) to `@boring/ui` and consume direct imports

### Required self-review loops

Each loop asks: **what can be simplified? what can be moved to `@boring/ui`? what can be better engineered for future self-modifying panes/plugins?**

- [x] Self-review loop 1 — import scan: removed `@boring/workspace/ui-shadcn`; remaining agent-local imports are only package-specific `button-group`/`input-group`.
- [x] Self-review loop 2 — move scan: moved remaining generic workspace primitives (`Card`, `Label`, `Checkbox`, `AlertDialog`, `Popover`, `ScrollArea`, `Sheet`) into `@boring/ui`.
- [x] Self-review loop 3 — wrapper scan: removed package-local compatibility wrapper files for moved primitives and removed workspace public `ui-shadcn` export/build artifacts.
- [x] Self-review loop 4 — consumer scan: identified next simplification targets (`FileTreeView`, `WorkbenchLeftPane`, `SurfaceShell`, `DebugDrawer`, bare primitives) that still have raw controls/inline style.
- [x] Self-review loop 5 — generated-pane engineering scan: `@boring/ui` now exports pane/field/status/error/empty primitives for future agent-authored panes/plugins; remaining work is domain component migration rather than primitive availability.

## Validation log

- 2026-05-03: baseline `@boring/ui` smoke tests, agent/workspace builds/typechecks passed before this follow-up.
- 2026-05-03: moved Tooltip/Dialog/DropdownMenu/Select/Command/Tabs to `@boring/ui`; added shared atoms and migrated first core/workspace/agent consumers.
- 2026-05-03: moved Card/Label/Checkbox/AlertDialog/Popover/ScrollArea/Sheet to `@boring/ui`; removed workspace `ui-shadcn` public export and package-local compatibility wrappers.
- 2026-05-03: migrated WorkbenchLeftPane to `Tabs`/`Input`/`IconButton`, DebugDrawer to `Tabs`/`IconButton`, FileTreeView context actions to shared `Button`, and ChatPanel actions to `Button`/`IconButton`.
- 2026-05-04: promoted HoverCard/Collapsible/ButtonGroup/InputGroup to `@boring/ui`; migrated agent ai-elements primitives to direct `@boring/ui`; cleaned remaining production raw buttons/inputs/selects across core/workspace/agent where generic design primitives apply. Raw-control scan now only reports tests, comments, and intentional non-button tool-renderer notes.
- 2026-05-04: validation green: `@boring/ui` test/typecheck, agent typecheck + ChatPanel/bare primitive tests, workspace typecheck + full test suite (1048 passed, 2 skipped), core typecheck + smoke/user-nav tests, full-app typecheck + build.
- 2026-05-04: plugin consistency pass: added shared `Notice`, documented plugin authoring rules, and migrated filesystem/data-explorer plugin feedback states to `Notice`/`EmptyState`/`ErrorState`/`Spinner` while keeping plugin-domain components local.
