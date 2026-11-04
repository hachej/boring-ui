# Task and PM viewers: token audit

Scope: `task-list-viewer`, `board-viewer`, `version-history`, `agent-target`, `maquette-viewer`, `mockup-viewer`, `looks-viewer`, `record-viewer`, `viewer-frame`. Baseline from `node scripts/check-design.mjs --details`: 0 FAIL findings, 2519 allowlisted theme values. The rule engine is blind to most items below, so this table is a grep audit, not a pass.

Columns: what was found, and what changed on this branch. "Left" means deliberately kept, with the reason.

| Component | Literal / arbitrary values | Borders, shadows, nesting | Type and spacing | Icons | Status | Action on this branch |
|---|---|---|---|---|---|---|
| task-list-viewer | none | `Card` (shadcn ring and shadow); raw `<h2>`, `<ul>`, `<label>` unstyled | `h2` at browser default size | none | plain text notice | Card to `section` on `bg-card` with radius `var(--radius-lg)`; title `text-sm`; rows flat, `hover:bg-muted`, 44px on phone (`min-h-11 sm:min-h-8`); body `text-xs`; status line mono, muted, destructive for errors |
| board-viewer / board-canvas | `z-[300]` on toolbar (layout, kept) | frame = `Card` with `CardContent` inside (card in card) | none | 6 direct `lucide-react` imports | alert text muted | Frame is one `bg-card` surface, no nested `CardContent`; canvas wrapper `bg-muted`; alert `text-destructive`. Left: the tldraw canvas paints its own background, not verified against `bg-muted` |
| version-history | none | none | date group label not mono | none | none | group label `font-mono text-xs` (date) |
| agent-target | none | `Card` with ring and shadow, `CardHeader`/`CardTitle`/`CardFooter` | title via `CardTitle` | none | status and problem text unstyled colour | `section` on `bg-popover`, radius from theme, title `h2 text-sm`, text `text-xs`, problem `text-destructive`. Buttons keep 44px touch targets |
| maquette-viewer | none | frame `Card`/`CardContent` (card in card with mock-up `Card` blocks) | caption, position, status `text-sm` (body) | 2 direct lucide imports (`maquette-viewer`, `maquette-kind`) and 1 in `maquette-blocks` | none | frame to `div` on `bg-card`; body text `text-sm` to `text-xs`. Left: the mock-up `Card` blocks in `maquette-blocks` are the app's own components, shown as they are |
| maquette-blocks | none | `Card` used for `card`/`chat`/`document` blocks (intended) | heading `text-base`, body `text-sm`, items `text-sm` | `BoxIcon` (lucide) | none | heading to `text-sm`, body to `text-xs` (mock-up is shown at app scale) |
| mockup-viewer | `text-*` inside Tailwind compile input (`mockup-tailwind.ts`), allowlisted as `mockup-compiler-input` | none | sandboxed document | `MessageSquarePlusIcon` (lucide) | none | Left: sandboxed opaque document, not host chrome. Icon import listed as follow-up |
| looks-viewer | none | `Card`/`CardHeader`/`CardAction` per look and per layout | `text-lg` headings (larger than the 14px title) and `text-sm` body | `PaletteIcon`, `CheckIcon` (lucide) | none | flat `section` on `bg-card` per choice; headings `text-sm`, lines `text-xs` |
| record-viewer | `overflow-auto` on table wrapper (sm+) and status wrappers | table is `hidden sm:block`; phone uses `RecordList` (no table, no sideways scroll) | none | none | `Badge` variants map to tokens (`default`, `secondary`, `destructive`, `outline`) | Left: phone projection already satisfies no-sideways-scroll at 390px. Left: status badges already use tokens; `--success`/`--warning` soft tokens are not in this branch's theme |
| viewer-frame | `text-*` in `viewers.css` is document content (markdown), allowlisted as `editor-document` | none | title `text-sm`, subtitle `text-xs` | `CircleIcon`, `CheckIcon`, `CopyIcon`, `ArrowLeftIcon`, `RefreshCwIcon`, `ExternalLinkIcon`, `DownloadIcon`, `EllipsisIcon`, `Maximize2Icon`, `Minimize2Icon`, `Share2Icon`, `XIcon` (lucide, 2 files) | status dot `fill-primary/destructive/muted-foreground` (tokens) | Left: status dots already tokens. Icons: follow-up (kit icon indirection) |

## Rule coverage

- `design-type-scale` (no `text-base` or larger in app code) is not wired. Changed manually here for the scope.
- `design-card-flat` and `design-no-nested-card` are not wired. The scope has no `Card` left except the mock-up blocks in `maquette-blocks.tsx` and the shadcn cards those blocks render.
- `design-icons-from-kit` is not wired. 11 direct `lucide-react` imports remain in scope (board-canvas, board-kind, maquette-kind, maquette-viewer, maquette-blocks, mockup-viewer, mockup-kind, looks-kind, viewer-frame, viewer-window).
- Status soft tokens (`--success`, `--warning`, `--info`) are not defined in the theme on `origin/main`. The scope uses `--primary`, `--destructive`, `--muted-foreground`, `--foreground` until the foundation work lands them.

## Follow-up

1. Icon indirection (boring-ui-master): move the 11 scope imports, and the rest of the kit's `lucide-react` imports, behind the kit icon module.
2. Foundation (`design/style-v1-foundation`): `--success`, `--warning`, `--info` soft tokens, `--card` as a core token, `text-xs` body / `text-sm` title roles.
3. `ListRow` shared pattern: not landed (`design/style-v1-patterns` has no commit beyond `origin/main` and no `ListRow` file). task-list-viewer keeps a local row.
4. Board canvas background on `bg-muted` needs a visual check against tldraw's own background.
