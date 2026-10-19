# Shared conversation demo

This fictional garden team uses the existing `AgentWorkspace` embedded layout, `PiChat`, composer, artifact panel and History. Mira and Leo share it with a PM agent, a worker agent and Julien as visible admin. Two request cards come from the fake host source. No agent or model runs in this demo.

## Run the demo

1. Run `npm ci` and `npm run build` from the repository root.
2. Run `npm run shared-chat:demo`.
3. Open the printed URL. Use History to select Main, Admin or Mira and Leo. Type `@` to choose a member.

On the shared implementation VM, run every npm or Node command through the lane's capped wrapper with `TMPDIR=/var/tmp`. Exit 75 means wait and retry in the foreground.

## Run the browser journey

Set `CHROMIUM` to a Chromium binary, then run `npm run shared-chat:journey`. The journey starts a disposable page and browser profile. It exercises authors, mentions, card actions and replacements, presence, History switching and streaming in the existing chat. It captures 390px phone screenshots first, then 1440px desktop screenshots, in light and dark. A final 360px check rejects horizontal overflow.

Evidence goes to `.cache/evidence/shared-chat/`. `SHARED_CHAT_EVIDENCE` changes that directory. The page's `window.__SHARED__` exposes the fake source's demo controls only.

## Connect a real host

Replace `createFakeChannelSource(seed)` with your `ChannelSource`, or await `createChannelSocket({ url, fetch })`. Keep `useSharedChat(source)` and the existing workspace. Supply the real workspace provider for attachment reads and the artifact panel.

The host decides who can see each conversation, who can remove messages and when agents speak. It forwards work to each agent's own Pi conversation and writes permitted replies to its shared log. The kit only renders that log. See [Shared conversations](../../registry/README.md#shared-conversations) for the exported shapes, default routes and send-idempotency contract.
