# @hachej/boring-ui-kit

Shared UI primitives for boring-ui packages and plugins.

```bash
pnpm add @hachej/boring-ui-kit
```

---

## What it provides

shadcn-style React components with no global CSS — styles come from the host package CSS (`@hachej/boring-workspace/globals.css`).

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
import { Button, EmptyState, Pane, PaneHeader, PaneBody } from "@hachej/boring-ui-kit"

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
import "@hachej/boring-workspace/globals.css"
```

---

## Part of [boring-ui](https://github.com/hachej/boring-ui)

| Package | Role |
|---|---|
| `@hachej/boring-agent` | Agent runtime + tools |
| `@hachej/boring-workspace` | Plugin system, workbench |
| `@hachej/boring-core` | DB, auth, app factory |
| `@hachej/boring-ui-kit` | Shared UI primitives |
| `@hachej/boring-ui-cli` | Zero-setup CLI |
