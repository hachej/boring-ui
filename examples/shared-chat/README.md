# Shared conversation demo

This fictional team installs the optional `shared-chat` item over the existing embedded `AgentWorkspace`, PiChat composer and History. The page imports `useSharedChat` from `registry/shared-chat/shared-chat` and spreads `shared.workspaceProps`. Channel data comes only from `@hachej/boring-ui-kit/shared-chat`. Regular chat does not load this item.

Mira and Leo share the room with PM, Data and Julien as visible admin. PM proxies product work; Data is another host-exposed member. Delegation to internal agents is the host's business and stays out of the channel. The kit remains agnostic about which agents a different host exposes. No agent or model runs in this demo.

## Run the flow

1. Run `npm ci` and `npm run build` from the repository root.
2. Run `npm run shared-chat:demo` and open the printed URL.
3. Type `@`, choose PM and send `@pm ajoute un export PDF`.
4. PM says `Je regarde vos fichiers.`, then posts its plan. Its own message carries the three-step work trace. No Builder member, mention or message appears.
5. The trace defaults collapsed with one working Spinner. Expanding moves that Spinner to the current running step. The PM's single `Export PDF` card updates in place from `building` to `On attend votre essai`, with `Essayer cette version` as its action.
6. Hover or focus a PM message/card on desktop, or long-press on a phone, to expose Reply. On a narrow screen, keyboard users can focus the message and press Shift+F10. Send a follow-up through the existing composer. Its quote reveals the same parent card.
7. Open Admin through History and expand PM's finished trace to see its fictional detail. The fake host supplies no detail in Équipe.

Other people and agents use left-aligned muted bubbles; my own are right-aligned in the theme's primary bubble. The first bubble of a group has a small tail and, in a room of more than two, the author's name; the last has the author's small avatar (initials, or a sparkle glyph for agents, no status dot). Tapping a name shows the role (`Leo · validator`, `PM · the app’s agent`). Each bubble shows its time at the bottom right; each day starts with a centred pill. Consecutive bubbles are 2px apart, author groups 12px. Sent mentions show a small default Avatar and a medium-weight name on the surrounding text baseline, without `@` or a pill.

Agent IDs use a stable unsigned string hash modulo five to select `--chart-1` through `--chart-5`. Bot icons always use that token; people stay neutral. Names use the same token only where the default palette passes WCAG AA on both room and muted-bubble backgrounds, otherwise foreground. The theme now includes the previously omitted standard [shadcn chart defaults](https://ui.shadcn.com/docs/theming#default-theme-css) and bindings. No bespoke token or host override was added. Hosts changing chart values should repeat the contrast audit.

A localized day pill (« jeu. 10 sept. », « Aujourd’hui ») starts each day. Cards are compact bubbles in PM's group at the bubble maximum width: a title line, a muted line with the time, the choices as text buttons along the bottom. Reply actions never occupy a footer beneath the trace. In the member list, agent state indicators remain static dots; their Tooltip or phone Popover shows the latest card's line, and scrolling dismisses the Popover. The live bar stays quiet except for connection problems.

The registry guide owns the [source and state contract](../../registry/README.md#shared-conversations). The host enforces membership, roles, routing and trace-detail redaction. Replace the fake source with your `ChannelSource` or `createChannelSocket`, retain `useSharedChat(source)` and supply the real workspace provider for attachment reads.

## The block's story

`?story` (for example `http://127.0.0.1:<port>/?story`) renders `SharedChat` alone, as an app shows a channel on a phone: a fictional `#missing-receipts` room with yesterday's and today's messages, collapsed host notices (`kind: 'system'`), a request card with « Try · Later », a pinned comment (`card.kind: 'pin'`), the voice microphone in Send's place and an app control beside it (`tools`). The data is `story.mjs`, relative to now so the day pills read « Yesterday » and « Today ».

## Browser verification

Set `CHROMIUM` to a Chromium binary, then run `npm run shared-chat:journey`. It advances the fictional host deterministically through `?manual`, drives mentions, cards, quotes, History and trace collapse, and checks real browser geometry. Parallel-agent rendering remains covered by the public SharedChat test with an explicit second-agent fixture.

The journey ends with the story at 390 and 360, light and dark (`story-checks.mjs`): it opens on the latest message, nothing of the block covers a bubble, buttons are 44px, the small text (times, card lines, notices, day pills, the jump pill) passes WCAG AA, and a message arriving while scrolled up raises « 1 new message » below the list. Screenshots `story-<width>-<theme>.png`.

Four room-overview screenshots go to `.cache/evidence/shared-chat/r9/`: phone 390 first, then desktop 1440, light and dark. Each shows PM, Data and a mention of each. Names are `<width>-<theme>-room-overview.png`. The journey also checks final-card avatar alignment, records mention baseline measurements with the old alignment as a negative control, and audits all five palette buckets through the public entry against WCAG AA. `SHARED_CHAT_EVIDENCE` changes the directory. Geometry and browser-result JSON accompany the images. Browser evidence is fictional UI qualification, not a live-service or model run.

On the shared VM, run every npm/Node command through the lane's capped wrapper with `TMPDIR=/var/tmp NODE_OPTIONS=--max-old-space-size=8192`. Exit 75 means wait and retry in the foreground.

## The room source

`npm run shared-chat:journey:room` runs the same SharedChat over `createRoomSource` against a fictional room host (`room-backend.mjs`). The host speaks the `_room/*` door of boring-factory's `services/channel/room.mjs` and its space socket over the real `@hachej/boring-agent/room` kit on pi-durable's node SQLite (`roomView` is its only reader, `wakeFor` decides who answers). Its agents are scripted; no model runs. Open `?room&as=person:ana` (or `person:ben`) on the demo server to use it by hand.

The journey drives two fictional people (Ana and Ben, two Chromium pages) at 390 px: the room as stored (a notice, a message, a request card, a pin), the mention list (agents first, « Votre assistant », « Builder », « Un agent », no id), the working sign and the streamed answer taking the same place, a question card answered with one tap, a lost socket and the resume from the cursor, a silent agent (« Toujours en train de répondre… », Réessayer), and a card action. It measures B1 (my bubble in under 50 ms, host answering after 150 ms, the echo moving 0 px), B5 (layout shift 0 while the agent streams, scroll at the bottom) and B6 (the stall at 8 s). Screenshots and `budgets.json` go to `.cache/evidence/shared-chat/r3-room/` (`SHARED_CHAT_EVIDENCE` changes it). `room-backend.mjs` also takes `strict: true`, the door exactly as R2 ships it (no `wake` frame, no `conversationId` on stream frames, no open wakes in `history`); `test/packages/ui-room-source.test.mjs` runs both.
