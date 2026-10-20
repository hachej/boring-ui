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

Other people and agents use the same left-aligned muted bubbles. A small muted name heads each group. One avatar sits bottom-left beside its last item, including a final request card, with initials for people and a Bot fallback for agents. Own messages stay right-aligned, without a name or avatar. Consecutive bubbles have an 8px gap; author groups have a 24px gap. Sent mentions show a small default Avatar and a medium-weight name on the surrounding text baseline, without `@` or a pill.

Agent IDs use a stable unsigned string hash modulo five to select `--chart-1` through `--chart-5`. Bot icons always use that token; people stay neutral. Names use the same token only where the default palette passes WCAG AA on both room and muted-bubble backgrounds, otherwise foreground. The theme now includes the previously omitted standard [shadcn chart defaults](https://ui.shadcn.com/docs/theming#default-theme-css) and bindings. No bespoke token or host override was added. Hosts changing chart values should repeat the contrast audit.

A localized centered timestamp appears before the first message and after gaps over fifteen minutes. Cards attach below PM's group at the bubble maximum width. Reply actions never occupy a footer beneath the trace. Avatar state indicators remain static dots. Their Tooltip or phone Popover shows the latest card's line; scrolling dismisses the Popover. The live bar stays quiet except for connection problems.

The registry guide owns the [source and state contract](../../registry/README.md#shared-conversations). The host enforces membership, roles, routing and trace-detail redaction. Replace the fake source with your `ChannelSource` or `createChannelSocket`, retain `useSharedChat(source)` and supply the real workspace provider for attachment reads.

## Browser verification

Set `CHROMIUM` to a Chromium binary, then run `npm run shared-chat:journey`. It advances the fictional host deterministically through `?manual`, drives mentions, cards, quotes, History and trace collapse, and checks real browser geometry. Parallel-agent rendering remains covered by the public SharedChat test with an explicit second-agent fixture.

Four room-overview screenshots go to `.cache/evidence/shared-chat/r9/`: phone 390 first, then desktop 1440, light and dark. Each shows PM, Data and a mention of each. Names are `<width>-<theme>-room-overview.png`. The journey also checks final-card avatar alignment, records mention baseline measurements with the old alignment as a negative control, and audits all five palette buckets through the public entry against WCAG AA. `SHARED_CHAT_EVIDENCE` changes the directory. Geometry and browser-result JSON accompany the images. Browser evidence is fictional UI qualification, not a live-service or model run.

On the shared VM, run every npm/Node command through the lane's capped wrapper with `TMPDIR=/var/tmp NODE_OPTIONS=--max-old-space-size=8192`. Exit 75 means wait and retry in the foreground.
