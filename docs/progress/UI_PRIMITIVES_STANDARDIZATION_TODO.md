# UI primitives standardization TODO

Fresh component-by-component audit for `@boring/ui` extraction and plugin consistency.

## Rule

Generic visuals belong in `@boring/ui`. Product/domain behavior stays in the owning package/plugin but should compose `@boring/ui` primitives internally.

## Implemented in this pass

- [x] `Notice` for alert/callout feedback.
- [x] `Skeleton` for loading placeholders.
- [x] `InlineCode` for paths/ids/snippets that are not keyboard shortcuts.
- [x] `Toolbar`, `ToolbarGroup`, `ToolbarButton`, `ToolbarSeparator` for compact editor/plugin action rows.
- [x] `Chip`, `ChipButton`, `ChipRemove` for tags, overlays, filters, selected entities.
- [x] `SegmentedControl`, `SegmentedControlItem` for compact mode/view toggles.
- [x] Settings primitives: `SettingsPanel`, `SettingsNav`, `SettingsPageHeader`, `SettingsActionRow`, `DetailLine`.
- [x] Filesystem plugin uses shared `Skeleton` for tree loading.
- [x] Macro plugin chart/deck controls use shared `Button`, `ChipButton`, `SegmentedControl`, `Spinner`, `EmptyState`.
- [x] Core settings pages consume shared settings primitives for panels/nav/action/detail rows.

## Core package audit

- [x] `WorkspaceSwitcher`, members/invites/settings pages: generic controls already from `@boring/ui`.
- [x] `UserSettingsPage` / `WorkspaceSettingsPage`: settings layout extracted to `@boring/ui` and consumed with aliases.
- [x] Replace remaining local settings helper definitions after a safe cleanup pass.
- [ ] Convert remaining auth form label/input/error clusters to `Field`, `FieldLabel`, `FieldError`.
- [ ] Consider `Avatar` primitive for initials/user/workspace badges if repeated outside settings/member rows.

Keep core-local:
- auth/session providers and page routing.
- workspace membership/invite data components.
- top-bar slot/auth app shell behavior.

## Workspace package audit

- [x] Generic empty/error/loading feedback routes through `EmptyState`, `ErrorState`, `Notice`, `Spinner`, `Skeleton` where practical.
- [x] Filesystem plugin shell/tree feedback standardized.
- [ ] Markdown toolbar should migrate its local toolbar wrappers to `Toolbar*`.
- [ ] Consider replacing local context menu styling in `FileTreeView` with `DropdownMenu`/menu primitive if keyboard semantics remain correct.
- [ ] Consider `ResizeHandle` / splitter primitive for `ChatLayout` and `SurfaceShell` resize affordances.
- [ ] Consider `Disclosure` wrapper over `Collapsible` for repeated header+chevron reveal patterns.

Keep workspace-local:
- `WorkspaceProvider`, panel registry, bridge/commands, artifact routing.
- `SurfaceShell`, `WorkbenchLeftPane`, `SessionBrowser`, `CommandPalette`.
- `FileTree`, `CodeEditor`, `MarkdownEditor`, `DataExplorer` domain components.

## Agent package audit

- [x] Generic Radix/control wrappers moved to `@boring/ui`.
- [x] Agent chrome uses shared controls where safe.
- [ ] Evaluate agent `DebugDrawer` tabs/resize affordances for `Toolbar`/future `ResizeHandle`.
- [ ] Consider a generic `CodeSnippet` only for non-agent simple code blocks; keep current rich agent `CodeBlock` local.
- [ ] Consider `Disclosure` for reasoning/tool collapsible headers if it does not weaken AI-message semantics.

Keep agent-local:
- `ChatPanel`, `PromptInput*`, message/tool/reasoning primitives, tool renderers, terminal/diff/code renderers.

## Plugin/app audit

- [x] Macro chart/deck obvious raw controls standardized.
- [ ] Sweep generated/example plugins for raw controls once CI invariant exists.
- [ ] Add invariant script that flags production plugin raw `<button>`, `<input>`, `<select>`, `<textarea>` except approved editor/canvas/test paths.

## Future primitives worth adding only when repeated again

- [ ] `Avatar` / `IdentityBadge`.
- [ ] `ResizeHandle` / `SplitPaneHandle`.
- [ ] `Disclosure`.
- [ ] `ContextMenu` wrapper if file-tree/menu patterns spread.
- [ ] `CodeSnippet` for plain snippets outside agent chat.
