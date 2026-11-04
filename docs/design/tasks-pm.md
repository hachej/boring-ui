# Task and PM components: props, tokens, customisation

Tokens first. A child app restyles these components by changing its theme tokens. Only when a token cannot express the change does the app compose its own component from the parts below.

## Components

| Component | Props (main) | Tokens read | Notes |
|---|---|---|---|
| `TaskListViewer` (`task-list-viewer/`) | `controller`, `title?`, `className?` | `--card`, `--card-foreground`, `--radius-lg`, `--radius-md`, `--muted` (row hover), `--foreground`, `--muted-foreground`, `--destructive`, `--font-mono` | Surface is a plain `section`, not a shadcn Card. Row 44px on phone, 32px from `sm`. |
| `BoardViewer` (`board-viewer/`) | `text`, `revision`, `target`, `pinned`, `client`, `identity`, host props | `--card` (frame), `--muted` (canvas), `--muted-foreground` (save status), `--destructive` (alert) | Frames are flat surfaces; no card in a card. tldraw paints its own canvas. |
| `VersionHistoryRows` (`version-history/`) | `versions`, `current`, `onSelect`, `labels?`, `testId?` | `--muted` (hover through the ghost button), `--muted-foreground`, `--font-mono` (date groups) | Relative times in text; dates for groups in mono. Rows 44px. |
| `AgentTargetMode` (`agent-target/`) | `enabled`, `transcribe`, `onSettled`, `attribute?`, `labels?` | `--popover`, `--popover-foreground`, `--radius-lg`, `--destructive` | Floating bar is a popover-token surface. Pick is on `data-agent-target` by default. |
| `MaquetteViewer` / `MaquetteScreenView` (`maquette-viewer/`) | `text` or `maquette`, `links?`, `labels?` | `--card` (screen frame), `--muted-foreground` (captions) | Blocks use the app's own shadcn controls. |
| `MockupViewer` (`mockup-viewer/`) | `text`, `path?`, `comments?`, `theme?`, `light?`, `dark?` | host variables read through computed CSS | Renders an opaque sandbox document. Its own Tailwind compile is allowlisted. |
| `LooksViewer` (`looks-viewer/`) | `files`, `labels?` | `--card`, `--card-foreground`, `--radius-lg`, `--muted` (preview frame) | Choice cards are flat surfaces. |
| `RecordsViewer` / `RecordTable` / `RecordList` (`record-viewer/`) | `text` or `columns`/`rows`, `locale?`, `labels?`, `onAction?` | `Badge` tones: `default`, `secondary`, `destructive`, `outline` | Phone (under `sm`) shows the list, never a sideways table. |
| `ViewerFrame` (`viewer-frame/`) | title, status, `menu`, `actions`, `children`, `testId?` | `--primary`, `--destructive`, `--muted-foreground`, `--foreground` (status dot and text) | One top bar; status is a dot plus label. |

## Customising a child app

1. **Tokens.** Set the shadcn variables in the app's theme. For example, `--card` sets every flat surface, `--muted` sets the board canvas and row hover, `--ring` sets focus, and `--radius` sets the corner of every panel. Dark mode uses the same names under `.dark`.
2. **Status colours.** The status tones read `--primary`, `--destructive` and `--muted-foreground` today. The soft tones (`--success`, `--warning`, `--info`) are the foundation work; an app that defines them gets them where they are wired.
3. **Composing its own component.** Import the parts instead of the viewer. The task list exposes its controller and document, so an app can render its own rows with `Checkbox`, `Button` and `Input` from its shadcn set. Keep the layout classes (`min-h-11`, `gap-*`) and the `data-*` test ids; restyle through tokens, not classes.
4. **Do not** wrap a block in a shadcn `Card` to restyle it. The blocks now use token surfaces, and a `Card` brings back a ring and shadow the design rules forbid.

## Rules these components follow

- Colour, radius and font come from tokens: no literal colour, no `rounded-*` utility, no `border`, no `shadow-*` in a block.
- Body text is `text-xs` (12px), titles `text-sm` (14px). Nothing larger in app surfaces. Document content (Markdown, sandboxed mock-ups) is out of this rule.
- Ids and dates use `font-mono`, muted.
- Phone rows and buttons are 44px (`min-h-11`), and nothing scrolls sideways at 390px.
