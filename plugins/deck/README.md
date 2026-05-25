# @hachej/boring-deck

Front-only markdown deck plugin for Boring workspace.

## What it ships

`@hachej/boring-deck` opens markdown slide decks stored in normal workspace
files.

v1 includes:
- one deck panel
- read / edit / present flows
- `workspace.open.path` resolution for deck markdown paths
- generic widget injection for app-owned components
- one bundled Pi skill at `skills/deck-authoring/`

## Intentionally out of scope

This package does **not** ship:
- `boring.server`
- deck-specific HTTP routes
- a custom storage abstraction
- macro/domain widgets such as `TimeSeries` or `TimeSeriesGrid`
- MDX or raw-HTML eval
- per-slide canvas sizing in v1

## Installation

Add the package to your app and register it like any other front plugin:

```tsx
import { createDeckPlugin } from "@hachej/boring-deck/front"

const deckPlugin = createDeckPlugin()
```

```tsx
<WorkspaceProvider plugins={[deckPlugin]}>
  <IdeLayout />
</WorkspaceProvider>
```

## Public API

```ts
export interface CreateDeckPluginOptions {
  pathPrefix?: string
  widgets?: DeckWidgetDefinition[]
  theme?: DeckThemeOptions
  onError?: (error: DeckError) => void
}

export interface DeckThemeOptions {
  aspectRatio?: "16:9" | "4:3"
  className?: string
  slideClassName?: string
}
```

Rules:
- plugin id, panel id, label, and resolver wiring are fixed in v1
- default `pathPrefix = "deck/"`
- panel + surface resolver are built in
- no built-in command in v1

## Canonical file-state reuse

Deck deliberately reuses the canonical workspace file-state seam instead of
inventing deck-local storage APIs.

The deck panel runs on top of:
- `WorkspaceFilesProvider`
- `useFilePane(...)`
- canonical workspace optimistic-concurrency behavior (`mtimeMs` /
  `expectedMtimeMs`)

If you mount deck components outside the plugin wrapper, they must still run
under `WorkspaceFilesProvider` (or an equivalent provider that supplies the same
workspace file contexts).

## Markdown deck format

- deck files live under `deck/*.md` by default
- `---` on its own line splits slides
- widgets use moustache syntax
- inline widgets stay inline; block widgets render as their own block

Example:

```md
# Quarterly update

Welcome {{Badge text="draft"}}

---

## Metrics

{{Kpi label="Revenue" value="$12.4M"}}
```

## Widget injection

Widgets stay app-owned. The generic package only provides the registry and
rendering contract.

```tsx
import { createDeckPlugin } from "@hachej/boring-deck/front"
import type { DeckWidgetDefinition } from "@hachej/boring-deck/shared"

const badgeWidget: DeckWidgetDefinition = {
  name: "Badge",
  display: "inline",
  render: ({ attrs }) => <span className="rounded-full border px-2 py-0.5 text-xs">{attrs.text}</span>,
}

const deckPlugin = createDeckPlugin({
  widgets: [badgeWidget],
  theme: {
    className: "my-deck-theme",
    slideClassName: "my-deck-slide",
  },
})
```

Unknown widgets render a visible placeholder instead of crashing the whole deck.
Widget parse/render failures stay local to the widget.

## Theming

Theme customization is intentionally small:
- `aspectRatio`
- shell class name
- slide frame class name

Use normal app/workspace CSS tokens and classes for colors/typography rather
than deck-specific color/font props.

## Skill

The bundled `deck-authoring` skill teaches:
- where deck files live
- how to split slides
- how to keep slides concise
- widget syntax and host-widget preservation rules

## Validation

Typical package checks:

```bash
pnpm --filter @hachej/boring-deck typecheck
pnpm --filter @hachej/boring-deck test
pnpm --filter @hachej/boring-deck build
```
