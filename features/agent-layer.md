# Agent layer

The agent the shell mounts once: a bottom drawer on a phone, a right panel on a wide screen, reachable from every screen.

## Sub-features

- `layer-drawer` phone drawer with peek, half and full; swipe and outside tap go to peek, only the handle drags. `registry/app-shell/agent-layer.tsx`.
- `layer-dock` wide panel docked right, floatable and dockable left or right, remembered per viewer (`boring.app-shell`). `registry/dock/dock.tsx`.
- `layer-context` the screen on show travels with each message (`useAgentContext`). `registry/app-shell/agent-context.ts`.
- `layer-voice` single-tap composer recording with the shared trash/timer/waveform/pause/Send row; optional header hold remains. Waveform history freezes when no new PCM samples arrive, including the capture cap. `send: 'auto' | 'draft' | 'message'`. `registry/app-shell/use-dictation.ts`, `registry/pi-chat-voice/voice-message.tsx`.
- `layer-talk-about` a card gesture inserts a removable kind mention, opens the real chat at half or in the panel and can start capture before returning. `registry/app-shell/agent-layer.tsx`.
- `layer-launch-link` `agentLink` / `parseAgentLink` open the layer from a URL or a home-screen shortcut. `registry/app-shell/agent-link.ts`.
- `layer-loan` `useAgentLoan` lends a workspace's controller to the layer at peek. `registry/app-shell/agent-layer.tsx`.
- `layer-improve` second agent under « Améliorer l'app » in the account menu (`improve` prop). `registry/app-shell/account.tsx`.

## How to get to it (user POV)

- The assistant button in every screen header; on a phone the peek above the tab bar.
- A link such as `?agent=coach&open=full&input=voice`.

## Driving it with the app-shell journeys

Preconditions: as `app-shell.md`.

- **Drawer.** `layer-drawer`: at 390px open the trigger, step peek, half, full, press Escape (back to peek). `npm run app-shell:journey`.
- **Dock.** `layer-dock`: at desktop width open the layer, float it, dock it left, reload; the side is remembered.
- **Context.** `layer-context`: switch screens and read the `context` of the next submit in the request.
- **Voice.** `layer-voice`: `npm run app-shell:journey:voice` (fake microphone), tap Record, trash or Send; this fixture explicitly opts into replay after reload. `node --test test/contracts/talk-about-render.test.mjs` drives capped PCM through both dictation modes and retained voice, checks frozen waveform/time and sends the capped recording.
- **Talk about a card.** `layer-talk-about`: `node examples/app-shell/journey-talk-about.mjs`; swipe a card at 390px or click its desktop mic, inspect the shared recording row and hidden-code chip, pause/resume and Send; the thread shows the transcript and inline mention without a player.
- **Launch link.** `layer-launch-link`: open `/?agent=coach&open=full`; the layer opens once and the query is cleaned.
- **Loan.** `layer-loan`: `npm run app-shell:journey:placed`, collapse the workspace on a phone; the layer opens at peek.
- **Improve.** `layer-improve`: open the account menu, choose « Améliorer l'app ».
- **Proof.** ARIA snapshot and screenshot per state, a second read of the conversation after a send.

## Gotchas

- The peek never closes by swipe: the agent stays reachable. Close from half or full.
- Launch parameters are read once on mount; `agentLink={false}` turns it off.
- A shell with its own `agent` refuses a loan.
