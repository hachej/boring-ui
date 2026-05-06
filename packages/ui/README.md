# @boring/ui

Shared UI primitives for boring-ui packages and plugins.

```bash
pnpm add @boring/ui
```

---

## What it provides

shadcn-style React components with no global CSS — styles come from the host package CSS (`@boring/workspace/globals.css`).

**Layout & surfaces** — `Pane`, `PaneHeader`, `PaneBody`, `PaneToolbar`, `FloatingPanel`

**Actions** — `Button`, `IconButton`, `ButtonGroup`, `Toolbar`, `ToolbarButton`

**Forms** — `Input`, `Textarea`, `Select`, `Field`, `FieldLabel`, `InputGroup`

**Feedback** — `Notice`, `EmptyState`, `ErrorState`, `Spinner`, `Skeleton`, `StatusBadge`, `toast`

**Display** — `Badge`, `Chip`, `InlineCode`, `Kbd`, `Avatar`, `List`, `DetailList`

**Overlays** — `Dialog`, `DropdownMenu`, `Tooltip`, `HoverCard`, `Tabs`, `Command`

**Settings** — `SettingsPanel`, `SettingsNav`, `SettingsActionRow`

---

## Usage

```tsx
import { Button, EmptyState, Pane, PaneHeader, PaneBody } from "@boring/ui"

export function MyPanel() {
  return (
    <Pane>
      <PaneHeader>My Panel</PaneHeader>
      <PaneBody>
        <EmptyState title="Nothing here" />
        <Button>Action</Button>
      </PaneBody>
    </Pane>
  )
}
```

Styles are provided by the host — no separate CSS import needed in plugins:

```ts
// In your app shell (once)
import "@boring/workspace/globals.css"
```

---

## Part of [boring-ui](https://github.com/hachej/boring-ui)

| Package | Role |
|---|---|
| `@boring/core` | DB, auth, app factory |
| `@boring/workspace` | Plugin system, layouts |
| `@boring/agent` | Agent runtime + tools |
| `@boring/ui` | Shared UI primitives |
