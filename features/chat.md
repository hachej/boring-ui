# Chat

`pi-chat` is the conversation: transcript, composer, tool steps and reply cards, over a `NativeChatController`. Optional items add composer features and cards; each is absent without its item and its prop.

## Sub-features

- `chat-transcript` rows, tool steps, activity, Markdown replies (`pi-chat-markdown`), `presentation="natural"` for readers. Paging/chunks live in `packages/ui/src/chat-react-transcript.ts`; `registry/pi-chat/session.tsx` adapts the host's shadcn MessageScroller. Rendering: `registry/pi-chat/pi-chat.tsx`, `rows.ts`, `message.tsx`.
- `chat-session` headless state/files, connect/errors, send/restore, queue, uploads/paste and model/effort reconciliation, preserving existing app-kind send recovery and hidden-token paste coordinates. `packages/ui/src/chat-react-session.ts`; `registry/pi-chat/session.tsx` builds JSX/context/composer props only. Old contract imports remain re-exports for one release.
- `chat-connection-status` reusable `ChatConnectionNotice` / `ChatStatusLine` in `registry/pi-chat/notice.tsx`; PiChat and Ambient retain host connection recovery and identical developer/natural status choices. Compact Ambient keeps `loadFailedShort`/`disconnectedShort` overrides unless the host error renderer is supplied.
- `chat-composer` multi-line composer, including sizing/width observation after recording trash, queue (steer, edit, remove), draft kept per conversation (`useChatDraft`, `packages/ui/src/chat-react-draft.ts`). `registry/pi-chat/composer.tsx`, `queue.tsx`.
- `chat-slash` the `/` menu: commands and skills. `registry/pi-chat-slash/slash-menu.tsx`.
- `chat-mentions` the `@` menu for files and, through `MentionsConfig`, any catalog of ids. `registry/pi-chat-mentions/mention-menu.tsx`, `registry/pi-chat/config.ts`.
- `chat-attachments` attach, paste, drop, paste-to-file, phone camera sheet. `registry/pi-chat-attachments/camera-sheet.tsx`.
- `chat-voice` tap-to-record with one replacement composer row: trash, timer, input waveform and Send. Presentation: `registry/pi-chat-voice/`; attempt ownership, dictation and retained-message preparation: `packages/ui/src/voice-attempt.ts`, `chat-dictation.ts`, `chat-voice-message.ts` through the opt-in `chat-react` entry.
- `chat-voice-lifecycle` one shared capture owner fences late permission/transcription, committed target changes and unmount; configurable dictation `maxMs` caps captured audio without sending automatically. `packages/ui/src/voice-attempt.ts`, `chat-dictation.ts`.
- `chat-voice-pause` pause/resume excludes paused PCM samples and freezes the timer; waveform bars advance only with captured samples and stop at the cap; unavailable capabilities are omitted on fallback recorders. `packages/ui/src/voice-capture.ts`.
- `chat-target-chip` a sent message that starts with a `<target>` block (point-and-speak) shows a chip and the speech; no raw target value shows anywhere (chip text, hover, accessibility tree, queued and sending rows, the conversation list's titles and tooltip; automatic titles and previews in `packages/agent/src/conversations.ts` drop the block). The chip reads the target's `label`, else the display keys it wraps its fields under, else « Target »; `targetLabel(target)` on PiChat, AmbientChat and SharedChat picks its words without changing the block's JSON. `registry/pi-chat/message.tsx`, `queue.tsx`, `history.tsx`, `registry/shared-chat/timeline.tsx`, `packages/ui/src/chat-view.ts` (`targetContent`).
- `chat-voice-replay` sent voice is transcript-only by default; explicit `voiceReplay` opts into the retained player without changing stored audio. `registry/pi-chat/message.tsx`.
- `chat-voice-untranscribed` audio-only recovery shows a localized non-playback missing-transcript status, including retained messages after reload. `registry/pi-chat/message.tsx`, `labels.ts`, `labels-fr.ts`.
- `chat-kind-skill` a registered leading `/skill` stays first in native submissions ahead of hidden app tokens, including unfinished quoted input. `packages/ui/src/chat-text.ts`, `registry/pi-chat/composer.tsx`.
- `chat-kind-mentions` registered app kinds show readable removable chips, hide their tokens from editable text and retain them in native submissions; sent kind/file mentions share text-line alignment. `registry/pi-chat/composer.tsx`, `packages/ui/src/chat-text.ts`.
- `chat-pickers` model and effort menus. `registry/pi-chat-pickers/pickers.tsx`.
- `chat-cards` question (`ask_user`), approval, sub-agent and artifact cards. `registry/pi-chat-question/`, `pi-chat-approval/`, `pi-chat-subagent/`, `pi-artifacts/`.
- `chat-conversations` History with New, rename, archive, fork over the host's conversations handler (`useConversationsClient`). `packages/ui/src/chat-react-conversations.ts`, `registry/pi-chat/history.tsx`; old hook imports re-export for one release.
- `chat-remote` `useRemoteChat` connects a concrete controller to the host's chat transport, with `requestContext` and placement. `packages/ui/src/chat-react-remote.ts`, `chat-react-controller.ts`; old hook imports re-export for one release.
- `chat-plugins` `withChatPlugins(props)` fills every missing component and card. `registry/pi-chat-plugins/chat-plugins.ts`.

## How to get to it (user POV)

- Inside the agent layer, an agent workspace, the ambient bar or a bare `PiChat` page.
- Composer: type `/` for commands, `@` for files or entities, `+` to attach, tap the microphone to record.

## Driving it with the example journeys

Preconditions: `npm run build`, Chromium; journeys use a scripted fake model unless stated.

- **Transcript and composer.** `chat-transcript`, `chat-composer`: `npm run workspace-app:journey`; send a message, a Markdown reply renders, a queued prompt can be edited.
- **Menus.** `chat-slash`, `chat-mentions`, `chat-pickers`: type `/` and `@` in the composer, pick an option; a chip appears.
- **Attachments and voice.** `chat-attachments`, `chat-voice`: `npm run app-shell:journey:voice`, `APP_ONLY=inline-images npm run workspace-app:journey`.
- **Target chip.** `chat-target-chip`: `node --test test/contracts/pi-chat-target-chip.test.mjs`; render `PiChat` with a sent and a queued target carrying `mealId`, check no raw field in text or attributes, pass `targetLabel` and read its words; the same through `SharedChat`, and the conversation list's tooltip.
- **Cards, pause and replay.** `chat-kind-mentions`, `chat-voice-pause`, `chat-voice-replay`: `node examples/app-shell/journey-talk-about.mjs` at 390px and desktop; start from a card, pause/resume, Send, inspect transcript-only output and one-/three-line alignment. `npm run app-shell:journey:voice` explicitly opts into replay and plays the retained audio after reload.
- **Capture lifecycle.** `chat-voice-lifecycle`: `node --test test/packages/ui-chat-react-voice.test.mjs test/ui/voice-input.test.mjs`; start with pending permission and cancel, settle the late grant, reach a short configured cap, then explicitly finish; no old-target delivery or automatic send. The public tests also leave a target transition suspended and verify only committed callbacks are used.
- **Recovery and skills.** `chat-voice-untranscribed`, `chat-kind-skill`: `node --test test/contracts/pi-chat-file-cards.test.mjs test/contracts/talk-about-render.test.mjs`; select a skill with a card chip and Send; explicitly send an empty transcription as audio-only, then reload. The same public paths check capped waveform freeze. The talk-about browser journey types a multiline draft, records/trashes it and narrows the host to check restored sizing/observation (`chat-composer`).
- **Cards.** `chat-cards`: trigger `ask_user` and an approval in the scripted run; answer in the card.
- **Conversations.** `chat-conversations`: create, rename, archive and fork a conversation from History.
- **Remote and plug-ins.** `chat-remote`, `chat-plugins`: `npm run test:pi-chat-consumer` installs the block into a clean app and mounts it.
- **Paging and drafts.** `chat-transcript`, `chat-composer`: `npm run test:chat-scroll` drives the 500-row long-chat example; `npm run draft-recovery:journey` checks reload recovery.
- **Headless session and recovery.** `chat-session`, `chat-connection-status`: `node --test test/packages/ui-chat-session.test.mjs test/ui/ambient-position.test.mjs` drives public send/restore/queue/upload/paste/pickers (including overlapping feedback with actual native unknown admission) and compact/expanded Ambient errors/status, short-label overrides and host-renderer precedence. `npm run staged-chat:journey` and `npm run ambient:journey:scripted` drive the browser controls.
- **Proof.** Transcript ARIA snapshot and screenshot per ID, plus the stored conversation read again after reload.

## Gotchas

- A composer feature with no `Picker`/`Button` component renders nothing; install the item.
- Visual values are tokens only; `boring-ui-blocks check --design src` fails literals.
- `natural` presentation changes rendering only, never the stored history.
