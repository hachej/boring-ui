# Design

The kit's own look, and the rules a screen is checked against. An app sets tokens in `web/src/theme.core.css` and builds every screen from kit parts; the kit never ships a value an app has to retype. The skill for working with it is [boring-design-system](skills/boring-design-system/SKILL.md); this file is the short form an agent reads before touching a screen.

## Tokens by role

Values below are the shipped default theme (`packages/ui/styles/app.css`, the registry `theme` item). An app overrides them in its own `theme.core.css`; the check reads that file.

| Role | Token | Default | Used for |
|---|---|---|---|
| Canvas, card | `--background`, `--card` | grey canvas, flat white card | page, surfaces |
| Ink, accent | `--foreground`, `--primary` | near-black, one accent | text, the one main action |
| Status | `--destructive`, `--success`, `--warning`, `--info` | per mode | a state, never decoration |
| Shape | `--radius`, `--border-width` | 0.5rem, 1px | every corner and hairline, through `rounded-*` and `border` |
| Body text | `--text-body` (`text-xs`) | 0.8125rem | screen copy, rows, tables |
| Title text | `--text-title` (`text-sm`) | 0.875rem | screen and card titles; nothing larger in an app screen |
| Chat text | `--text-chat` | 0.9375rem | the assistant's reading size |
| Control height | `--control-h` | 36px pointer, 44px touch | every control; never set a height by hand |
| Screen margin | `--screen-gutter` | 1rem, 0.75rem compact | drawn once by `ScreenBody` |
| Motion | `--duration-fast`, `-normal`, `-slow` | 100, 150, 300ms | every transition |
| Stacking | `--z-dropdown` 30, `--z-composer` 40, `--z-sheet` 50, `--z-overlay` 55, `--z-toast` 60, `--z-feedback` 2147483000 | see left | `z-dropdown`, `z-sheet`... or `z-[var(--z-*)]` |

**One scale per app.** Consistency inside an app is the rule, not one size for all apps. An app declares its scale in `theme.core.css` (a `--text-<step>` for each step it uses beyond `text-xs` and `text-sm`) and its screens use only those steps. Chase is the reference: body 12px, title 14px, chat 13px (`--text-body`, `--text-title`, `--text-chat`), plus its own `text-md`, `text-2xs`, `text-3xs`. The kit default is not there yet (body 13px, chat 15px); converging it is a separate change.

## The ten rules every screen follows

1. Look at your own change at 390 and 1280 px before saying done; fix anything misaligned, wrapped, clipped or off-centre.
2. Ids, numbers and short labels never wrap (`whitespace-nowrap`, `tabular-nums`, room for four characters).
3. Everything comes from tokens: no raw colour, font size, radius, spacing or z-index; the same component looks the same in every mode and pane.
4. The app shell (left pane, top bar) is fixed; it never changes between screens or modes.
5. One control per job: delete duplicates, leftovers and explanatory chrome; one spinner per activity.
6. Every icon-only button has a label and tooltip; every list has its basic actions (open on row click, delete, reopen).
7. Design every state: collapsed, docked, full, loading, empty, error, with results and approvals visible in the collapsed one.
8. Words a customer would say: few, no internal terms, named by purpose; English by default, French by config.
9. Phone is its own layout (bottom bar, sheet); never a shrunk desktop.
10. Compare the build with the approved mockup side by side; if a rule forces an ugly result, fix the rule and say so.

## The check

Run it after each UI file edit, on the files git reports changed (edited, staged and new):

```
npx boring-ui-blocks design web/src --changed --jsonl
```

It prints one `{file,line,rule,level,fix}` line per hit, nothing when clean, and exits 1 on an error. `design web/src` checks the whole app; `--json` prints the full report.

| Rule | Fails on |
|---|---|
| `design-color`, `design-tokens-only`, `design-literal-value`, `design-font-tokens`, `design-border-width` | a raw colour, arbitrary value (`text-[13px]`), font size, radius, shadow, font or border width |
| `design-z-index` | `z-10`, `z-[45]`, `zIndex: 5`, `z-index: 40`; use a named layer or `var(--z-*)` |
| `design-type-scale` | `text-base` and larger that the app's `theme.core.css` does not declare |
| `design-gap-not-space` | `space-x-*`, `space-y-*` |
| `design-screen-padding` | `p-*`, `px-*` on `ScreenBody`, its direct child or a screen root |
| `design-has-design-md` | an app root (a `package.json`) with no `DESIGN.md` |
| other `design-*` rules | see [boring-design-system](skills/boring-design-system/SKILL.md) |

An app's existing hits go in `web/src/design.exceptions.json` (counts that only shrink). The kit's own scan is `node scripts/check-design.mjs`; its exceptions, each with a reason, are in `scripts/design-allowlist.json`.

## Exceptions

exceptions: none

No derived token is pinned in the kit's default theme.
