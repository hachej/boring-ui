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

`@hachej/boring-deck/front` (also re-exported from `@hachej/boring-deck`) ships:

- `createDeckPlugin(options?)` — normal workspace plugin entrypoint; installs the
  deck panel, the default `workspace.open.path` resolver, and the required file
  provider for file-backed decks.
- `DeckPane` — the deck pane component. Use this when you want the deck UI
  without going through plugin registration.
- `StandaloneDeckRoute` — full-page wrapper around `DeckPane` for standalone
  routes or embeds.
- `createDeckSurfaceResolver(pathPrefix)` — builds a
  `workspace.open.path` surface resolver for markdown files under the given
  prefix.
- `deckSurfaceResolver` — the default resolver instance for `deck/`.

`@hachej/boring-deck/shared` ships the shared types and parser/path helpers,
including `DeckWidgetDefinition`, `DeckError`, `parseDeckMarkdown(...)`, and
deck path helpers.

### Plugin options

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

### Widget API

```ts
export interface DeckWidgetDefinition<TAttrs = Record<string, string>> {
  name: string
  display?: "block" | "inline"
  parse?: (attrs: Record<string, string>) => TAttrs
  render: (props: DeckWidgetRenderProps<TAttrs>) => ReactNode
}

export interface DeckWidgetRenderProps<TAttrs = Record<string, string>> {
  attrs: TAttrs
  rawAttrs: Record<string, string>
  context: DeckWidgetRenderContext
}

export interface DeckWidgetRenderContext {
  path?: string
  slideIndex: number
  slideCount: number
  mode: "read" | "edit" | "present"
}
```

What each field means:
- `name` must match the widget name used in markdown, for example
  `{{Badge text="draft"}}`.
- `display` controls whether the widget renders inline with surrounding text or
  as its own block. Omit it to use block rendering.
- `parse` is optional. Use it to convert raw string attrs into a typed shape for
  your widget.
- `render` receives parsed `attrs`, the original string attrs as `rawAttrs`, and
  a `context` describing the deck path, current slide index, slide count, and
  whether the deck is in read, edit, or present mode.

Deck preserves host-owned widget syntax. If a workspace already uses custom
widgets, keep the same widget names and attrs in markdown rather than rewriting
content into another format.

### Error API

```ts
export interface DeckError {
  type: "storage" | "parse" | "render" | "widget" | "conflict"
  path?: string
  message: string
  cause?: unknown
}
```

`onError` receives deck-local failures without changing the canonical workspace
file semantics:
- `storage` — file load/save/provider failures
- `parse` — invalid deck markdown or widget syntax
- `render` — deck rendering failures outside a specific widget
- `widget` — widget parse/render failures
- `conflict` — optimistic-concurrency overwrite/reload conflicts

### Exported surfaces and provider requirements

- `createDeckPlugin(...)` is the easiest path. It already installs
  `WorkspaceFilesProvider`, so file-backed decks opened by path work out of the
  box.
- `DeckPane` accepts either `content` for standalone rendering or `params.path`
  for file-backed rendering. If you pass `params.path`, mount it under
  `WorkspaceFilesProvider` (or an equivalent provider supplying the same
  workspace file contexts).
- `StandaloneDeckRoute` wraps `DeckPane` in a full-page shell and starts in
  present mode. It follows the same rule: inline `content` needs no file
  provider, file-backed `path` does.
- `createDeckSurfaceResolver(pathPrefix)` and `deckSurfaceResolver` only match
  markdown files under the configured deck prefix and route them to the deck
  panel via `workspace.open.path`.

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
