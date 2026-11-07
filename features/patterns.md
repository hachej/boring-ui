# Pattern blocks

Small presentational blocks for app screens, installed one by one with `boring-ui-blocks add`; they take data and callbacks and own no state, routing or Pi execution. They share icons through `_shared` and style only with tokens (flat cards, no horizontal scroll).

## Sub-features

- `pattern-kpi-stat` a labelled figure with an optional up/down change against a previous reading (`kpiChange` returns `null` for no base, equal or 0% rounding), and `KpiRow` to lay several side by side. `registry/kpi-stat/kpi-stat.tsx`.
- `pattern-list-row` one row with title, subtitle, leading and trailing slots; a button only when `onSelect` is given. `registry/list-row/list-row.tsx`.
- `pattern-empty-state` a title, hint, icon and one action for a screen with nothing in it yet. `registry/empty-state/blank-state.tsx`.
- `pattern-page-header` the screen title with badge, actions and an assistant slot. `registry/page-header/page-header.tsx`.
- `pattern-data-table` a fixed-layout table that never scrolls sideways: cells truncate, and below 520px of container width each row stacks as a title plus label/value pairs by column priority. `registry/data-table/data-table.tsx`.
- `pattern-labelled-row` (D-1729) a Checkbox, Radio or Switch whose whole row takes the tap: the bundled primitives' `FieldLabel` wrapping a horizontal `Field` (control, then `FieldContent` with `FieldTitle` and an optional `FieldDescription`) is one `<label>`, at least 44px tall under `md` or on a coarse pointer (`min-h-11`, content centred), a long title wraps, a disabled `Field` (`data-disabled`, disabled control) dims and ignores taps, Tab shows a ring on the row, and one click on the text, the empty space or the control changes it once. The control's own hit area is not widened; keep rows apart with `gap-3` on the `FieldGroup` or `RadioGroup` (8px or more). No new block: it is bundled-primitive usage. `shadcn/ui/field.tsx`, usage in `test/fixtures/labelled-rows.tsx`.
- `pattern-short-date` (D-1754) the one short date every card uses: `formatShortDate(date)` and `<ShortDate date>` give the day and month in the browser's locale ("Nov 6"), the year added when it is not the current year, as a `<time dateTime title>` with the full date and time; an invalid Date gives `null` / renders nothing. `StatusNarrative` `at` and `SpaceCard` `lastShip` take a `Date` through it. The text follows the browser's locale and timezone (the `<time>` suppresses the hydration warning, not a server/browser difference): a server-rendered host passes a string. `registry/_shared/short-date.ts`.
- `pattern-shared-icons` the icon set the blocks import, so they share one dependency. `registry/_shared/icons.ts`.

## How to get to it (user POV)

- Add a block to an app with `npx boring-ui-blocks add kpi-stat` (or `list-row`, `empty-state`, `page-header`, `data-table`) and render it on a screen.
- Wrap a control in `<FieldLabel><Field orientation="horizontal">…</Field></FieldLabel>` (see `test/fixtures/labelled-rows.tsx`) at 390px and tap beside its text.
- Narrow the data table's container below 520px and see rows stack.

## Driving it with the example journeys

Preconditions: Chromium; fictional data only.

- **Render.** `pattern-kpi-stat`, `pattern-list-row`, `pattern-empty-state`, `pattern-page-header`, `pattern-data-table`, `pattern-shared-icons`: run `node test/ui/pattern-blocks.test.mjs`, which bundles the blocks as an app does and renders each.
- **Labelled row.** `pattern-labelled-row`: `CHROMIUM=... node --test test/ui/labelled-row.test.mjs` builds the fixture with the real primitives and Tailwind preflight, opens it at 390 with touch in Chromium, measures every row (44px, 8px gap), clicks text, empty space and control once each and counts changes, checks disabled rows and the Tab ring.
- **Short date.** `pattern-short-date`: `node --test test/ui/space-blocks.test.mjs` renders a `SpaceCard` and a `StatusNarrative` with the same Date (and a past-year Date) and compares the `<time>` text, then an invalid Date.
- **Lint.** `pattern-data-table`: `node test/packages/design-no-x-scroll.test.mjs` pins that a file rendering a table holds no horizontal scroll container.

## Gotchas

- Blocks import the app's shadcn `card`, `button` and `badge`; install those first. A Card inside a Card, or a bordered Card, fails `design-card-flat` and `design-no-nested-card`.
- `DataTable` renders both the table and the stacked list and lets a container query pick one; tests that count rows see both.
