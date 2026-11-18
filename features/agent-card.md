# Agent card

One unit of agent work (a run, a task, a job) as a card that works in the background and folds, and the default chat as a piece that goes anywhere. `AgentChat` fills its container; `AgentCard` holds it behind a header and the composer's levels. Neither has an input of its own: the conversation, the composer, the approval card and the file cards are the kit's chat.

## Sub-features

- `agent-chat` `AgentChat` is `PiChat` with the kit's plugins (`withChatPlugins`: Markdown, the approval and question cards, artifact cards once `chatProps.artifacts.open` is given) under a header, in a flex column that fills its container (a right pane, a card of fixed height, a page, a dialog). Header: title, a status chip (`status: { label, tone }`, tone `neutral | running | attention | success | danger` picks the kit's Badge), the agent's name in its colour, `onBack`, `onClose` and a `headerEnd` slot; `header={false}` draws none. `registry/agent-chat/agent-chat.tsx`.
- `agent-color` the agent's colour is `agent.color`, one of the theme's `chart-1` to `chart-5` tokens (default `primary`). The header and the card are tinted with `color-mix` on that token (13% into the card colour, the ring 40% into the border colour); no hex is written by hand. `agentColor`, `agentTint` and `statusVariant` are exported.
- `agent-card` `AgentCard` folded is a header (the agent's colour dot, the title, a status chip, one line `Agent · activity`) and an optional `meta` (a task's own fields: assignee, due date, so a task card is this card with a `meta`). Level 0 folded, 1 a small tray (the conversation and its field, `heights.tray`), 2 the whole chat with its header (`heights.open`). `level` and `onLevelChange` control it; `defaultLevel` leaves it to the card. A tap on the header expands to level 1. Esc folds and returns focus to the header. `registry/agent-card/agent-card.tsx`.
- `agent-card-strip` the controller on the card's lower border is the composer's own strip (`ControllerStrip` of `_shared/controller-strip.tsx`), and its arrows point the way the card grows (`stripIcons('bottom')`: expand down, collapse up, the double chevron down; the bar's top-border strip is unchanged). It is one ladder, one step at a time, with Dock at every step. Level 0, chat not open: Open the chat (a chat bubble) and Dock. Level 0, composer showing: Collapse (up, back to the chat bubble), Expand (down) and Dock. Level 1, the tray: Collapse (up, back to level 0 with the composer showing), Expand more (double chevron down) and Dock. Level 2, the whole chat: Collapse (up, back to the tray) and Dock. Docked: only Undock. Task cards (`meta`) use the same ladder. Only the first cell shows at rest; the others open to its right on hover or focus. On touch every cell shows, with a 44 px hit area.
- `agent-card-composer` the chat bubble opens the composer alone on the folded card (no tray, no thread, `heights.composer`); Collapse hides it again. Expanding to level 1 or 2 puts the composer in the tray or the chat, and Collapse from the tray returns to the composer.
- `agent-card-dock` with `dock` (an element the host provides) the card has Dock: the chat moves there through a portal, the card stays in the list marked « Docked », Undock gives it back. `docked` and `onDockedChange` control it.
- `agent-card-background` the controller is the host's and keeps running while the card is folded. The activity line follows what the running tool says; a reply that came while folded puts the dot on the chevron.
- `agent-card-decision` an approval (`useAgentBarChat`'s `approval`, answered by `chatProps.actions.answer`) or a question the agent waits on shows on the folded card as the kit's own `ApprovalCard` or its choices, under a warning ring, with no auto-expand. Open (level 1, 2, docked) the chat shows it in the thread.

## How to get to it (user POV)

- The page lists the agent's work as cards. A card says what the agent is doing and its state. Tap its chat bubble to write to the agent, its header or Expand to read the conversation, the double chevron for the whole chat, Collapse to go back one step, Dock to move the chat to the side column.
- A card that needs the person shows the question on the card. One tap decides; the agent carries on while the card stays folded.

## Driving it with the UX harness

Preconditions: `CHROMIUM` set, `playwright-core` available (see `ux/README.md`).

- **Scenario.** `node ux/runner/cli.mjs check --target component:agent-card` (also `capture`): five states (queued, running, needs you, done, failed) with three agents in three colours, a task card with `meta`, over a scripted agent (no model). `ux/fixtures/component-agent-card.jsx`, script `ux/scenarios/scripts/agent-cards.json`.
- **Test.** `node --test test/ux-agent-card.test.mjs` at 390 and 1440: one chip per state, `agent-color` from a token, the running card updating while folded (`agent-card-background`), the approval on the folded card and Approve working there (`agent-card-decision`), the ladder through the strip at every step with its arrows (a task card too), tap and Esc (`agent-card`, `agent-card-strip`, `agent-card-composer`), a file card in the open chat (`agent-chat`), Dock and Undock (`agent-card-dock`), no sideways scroll and no console error; then the built site's menu and page.

## Gotchas

- The card has no input and no Stop or Retry button of its own: Stop is the composer's stop button while the run is live. The chat draws no Retry on a failed run's error; the person writes to the agent in the composer.
- The strip sits half outside the card, so the card must not clip it (`overflow-visible`); keep a margin below a card.
- The file cards need `chatProps.artifacts.open` (the host opens the file where it wants, a pane or a dock); without it a cited file is plain text.
- `registry/` is the strict design zone (no raw `<button>`, no `border`, no `rounded-lg`): the card is a ring and `rounded-(--radius-3xl)`, its dividers `Separator`.
- The words are English by default; `labels` overrides the card's, `chatProps.locale` the chat's (the folded activity uses the chat's tool words).
