# Chat style audit (style v1)

Scope: the chat kit components under `registry/` (pi-chat*, shared-chat, pi-app chat parts,
pi-workspace, placed-agent, feedback). Counts are source-line hits from grep on this branch.
Columns: `rad` = `rounded-*`, `edge` = `shadow-*`, `ring-*` or `border` classes, `space` = `space-x/y-*`,
`type` = fixed text size classes (`text-xs`/`text-sm`/`text-base`/`text-lg`/`text-[..]`), `dark` = `dark:` variants,
`lit` = literal colours (named palette or hex).

| Block | rad | edge | space | type | dark | lit | Finding | Status in this PR |
|---|---|---|---|---|---|---|---|---|
| pi-chat/pi-chat.tsx | 0 | 2 | 3 | 5 | 0 | 0 | root body had a 14px base; `space-y` stacks; `border` on the pinned rail | body set via `.pi-chat` token; spacing left (layout) |
| pi-chat/composer.tsx | 0 | 0 | 0 | 5 | 0 | 0 | composer used a 26px radius and an at-rest border | radius and hairline now tokens; hairline only on focus |
| pi-chat/message.tsx | 0 | 0 | 0 | 5 | 0 | 0 | user bubble used `bg-muted`; working line had `text-sm` | working line inherits body size |
| pi-chat/tool.tsx | 0 | 0 | 0 | 1 | 0 | 0 | tool details nested a `Card` (card-in-card) | Card removed; plain muted surfaces; title is a human name |
| pi-chat/activity.tsx | 0 | 0 | 0 | 1 | 0 | 0 | reasoning text was `text-sm` | `text-xs` (body size) |
| pi-chat/notice.tsx | 0 | 0 | 0 | 3 | 0 | 0 | status and notices at `text-sm` | unchanged; colours already tokens |
| pi-chat/history.tsx | 0 | 0 | 0 | 8 | 0 | 0 | many type sizes in list rows | not changed in this PR (follow-up) |
| pi-chat/queue.tsx, code-block.tsx, shimmer.tsx, empty-state.tsx, conversation-files.tsx, image-viewer.tsx | 0 | 0 | 0 | 0-1 | 0 | 0 | ok | none |
| pi-chat-markdown/markdown.tsx | 0 | 1 | 0 | 4 | 0 | 0 | headings 1 to 6 used `text-base` to `text-xl` | h1-h2 `text-sm`, h3-h6 `text-xs`, code `text-xs` |
| pi-chat-approval/approval-card.tsx | 0 | 0 | 0 | 3 | 0 | 0 | alert text at `text-sm` | `text-xs` |
| pi-chat-subagent/run-card.tsx | 0 | 0 | 0 | 1 | 0 | 0 | alert text at `text-sm` | `text-xs` |
| pi-chat-question/question-card.tsx | 0 | 0 | 0 | 0 | 0 | 0 | ok | none |
| pi-chat-voice, pi-chat-pickers, pi-chat-attachments, pi-chat-mentions, pi-chat-slash | 0 | 0 | 0 | 1-2 | 0 | 0 | ok | none |
| pi-app/agent-workspace.tsx | 0 | 0 | 0 | 3 | 0 | 0 | two locale sources (chrome and chat) could disagree (French leak) | single `resolvedLocale` drives both |
| pi-app/artifact-panel.tsx | 0 | 0 | 0 | 4 | 0 | 0 | panel headings sized independently | not changed (follow-up) |
| pi-workspace/workspace.tsx | 0 | 2 | 0 | 0 | 0 | 0 | `bg-ring`, `bg-border/..` used as surfaces | follow-up: needs a surface token |
| shared-chat/messages.tsx | 2 | 1 | 0 | 7 | 1 | 0 | avatar `rounded-md`, `text-[0.6875rem]` literal, `dark:text-chart-2` in author colour map | follow-up: avatar radius and clock size to tokens |
| shared-chat/timeline.tsx | 0 | 1 | 0 | 1 | 0 | 0 | a border on the timeline | follow-up |
| feedback/picker-overlay.ts | 0 | 2 | 0 | 2 | 0 | 0 | `var(--shadow-*, fallback)` literal fallbacks | left: already tokens with fallbacks |
| feedback/feedback-card.tsx, point-mode.tsx | 0 | 0 | 0 | 2 | 0 | 0 | ok | none |

## Cross-cutting

- Borders at rest: the composer had a border at rest. Now `border-color: var(--card)`, and `var(--ring)` only on `:focus-within`.
- Card-in-card: `ToolCard` nested a `Card` inside a message row. Removed.
- `space-x/y`: layout only (allowed by BORING-UI-1); not restyling.
- Direct icon imports from `lucide-react`: many files. Icons are visual defaults owned by the host, so a follow-up should route them through the kit icon set. Not changed here.
- Shadows: none in chat blocks except feedback overlay token fallbacks.

## Not done in this PR

- `history.tsx` type scale, `artifact-panel.tsx` heading sizes, `shared-chat` avatar radius and clock size.
- Surface tokens for `bg-ring` / `bg-border` uses in `pi-workspace`.
- Icon routing through the kit.
