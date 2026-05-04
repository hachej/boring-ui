# @boring/ui

Shared shadcn-style primitives for Boring packages and app-generated panes.

This package intentionally ships class-only React primitives and no global CSS. Consumers get styles from the host package CSS they already import, for example:

```ts
import "@boring/workspace/globals.css"
import "@boring/agent/front/styles.css"
```

`@boring/workspace` and `@boring/agent` scan these primitive sources when building their package CSS, so downstream apps do not need package-source `@source` entries.

Current primitives:

- `Button`, `buttonVariants`, `IconButton`
- `Badge`, `badgeVariants`, `StatusBadge`, `Notice`
- `Input`, `Textarea`, `InputGroup`
- `Dialog`, `DropdownMenu`, `Select`, `Tooltip`, `Command`, `Tabs`, `HoverCard`, `Collapsible`, `ButtonGroup`
- `Separator`, `Kbd`, `InlineCode`, `Spinner`, `Skeleton`
- `EmptyState`, `ErrorState`, `Notice`, `Toaster`, `toast`
- `Avatar`, `AvatarFallback`, `InitialsAvatar`
- `Disclosure`, `DisclosureTrigger`, `DisclosureContent`, `DisclosureChevron`
- `ResizeHandle`
- `Toolbar`, `ToolbarGroup`, `ToolbarButton`, `ToolbarSeparator`
- `Chip`, `ChipButton`, `ChipRemove`, `SegmentedControl`, `SegmentedControlItem`
- `Pane`, `PaneHeader`, `PaneTitle`, `PaneDescription`, `PaneBody`, `PaneFooter`, `PaneToolbar`
- `Field`, `FieldLabel`, `FieldDescription`, `FieldError`
- `SettingsPanel`, `SettingsNav`, `SettingsPageHeader`, `SettingsActionRow`, `DetailLine`
- `cn`

Keep this package low-level: no workspace, agent, auth, routing, persistence, or server imports.

## Plugin authoring rule

Plugins should compose generic visuals from `@boring/ui` so host apps stay visually consistent:

- actions: `Button`, `IconButton`, `ButtonGroup`, `Toolbar*`
- forms/search: `Field`, `Label`, `Input`, `Textarea`, `Select`, `InputGroup`
- feedback: `Notice`, `EmptyState`, `ErrorState`, `Spinner`, `Skeleton`, `StatusBadge`, `toast`/`Toaster`
- compact metadata: `Chip`, `ChipButton`, `InlineCode`, `Kbd`
- mode toggles: `SegmentedControl`, `SegmentedControlItem`, `Tabs`
- surfaces: `Pane*`, `Card*`, `Settings*`, `ScrollArea`, `Popover`, `Dialog`

Plugin-specific components should stay in the plugin package when they encode domain behavior or data contracts (file trees, editors, data explorers, artifact renderers, catalog rows). Those components should still render `@boring/ui` primitives internally rather than raw HTML controls or bespoke alert/empty/loading treatments.
