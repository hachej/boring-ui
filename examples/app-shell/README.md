# App shell example

A fictional fitness app ("Forme") in `<AppShell layout="screen">` from `registry/app-shell/`: three screens (bottom tabs on a phone, the sidebar on a wide screen), a header per screen (`useScreenHeader`), the account menu, and the `AgentLayer` with the coach (push-to-talk) and, from the account menu, the product manager. Compact (below 768px) the layer is a bottom drawer with peek, half and full snap points; expanded it is a right panel. `components/`, `hooks/` and `lib/` are pinned shadcn fixtures (see their header), used only to type-check and run the item.

```sh
npm run app-shell           # the page on a local port (?app=fitness|empty, &nav=6 for « Plus », ?agent=none, ?send=draft)
npm run app-shell:journey   # real-browser journey at 390x844 with touch, plus the 1280x800 panel (scripted model, no key), screenshots under .cache/evidence/app-shell/
```

The server only serves the page and the chat transport (two agents); `STUDIO_MODEL=scripted` (set by the journey) answers from `script.mjs`. It records each submit body and the `context` the transport hands to `requestContext`.

## Talk about a meal

Open `?talkAbout=1&send=message#jour`. Swipe the fictional lunch card on a phone, or click its microphone on desktop. The card's gesture calls `useAgentLayer().talkAbout('@repas:2026-10-27/dejeuner', { voice: true })` directly. `agent.chatProps.mentions.kinds.repas` supplies the readable label and icon. The same real chat opens at half or in its panel, already recording, with the shared replacement recording row and removable chip. The row contains trash, a polite timer, live input waveform, pause/resume and Send. Sent messages show only the transcript and inline meal mention, aligned on the text line; the retained audio token stays in the native message and survives reload. Replay is explicit: `agent.chatProps.voiceReplay = true` (`?replay=1` in this fixture). No card highlight or inline reply component is used.

Run `CHROMIUM=<binary> node examples/app-shell/journey-talk-about.mjs`; screenshots default to `.agent-handoff/talk-about/shots/` (ignored), or set `TALK_ABOUT_EVIDENCE`. The journey checks phone one-/three-line transcript alignment and flush wrapping plus file-mention alignment, saving `phone-one-line-transcript.png`, `phone-three-line-transcript.png` and `phone-file-mention-line.png` alongside the four recording/thread screenshots.

## Point and dictate (D108)

Open `?targets=1#jour` for a fictional meal list. The header's microphone toggles targeting; touch the lunch to start recording, then Stop and send. The fake transcription is “remplace le riz par 150 g de pâtes”; a scripted native coach reply appears beside the meal while chat stays closed. `onSettled` refetches `/api/meals` once. The fixture list is static: this journey proves contextual submission, reply attribution and refresh wiring, not a real meal mutation or speech provider.

Run `npm run app-shell:journey:target` with `CHROMIUM` set. The journey covers 390×844 and 1280×800, a shortened visual viewport, normal unmarked/disabled taps, one send, refresh and track cleanup. Screenshots go to `.cache/evidence/D108/`.

Card mention kinds are chip-only in the composer: their tokens stay in the native draft but never appear in its text box. A single mic tap or card gesture starts exactly the same composer row. Send finishes (or fills the draft in draft mode), trash discards, and PCM pause freezes the waveform/timer without adding paused samples to the WAV. The editable row/normal controls return afterwards. There is no top recording overlay; unavailable waveform/pause are omitted on the MediaRecorder fallback.
