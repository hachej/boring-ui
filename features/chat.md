# Chat

`pi-chat` is the conversation: transcript, composer, tool steps and reply cards, over a `NativeChatController`. Optional items add composer features and cards; each is absent without its item and its prop.

## Sub-features

- `chat-transcript` rows, tool steps, activity, Markdown replies (`pi-chat-markdown`), `presentation="natural"` for readers. `registry/pi-chat/pi-chat.tsx`, `rows.ts`, `message.tsx`.
- `chat-composer` multi-line composer, queue (steer, edit, remove), draft kept per conversation (`useChatDraft`). `registry/pi-chat/composer.tsx`, `queue.tsx`.
- `chat-slash` the `/` menu: commands and skills. `registry/pi-chat-slash/slash-menu.tsx`.
- `chat-mentions` the `@` menu for files and, through `MentionsConfig`, any catalog of ids. `registry/pi-chat-mentions/mention-menu.tsx`, `registry/pi-chat/config.ts`.
- `chat-attachments` attach, paste, drop, paste-to-file, phone camera sheet. `registry/pi-chat-attachments/camera-sheet.tsx`.
- `chat-voice` tap-to-record with one replacement composer row: trash, timer, input waveform and Send. `registry/pi-chat-voice/`.
- `chat-voice-pause` pause/resume excludes paused PCM samples and freezes the timer; unavailable capabilities are omitted on fallback recorders. `packages/ui/src/voice-capture.ts`.
- `chat-voice-replay` sent voice is transcript-only by default; explicit `voiceReplay` opts into the retained player without changing stored audio. `registry/pi-chat/message.tsx`.
- `chat-kind-mentions` registered app kinds show readable removable chips, hide their tokens from editable text and retain them in native submissions; sent kind/file mentions share text-line alignment. `registry/pi-chat/composer.tsx`, `packages/ui/src/chat-text.ts`.
- `chat-pickers` model and effort menus. `registry/pi-chat-pickers/pickers.tsx`.
- `chat-cards` question (`ask_user`), approval, sub-agent and artifact cards. `registry/pi-chat-question/`, `pi-chat-approval/`, `pi-chat-subagent/`, `pi-artifacts/`.
- `chat-conversations` History with New, rename, archive, fork over the host's conversations handler (`useConversations`). `registry/pi-chat/use-conversations.ts`, `history.tsx`.
- `chat-remote` `useRemoteChat` connects a controller to the host's chat transport, with `requestContext`. `registry/pi-chat/use-remote-chat.ts`.
- `chat-plugins` `withChatPlugins(props)` fills every missing component and card. `registry/pi-chat-plugins/chat-plugins.ts`.

## How to get to it (user POV)

- Inside the agent layer, an agent workspace, the ambient bar or a bare `PiChat` page.
- Composer: type `/` for commands, `@` for files or entities, `+` to attach, tap the microphone to record.

## Driving it with the example journeys

Preconditions: `npm run build`, Chromium; journeys use a scripted fake model unless stated.

- **Transcript and composer.** `chat-transcript`, `chat-composer`: `npm run workspace-app:journey`; send a message, a Markdown reply renders, a queued prompt can be edited.
- **Menus.** `chat-slash`, `chat-mentions`, `chat-pickers`: type `/` and `@` in the composer, pick an option; a chip appears.
- **Attachments and voice.** `chat-attachments`, `chat-voice`: `npm run app-shell:journey:voice`, `APP_ONLY=inline-images npm run workspace-app:journey`.
- **Cards, pause and replay.** `chat-kind-mentions`, `chat-voice-pause`, `chat-voice-replay`: `node examples/app-shell/journey-talk-about.mjs` at 390px and desktop; start from a card, pause/resume, Send, inspect transcript-only output and one-/three-line alignment. `npm run app-shell:journey:voice` explicitly opts into replay and plays the retained audio after reload.
- **Cards.** `chat-cards`: trigger `ask_user` and an approval in the scripted run; answer in the card.
- **Conversations.** `chat-conversations`: create, rename, archive and fork a conversation from History.
- **Remote and plug-ins.** `chat-remote`, `chat-plugins`: `npm run test:pi-chat-consumer` installs the block into a clean app and mounts it.
- **Proof.** Transcript ARIA snapshot and screenshot per ID, plus the stored conversation read again after reload.

## Gotchas

- A composer feature with no `Picker`/`Button` component renders nothing; install the item.
- Visual values are tokens only; `boring-ui-blocks check --design src` fails literals.
- `natural` presentation changes rendering only, never the stored history.
