# Shared conversation demo

This fictional team uses the existing embedded `AgentWorkspace`, `PiChat`, composer and History. Mira and Leo share it with a PM agent, a worker agent and Julien as visible admin. No agent or model runs in the page. The fake host script illustrates the platform's responses. Leo's initial message is attributed to Leo with muted `via Claude`, not an Agent badge.

## Run the flow

1. Run `npm ci` and `npm run build` from the repository root.
2. Run `npm run shared-chat:demo` and open the printed URL.
3. Type `@`. Agents appear first. Choose PM and send `@pm ajoute un export PDF`.
4. PM first says `Je regarde vos fichiers.`, then streams a two-line plan that hands the layout to Builder. PM finishes before Builder starts. Builder posts one `Je prépare la mise en page du PDF.` message with a three-step trace.
5. The Builder trace defaults collapsed with one working Spinner. Expand it to move the Spinner to the running step. The single `Export PDF` card starts in `building`, then updates in place to `On attend votre essai`, with `Essayer cette version` as its one action.
6. Hover/focus the message on desktop, or long-press it on a phone, to reveal the same Reply icon. Click it, type a follow-up and send it. The composer chip and sent message quote the same card. Click the quote to reveal its parent.
7. Open Admin through History. Expand the finished trace to see its fictional detail. The fake host supplies no detail in Équipe.

Leo's message uses the same muted bubble as Mira's, mirrored left, with a small group header. Sent mentions are inline text. The live bar stays quiet unless reconnecting or offline.

Agent avatars reflect the latest card's state. Working shows a static primary corner dot; waiting shows a muted dot. There is no avatar spinner. Hover an avatar for the card's line, or tap it on a phone for a bottom/start Popover that closes on scroll. Author groups restart after a gap longer than one minute. The result stays on the card, without a duplicate status message. The registry guide owns the full [state and source contract](../../registry/README.md#shared-conversations).

On the shared implementation VM, run every npm or Node command through the lane's capped wrapper with `TMPDIR=/var/tmp`. Exit 75 means wait and retry in the foreground.

## Run the browser journey

Set `CHROMIUM` to a Chromium binary, then run `npm run shared-chat:journey`. The journey uses `?manual` to advance the fictional host deterministically. It drives the existing workspace, member picker, composer, cards, quotes, avatar disclosures and native activity rendering.

Screenshots go to `.cache/evidence/shared-chat/`, phone 390 first, then desktop 1440, in light and dark. Files use `<width>-<theme>-<stage>.png`, including `mentions-agents`, `summon-plan`, `card-building`, `card-result`, `quote-composer`, `quote-sent`, `doing-answer`, `avatar-working`, `avatar-waiting`, `trace-live` (collapsed), `trace-live-expanded`, `trace-collapsed`, `conversation` and `admin-trace-expanded`. The CH-10 attribution captures are `390-light-via.png` and `1440-light-via.png`; both show Leo as a person with `via Claude`. A final 360px check rejects horizontal overflow. `SHARED_CHAT_EVIDENCE` changes the directory.

The page's `window.__SHARED__` exposes fake host controls for this demo only. `pdf-flow.mjs` is not kit scheduling or speaking policy. This demo is sequential; the kit's separate per-agent traces still support parallel work, covered by the public PiChat test. A real host forwards to each agent's Pi conversation, enforces membership and roles, strips trace detail outside Admin, and posts permitted messages and replacements into its log. Replace the fake source with your `ChannelSource` or `createChannelSocket`, retain `useSharedChat(source)`, and supply the real workspace provider for attachment reads.
