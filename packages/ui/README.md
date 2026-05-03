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
- `Badge`, `badgeVariants`, `StatusBadge`
- `Input`, `Textarea`
- `Dialog`, `DropdownMenu`, `Select`, `Tooltip`, `Command`, `Tabs`
- `Separator`, `Kbd`, `Spinner`
- `EmptyState`, `ErrorState`
- `Pane`, `PaneHeader`, `PaneTitle`, `PaneDescription`, `PaneBody`, `PaneFooter`, `PaneToolbar`
- `Field`, `FieldLabel`, `FieldDescription`, `FieldError`
- `cn`

Keep this package low-level: no workspace, agent, auth, routing, persistence, or server imports.
