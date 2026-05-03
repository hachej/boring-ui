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
- [ ] Tooltip
- [ ] Dialog
- [ ] DropdownMenu
- [ ] Select
- [ ] Command
- [ ] Tabs

### Add shared atoms

- [ ] IconButton
- [ ] Kbd
- [ ] Spinner
- [ ] EmptyState
- [ ] ErrorState
- [ ] Panel primitives (`Pane`, `PaneHeader`, `PaneTitle`, `PaneBody`, `PaneFooter`, `PaneToolbar`)
- [ ] Form/field primitives
- [ ] StatusBadge

### Consume primitives / reduce bespoke UI

- [ ] Core `AppErrorBoundary`
- [ ] Workspace `ConflictBanner`
- [ ] Workspace `EmptyPane`
- [ ] Workspace `PanelErrorBoundary`
- [ ] Workspace `TopBar`
- [ ] Workspace `FileTreeView` context menu
- [ ] Workspace `WorkbenchLeftPane` tabs/search controls
- [ ] Agent `ModelPicker`
- [ ] Agent `DebugDrawer`
- [ ] Agent bare primitives cleanup
- [ ] Agent `ChatPanel` subcomponent extraction

## Validation log

- 2026-05-03: baseline `@boring/ui` smoke tests, agent/workspace builds/typechecks passed before this follow-up.
