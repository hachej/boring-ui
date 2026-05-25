# deck-authoring

Use this skill when authoring or editing markdown slide decks for
`@hachej/boring-deck`.

## File location

- deck files live under `deck/*.md` by default
- the host app may configure a different prefix, but you should preserve the
  existing project convention you see in the workspace

## Slide structure

- write decks as normal markdown
- `---` on its own line splits slides
- keep one deck-wide canvas in mind (`16:9` by default; some hosts use `4:3`)
- slides should stay concise and presentation-friendly

## Widget syntax

Custom components use moustache syntax:

```md
{{WidgetName key="value"}}
```

Examples:

```md
Welcome {{Badge text="draft"}}

{{Kpi label="Revenue" value="$12.4M"}}
```

Rules:
- preserve any existing host-provided widget names and attrs
- do not silently rewrite host-specific widget syntax into a different format
- keep inline widgets inline when they appear inside a sentence or paragraph

## Authoring guidance

- prefer short slide titles and tight bullet lists
- avoid wall-of-text slides
- keep markdown valid and simple
- use fenced code blocks for code samples
- do not use MDX or raw HTML as a replacement for widgets

## Safety / compatibility

- preserve existing slide separators when editing an existing deck
- do not delete custom widgets just because you do not understand them
- if a deck already has app-specific components, keep their syntax intact unless
  the user explicitly asks for a migration
