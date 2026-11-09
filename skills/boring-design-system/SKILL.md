---
name: boring-design-system
description: How every Boring app gets its look: theme tokens plus the app's own components built from kit parts, checked by one command. Use for any UI work in a Boring app (a new screen or component, restyling, rebranding, dark mode, phone layout, "make it look like X") and whenever `boring-ui-blocks design` reports a design-* or kit rule. Takes precedence over generic design skills on fonts, colours, icons and libraries.
---

# Boring design system

**The rule.** An app writes theme tokens and its own components, and its
components are built from kit primitives and blocks; it never copies or
restyles a kit part.

Everything below follows from it. The kit (`@hachej/boring-ui-kit`, shadcn
components under `@boring/ui/shadcn/*`, blocks under `@boring/ui/blocks/*`)
owns how parts look and behave. The app owns its values and its screens.

## The four files an app owns for its look

| File | What goes in it |
|---|---|
| `web/src/index.css` | The imports, in this order, and nothing visual: `@import "tailwindcss"; @import "@hachej/boring-ui-kit/app.css"; @import "@hachej/boring-ui-kit/theme.derived.css"; @import "./theme.core.css";` Core comes last, so its roles and its EXCEPTIONS win. |
| `web/src/theme.core.css` | The core roles (below), light in `:root`, dark in `.dark`; the app's own tokens; then an `=== EXCEPTIONS ===` block for the rare derived token that must differ. |
| `DESIGN.md` (repo root) | The values as the designer states them, an `exceptions:` list (one reason per pinned token) and at most 5 lines of brand intent: the Do/Don't tokens cannot say ("lime only for the one primary action of a screen"). |
| `web/src/design.exceptions.json` (optional; it lives in the directory the check scans) | The app's frozen check hits. It only shrinks; when empty, delete it. |

An app never keeps its own `theme.derived.css` or a copy of `app.css`: the kit
ships both, and a copy drifts.

## Core roles: what an app may set

Colours (set in `:root` and in `.dark`): `--background` (canvas),
`--foreground` (ink), `--card`, `--primary`, `--primary-foreground`,
`--accent` (hover wash), `--muted` (soft band), `--border`, `--ring`,
`--destructive`, `--success`, `--warning`, `--info`, `--chart-series-1..5`.

Shape and type (set once): `--radius`, `--border-width`, `--font-sans`,
`--font-display`, `--font-mono`, `--text-body`, `--text-title`, `--text-chat` (the assistant's reading size, 0.9375rem),
`--shadow-xs`, `--shadow-sm`, `--shadow-md`, `--shadow-lg`.

Everything else (`--popover`, `--secondary`, `--muted-foreground`,
`--input`, `--link`, every `--sidebar-*`, the status `-foreground`, `-soft`
and `-soft-foreground`, `--chart-1..5`, the `--radius-*` steps,
`--font-heading`) is derived by the kit. Set a role and they follow. To
make one differ, pin it below `=== EXCEPTIONS ===`, preferably as a `var()`
of another token, and give it a reason under `exceptions:` in `DESIGN.md`.

An app token (a name the kit does not define, such as `--cta`) is fine.
Register it in `@theme inline` in `theme.core.css` so classes can use it. It
may be the same in both modes.

Fonts: Geist and Geist Mono by default. Mono is for code, ids and pasted
raw data only (use `Textarea variant="code"` for a paste box), never for
labels or numbers in prose; tabular numbers use `tabular-nums`. Icons are
Phosphor (`@phosphor-icons/react`), never Lucide.

## Knobs: kit values an app tunes without restyling

| Need | Knob | Feature id |
|---|---|---|
| Sidebar width | `--sidebar-width` (and `-icon`, `-mobile`) in the theme | `shell-sidebar-width` |
| Blur behind dialogs, sheets and drawers | Off by default; `AppShell overlayBlur` turns it on, `--overlay-blur` retunes it | `shell-overlay-blur` (D-1799) |
| Overlay height | `height="auto" \| "tall" \| "full"` on `DialogContent`, `SheetContent`, `DrawerContent`; retune with `--overlay-height-tall` / `--overlay-height-full` | `shell-overlay-height` (D-1800) |
| Toasts above the chat composer | Automatic (pi-chat sets it); `--toast-offset-bottom` in the theme overrides | `toast-offset` (D-1801) |
| Control height | Automatic: `--control-h` is 44px on touch, 36px with a fine pointer. Never set a height on a control | `control-height` (D-1741), `touch-floor` (D-1770) |
| A link-style action in a row | `Button size="inline"` (text height, 44px touch area; inside a table cell it underlines only on hover and focus) | `pattern-button-inline` (D-1767, D-1814) |
| Underline tabs | `TabsList variant="line"` | shadcn stock |
| Pasted code or raw data | `Textarea variant="code"` | `pkg-ui-textarea-code` (D-1782) |

A knob the kit lacks is a kit request (ask boring-ui-master), never app CSS.
Once the same need shows up in 3 apps, it becomes a token, a prop or a block.

## Need to block

Build screens from these before writing anything by hand.

| The need | Use |
|---|---|
| A button, input, select, textarea, label, table, collapsible | `@boring/ui/shadcn/*` (`button`, `input`, `select` or `native-select`, `textarea`, `label` or `field`, `table`, `collapsible` or `accordion`), never the raw element |
| A toolbar row (search, filters, actions) | Every boxed control (`Input`, `SelectTrigger`, `Button` default/outline/secondary/destructive) at the default size, so all have the input's height (36 fine, 44 touch); a boxed icon button is `size="icon"`; only ghost or link text buttons may be `sm` (`pattern-toolbar-row`, D-1862) |
| A one-line cell in a table | `<TableCell truncate title=…>` (the bound is `--table-cell-truncate-max`, 16rem), never `max-w-* truncate` on the cell |
| Pick or drop one or more files | `FilePick` (`@boring/ui/blocks/file-pick/file-pick`): a button or a drop strip; refusals come back to `onRefused` as `{ file, reason: "type" \| "size" \| "count" }` and the app writes the words |
| A list of files with upload | The `file-tree` block (`FileTreeView`) |
| A sheet, drawer or bottom panel | `AppSheet` (`@boring/ui/blocks/app-shell/index`) |
| See the whole system | The generated page: `node_modules/@hachej/boring-ui-kit/design-system/index.html` (roles in light and dark with measured contrast, type, shape, density, every component and variant); `npx boring-ui-blocks design-system --out <dir> --theme name=<theme.core.css>` adds your theme (`design-system-page`, D-1888) |
| A chat with the agent | `pi-chat` through the shell's agent layer (`AppShell agent={spec}`; placements in the `app-layout-and-agent` skill) |
| Voice | `pi-chat-voice`, or `useDictation` from app-shell |
| Camera or attachments in the chat | `pi-chat-attachments` (`CameraSheet`) |
| Page layout, navigation, list and detail | `AppShell` (see the `app-layout-and-agent` skill) |

Named and coming (don't hand-build them; ask): settings page (flat
`FieldLabel` rows), form page, section layout, detail page with an
inspector (D-1793).

## The check

```sh
npx boring-ui-blocks design web/src            # every rule is an error
npx boring-ui-blocks design web/src --baseline # print the current hits as a frozen list
```

The verifier runs it. A hit not in `design.exceptions.json` fails. A hit you
fix must leave the file (`design-exceptions-shrink` fires on a stale count).
Fix the code, never the list.

| Rule | Fix |
|---|---|
| `raw-element` | Use the kit component it names |
| `kit-block` | Use the block it names (table above) |
| `line-length`, `component-length`, `file-length` | Split (200 chars, 150-line component, 400-line file) |
| `design-color` | No hex, rgb, hsl, oklch or palette class (`bg-red-500`) outside the theme files: use a semantic class |
| `design-tokens-only` | No arbitrary value (`text-[13px]`, `max-h-[85dvh]`): a scale step, a knob, or a new token |
| `design-literal-value` | No literal radius, shadow, font size or letter spacing: the theme utility (`rounded-md`, `shadow-md`, `text-sm`) |
| `design-font-tokens` | No `font-family` literal or `@font-face` outside `theme.core.css`: `font-sans` / `var(--font-sans)` |
| `design-border-width` | No literal border width: the `border` utility (the theme sets `--border-width`); a heavier mark is an app token or an SVG |
| `design-dark-variant`, `design-no-dark-overrides` | No `dark:` colour: set the dark value in `.dark` |
| `design-card-flat` | A `Card`'s className carries no border, shadow or ring |
| `design-no-nested-card` | No `Card` inside a `Card`: a section or a separator |
| `design-icons-phosphor` | `@phosphor-icons/react`, never `lucide-react` |
| `design-touch-target` | A control sized under 44px: drop the small height, pick a `size` |
| `design-hand-touch-size` | A control carrying its own 44px (`min-h-11`, `size-11`): remove it, the kit floor already does it |
| `design-button-raw-height` | No `h-*` on a Button: the kit sets it, `size` picks it |
| `design-link-token` | A link is `text-link underline underline-offset-4` (the `--link` role), never `text-primary` |
| `design-mono-for-code` | Mono only in `code`, `kbd`, `pre`, `samp` or `data-mono-id`; numbers get `tabular-nums`; a paste box is `Textarea variant="code"` |
| `design-no-x-scroll` | No horizontal scroll in a file with a table: cells truncate and the table stacks below its width |
| `design-no-kit-restyle` | No CSS aimed at a kit part (`[data-slot=...]`, `[data-boring...]`, kit class names): a token or a knob |
| `design-no-important` | No `!important`: fix the selector or set a token |
| `design-overlay-has-title` | Every Dialog, AlertDialog, Sheet and Drawer content has its Title (`sr-only` to hide it) |
| `design-theme-core-only` | Set only core roles above `=== EXCEPTIONS ===`; every pin has a reason in `DESIGN.md` |
| `design-theme-roles-both-modes` | Every kit colour role set in `:root` is also set in `.dark`, and the reverse |
| `design-theme-local-derived` | Delete the app's `theme.derived.css`; import the kit's |
| `design-exceptions-shrink` | A frozen hit was fixed: remove it from `design.exceptions.json` |

## Look at it

Before a PR: the main screen at 390 and at 1280, light and dark. Check that
the brand survived, contrast holds in both modes, and nothing is under the
44px floor on the phone. The PR carries those shots and says which roles
changed and why.

## Worked example: Coach Max, a strong brand through tokens

Coach Max is a phone-first consumer app with a loud look: paper `#F4F5F9`,
indigo `--primary` `#3A2DFF`, ink borders, a lime call to action, 2px lines,
4px radii, hard offset shadows. It reaches all of that from
`theme.core.css`:

1. Roles: `--background`, `--foreground`, `--primary`, `--muted`, `--border`
   (ink, so lines are structural), `--ring: var(--primary)`, the status
   colours, `--radius: 0.25rem`, `--border-width: 2px`, the three font roles,
   and the shadow scale as hard offsets (`4px 4px 0 0 var(--foreground)`,
   zero blur). Dark values in `.dark`.
2. App tokens for what has no kit role: `--cta` lime and `--highlight`
   papaya (registered in `@theme inline`, so `bg-cta` works), `--overlay`
   for the scrim, the same in both modes on purpose.
3. `DESIGN.md` intent: "lime only for the single primary action of a
   screen", "no soft shadows".
4. Screens use `bg-primary`, `bg-cta`, `rounded-lg`, `shadow-md`,
   `font-display`. No kit part is restyled; where the brand needed one (the
   sheet, the sidebar), that became a token or a knob request.

Compta is the opposite test: near-stock, desktop-first, business. It sets a
few roles and builds every screen from kit parts. Both pass the same check.

## Precedence over other design skills

For a Boring app, this skill wins. `frontend-design`, `design-impeccable`,
`redesign-existing-projects`, `minimalist-ui`: express their distinctive look
through tokens and `DESIGN.md`, never through new fonts, palettes or CSS in
components. `pick-ui-library`: the kit first; another library only for what
the kit lacks (motion, drag and drop, virtualisation), with token colours.
`emil-design-eng`, `make-interfaces-feel-better`, `interaction-design`,
`animate`, `mobile-native`: their craft holds, but every value (radius,
shadow, easing, duration, font) comes from a token. No MUI, Chakra, Mantine
or Ant; no hand-made dialog, dropdown, toast, spinner or bubble.
