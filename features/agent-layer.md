# Agent layer

The agent the shell mounts once: a bottom drawer on a phone, a right panel on a wide screen, reachable from every screen.

## Sub-features

- `layer-drawer` phone drawer with peek, half and full; swipe and outside tap go to peek, only the handle drags. The trigger is a toggle: it closes half and full, and reveals peek. `registry/app-shell/agent-layer.tsx`.
- `layer-dock` wide panel docked right, floatable and dockable left or right, remembered per viewer (`boring.app-shell`). `registry/dock/dock.tsx`.
- `layer-context` the screen on show travels with each message (`useAgentContext`). `registry/app-shell/agent-context.ts`.
- `layer-voice` single-tap composer recording with the shared trash/timer/waveform/pause/Send row; optional header hold remains. Waveform history freezes when no new PCM samples arrive, including the capture cap. `send: 'auto' | 'draft' | 'message'`. Kit orchestration: `packages/ui/src/chat-voice-message.ts` (`useChatVoice`), `chat-dictation.ts` and `voice-attempt.ts`. Compatibility/presentation: `registry/app-shell/use-dictation.ts`, `registry/pi-chat-voice/voice-message.tsx`.
- `layer-talk-about` a card gesture inserts a removable kind mention, opens the real chat at half or in the panel and can start capture before returning. `registry/app-shell/agent-layer.tsx`.
- `layer-launch-link` `agentLink` / `parseAgentLink` open the layer from a URL or a home-screen shortcut. `registry/app-shell/agent-link.ts`.
- `layer-loan` `useAgentLoan` lends a workspace's controller to the layer at peek. `registry/app-shell/agent-layer.tsx`.
- `layer-improve` second agent under « Améliorer l'app » in the account menu (`improve` prop). `registry/app-shell/account.tsx`.
- `layer-improve-no-row` `ShellPanel.menu: false`: no account menu row, compact or expanded; the panel's Provider, Layout and page keep working. `registry/app-shell/shell-panel.tsx`.
- `layer-together` from 1360px (`TOGETHER_FROM`) the assistant dock and the PM column are open side by side: opening one leaves the other, the dock's Close and the PM's own close (and its Back entry) close only their own, and a view of the app (`useShellLayer`) closes both; `close()` closes what `showing` names. Below 1360px and on a phone they stay one at a time. `registry/app-shell/agent-layer.tsx`.
- `layer-composer-content` `AppShell composer="content"` (default `"dock"`): on a wide screen the assistant's one field is drawn under the page content, at the chat's 720px width with nothing below it, and the dock holds only the thread. The same `PiChat` (one controller, one session, the phone peek's too) draws its footer into the content column (`PiChat composerHost`); a send or `talkAbout` opens the reply as a tray above the field (`layer-tray`), or the dock when that is the person's choice (`layer-tray-mode`); closing either leaves the field. A file dragged over the content shows an overlay and a drop anywhere on it (but the composer, which takes its own) becomes an attachment of that composer, the same chip as a cited row. Below 768px nothing changes: the peek drawer. `registry/app-shell/agent-layer.tsx` (`ContentColumn`), `registry/pi-chat/pi-chat.tsx` (`composerHost`, `dropZone`, `onSent`).
- `layer-tray` With `composer="content"` on a wide screen a send or `talkAbout` opens the thread as a tray just above the field, not in the dock: the desktop twin of the phone's peek to half, the same thread and controller (the chats' host element moves, nothing is remounted). The tray is the field's width, `min(35%, 360px)` of the content column; the page above shrinks instead of being covered and the cited row is scrolled into view. Its header holds the thread's title, then Dock, Agrandir (fills the main column, not a modal) and Réduire (kit ghost icon Buttons with aria-labels, 44px on touch); Réduire or Esc (not while a menu, dialog or IME composition owns it) goes back to the bare field with focus on it, and the next send reopens the thread where it was. No second composer. `composer="dock"` and the phone are unchanged. `registry/app-shell/agent-layer.tsx` (`ContentTray`).
- `layer-tray-mode` The person's choice of tray or dock is remembered (localStorage `boring-ui:sidebar-agent-mode[-screen]:<app>[:<person>]`, keyed like the left pane's open choice (D-1919): per app, per person, per layout; it reloads when the account switches, and focus that was on a removed tray control goes to the field) and is the default for the next send and for `talkAbout`; Dock in the tray header moves the same thread to the right pane (focus goes to a dock control, never the body) and closing the dock goes back to the tray mode.
- `layer-field-at-rest` (D-2026) With `composer="content"` on a wide screen the field is in `agent-content-composer` whenever the layer is closed, even when the PM was the view shown first (the assistant arriving late): the assistant's one chat stays mounted with its composer portaled into the slot and its thread hidden; a send opens the tray on the same thread with the draft kept, the close button and Esc keep the field and its focus, and dock and back keep exactly one `composer-input`. `Chats` in `registry/app-shell/agent-layer.tsx`. Drive: `composer-content.test.mjs` case `the assistant arriving after a PM panel` (fixture `?composer=content&pm=1&late=1`).

## How to get to it (user POV)

- The assistant button in every screen header; on a phone the peek above the tab bar.
- A link such as `?agent=coach&open=full&input=voice`.

## Driving it with the app-shell journeys

Preconditions: as `app-shell.md`.

- **Drawer.** `layer-drawer`: at 390px open the trigger, step peek, half, full, press Escape (back to peek), tap the trigger at half and at full (closed). `npm run app-shell:journey`.
- **Dock.** `layer-dock`: at desktop width open the layer, float it, dock it left, reload; the side is remembered.
- **Context.** `layer-context`: switch screens and read the `context` of the next submit in the request.
- **Voice.** `layer-voice`: `npm run app-shell:journey:voice` (fake microphone), tap Record, trash or Send; this fixture explicitly opts into replay after reload. `node --test test/contracts/talk-about-render.test.mjs` drives capped PCM through both dictation modes and retained voice, checks frozen waveform/time and sends the capped recording.
- **Talk about a card.** `layer-talk-about`: `node examples/app-shell/journey-talk-about.mjs`; swipe a card at 390px or click its desktop mic, inspect the shared recording row and hidden-code chip, pause/resume and Send; the thread shows the transcript and inline mention without a player.
- **Field at rest.** `layer-field-at-rest`: `node --test test/contracts/composer-content.test.mjs` (case `the assistant arriving after a PM panel`, 1280, fixture `?composer=content&pm=1&late=1`: the slot holds the one `composer-input` at rest, a send opens the tray on the same thread, the close button and Esc keep the field and its focus, dock and back keep exactly one field).
- **Content composer.** `layer-composer-content`: `node --test test/contracts/composer-content.test.mjs` (1280: one composer in the main column, none in the dock; a send opens the tray on the same thread, Dock moves it to the pane and closing the dock goes back to the tray (`layer-tray`, `layer-tray-mode`: also tray geometry and the cited row in view, Agrandir and Réduire with focus on the field, Esc yielding to a menu, the mode remembered after a reload, no tray for `composer="dock"` or at 390); Close leaves the field; `talkAbout` chip; a voice send opens the tray; the screen keeps its state and the field its focus across the 768px crossing; a dropped file shows the overlay and becomes a chip; 390 is the peek). Shots in CI artifact `composer-content-shots`.
- **Launch link.** `layer-launch-link`: open `/?agent=coach&open=full`; the layer opens once and the query is cleaned.
- **Loan.** `layer-loan`: `npm run app-shell:journey:placed`, collapse the workspace on a phone; the layer opens at peek.
- **Improve.** `layer-improve`: open the account menu, choose « Améliorer l'app ».
- **No row.** `layer-improve-no-row`: `node --test test/contracts/app-shell-render.test.mjs` (the row is absent with `menu: false` and present without; Provider and Layout mount in both).
- **Together.** `layer-together`: at 1440px open the assistant, then « Améliorer l'app »; both show and both answer; close one, the other stays; at 390px opening one closes the other. `node --test test/contracts/app-shell-render.impl.mjs --test-name-pattern="wide enough for both"`.
- **Proof.** ARIA snapshot and screenshot per state, a second read of the conversation after a send.

## Gotchas

- The peek never closes by swipe: the agent stays reachable. Close from half or full.
- Launch parameters are read once on mount; `agentLink={false}` turns it off.
- A shell with its own `agent` refuses a loan.
- Between 768px and 1360px the dock, the 26rem PM column and the screen do not fit together: the PM replaces the assistant there, as on a phone.
