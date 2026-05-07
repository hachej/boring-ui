---
name: macro-deck
description: Create and edit macro briefing decks in markdown. Use this whenever the user asks for a deck, slides, presentation, briefing, memo deck, or speaker-note style narrative with embedded macro charts.
---

# macro-deck

Use this skill when the task is: create, expand, revise, or polish a deck under `deck/*.md`.

## Default rule

If the user asks for a slide deck or deck edits:

1. create or edit a markdown file under `deck/`
2. keep slides concise and presentation-shaped
3. use the deck widgets below instead of pasting raw data tables unless the user explicitly wants a table

## File format

- Deck files live under `deck/` and end in `.md`
- Prefer YAML frontmatter for the cover title:

```md
---
title: Labor market snapshot
---
```

- Legacy `---` + `## title: ...` files are still supported, but do not mix both formats.
- Split slides with a line containing only:

```md
---
```

## Widget syntax

### Single chart

```md
{{TimeSeries ids="UNRATE" title="Unemployment rate"}}
{{TimeSeries ids="DFF,GS10" title="Policy vs long rates" size="lg"}}
```

Notes:
- `ids` is comma-separated
- `size` is optional: `sm`, `md`, `lg`
- multiple ids in one widget overlay several series in one chart

### Grid of charts

Use a grid when the user wants several separate mini-charts on one slide.

```md
{{TimeSeriesGrid ids="UNRATE;PAYEMS;CPIAUCSL;GDPC1" titles="Unemployment rate;Payroll employment;CPI;Real GDP" columns="2" size="sm"}}
```

Rules:
- semicolons split grid cells
- each cell may still overlay multiple series with commas, e.g.

```md
{{TimeSeriesGrid ids="DFF,GS10;T10Y2Y;UNRATE;CPIAUCSL" titles="Policy vs long rates;10y-2y spread;Unemployment;CPI" columns="2" size="sm"}}
```

- `titles` is optional but should usually match each cell
- `columns` defaults to `2`
- use `size="sm"` or `size="md"` for dense summary slides

## Writing guidance

- one idea per slide
- short headline first
- 2–5 bullets max when using bullets
- a `size="lg"` chart should usually be alone, with analysis on the next slide
- never put two `size="lg"` charts plus bullets on one slide
- do not overload a slide with long prose, big tables, and charts together
- split dense tables or risk lists into separate slides
- prefer a chart grid for “dashboard” slides
- prefer one large chart for a narrative slide

## Workflow

1. inspect existing decks in `deck/` when helpful
2. write or edit the target markdown file
3. if needed, create derived series first with the `macro-transform` skill
4. open the deck for the user with `exec_ui`

## Example skeleton

```md
---
## title: Inflation and labor snapshot

# Inflation remains above target

Headline inflation is still running above the Fed's 2% target.

{{TimeSeries ids="CPIAUCSL" title="Consumer Price Index" size="lg"}}

---

# Four-chart dashboard

{{TimeSeriesGrid ids="UNRATE;PAYEMS;CPIAUCSL;GDPC1" titles="Unemployment rate;Payrolls;CPI;Real GDP" columns="2" size="sm"}}
```
