# Pattern blocks

Small presentational blocks for app screens, installed one by one with `boring-ui-blocks add`; they take data and callbacks and own no state, routing or Pi execution. They share icons through `_shared` and style only with tokens (flat cards, no horizontal scroll).

## Sub-features

- `pattern-kpi-stat` a labelled figure with an optional up/down change against a previous reading (`kpiChange` returns `null` for no base, equal or 0% rounding), and `KpiRow` to lay several side by side. `registry/kpi-stat/kpi-stat.tsx`.
- `pattern-list-row` one row with title, subtitle, leading and trailing slots; a button only when `onSelect` is given. `registry/list-row/list-row.tsx`.
- `pattern-empty-state` a title, hint, icon and one action for a screen with nothing in it yet. `registry/empty-state/blank-state.tsx`.
- `pattern-page-header` the screen title with badge, actions and an assistant slot. `registry/page-header/page-header.tsx`.
- `pattern-data-table` a fixed-layout table that never scrolls sideways: cells truncate, and below 520px of container width each row stacks as a title plus label/value pairs by column priority. `registry/data-table/data-table.tsx`.
- `pattern-shared-icons` the icon set the blocks import, so they share one dependency. `registry/_shared/icons.ts`.

## How to get to it (user POV)

- Add a block to an app with `npx boring-ui-blocks add kpi-stat` (or `list-row`, `empty-state`, `page-header`, `data-table`) and render it on a screen.
- Narrow the data table's container below 520px and see rows stack.

## Driving it with the example journeys

Preconditions: Chromium; fictional data only.

- **Render.** `pattern-kpi-stat`, `pattern-list-row`, `pattern-empty-state`, `pattern-page-header`, `pattern-data-table`, `pattern-shared-icons`: run `node test/ui/pattern-blocks.test.mjs`, which bundles the blocks as an app does and renders each.
- **Lint.** `pattern-data-table`: `node test/packages/design-no-x-scroll.test.mjs` pins that a file rendering a table holds no horizontal scroll container.

## Gotchas

- Blocks import the app's shadcn `card`, `button` and `badge`; install those first. A Card inside a Card, or a bordered Card, fails `design-card-flat` and `design-no-nested-card`.
- `DataTable` renders both the table and the stacked list and lets a container query pick one; tests that count rows see both.
