# Agent bar

The voice-first bar of an agent that works in the background (Coach Max): a pill with a history arrow, the field, the mic and send, and `AgentStatus`, the one line above it. The audio is the kit's (`useDictation`, `useHoldToRecord`); the app supplies `transcribe` and `onSend`. Registry item `agent-bar`.

## Sub-features

- `agent-bar-field` `AgentBar` rests as a pill: history arrow (only with `onHistory`; `historyOpen` flips it and sets `aria-expanded`), the field (« Maintiens pour parler », or `placeholder`), the mic and ↑. ↑ is disabled while the field is empty; Enter or ↑ calls `onSend({ text })` once and clears the field.
- `agent-bar-listen` one tap on the mic listens: the bar is outlined in primary and holds ✕ Annuler, a waveform, ■ Arrêter and ↑ Envoyer. ■ hands the audio to `transcribe` and the text lands in the field, shown in italics above the bar; ↑ sends it; ✕ sends nothing and releases the microphone.
- `agent-bar-hold` a press held past 300ms shows « Relâche pour envoyer »; release transcribes and sends. Sliding more than 24px off the button (measured from where it was pressed, although the mic moves to the left while held), Escape, blur or a hidden page cancels without sending (the kit's `useHoldToRecord` policy, `pressBounds`). A refused microphone leaves the bar at rest with the error, never listening.
- `agent-bar-cancel` ✕ Annuler (and Escape) stay available while the audio is transcribed; a cancel then sends nothing and puts nothing in the field.
- `agent-bar-focus` entering listening moves focus to ■ Arrêter; stop, cancel or send give it back to the field.
- `agent-bar-quoted` `quoted={{ label, onClear }}` shows a chip « ↪ label » above the bar, outlines the bar and puts `quoted: label` in the next `onSend`. ✕ Retirer la citation calls `onClear`; the app removes the chip.
- `agent-bar-partial` `partial` is text shown after the final transcript, dimmed (the app's own extra not-yet-final words; `stream` feeds the same slot itself).
- `agent-bar-live` `stream={async (sink, signal) => ({ stop, cancel })}` replaces `transcribe`: while listening or held the bar shows the words as they come above it, final words in the text colour and not-yet-final words dimmed (`text-muted-foreground`). The stream calls `sink.partial(text)` (replaces the dimmed tail), `sink.final(text)` (appends, clears the tail), optionally `sink.level(0..1)` for the waveform and `sink.fail(problem?)`; `stop()` resolves once the last finals are delivered. Stop puts only the final words in the field; release (hold) and send use them; Annuler calls `cancel()` and sends nothing. `useLiveDictation` is the hook underneath.
- `agent-status` `AgentStatus` `{ state: 'working' | 'done', text, onCancel? }`: a spinner and the sentence, with « Annuler » only while working and when `onCancel` is given; a check and the result when done.
- `agent-question` (the card scrolls inside itself past `max-h-96`, so a tall answer card never covers the page; mount the bar pinned at the bottom of the screen) `AgentBar question={{ title, step?, answered?, note?, choices, preselected?, submit?, onAnswer, onLater? }}` puts a card above the bar filled with `--agent-question` and inked with `--agent-question-foreground` (the block's CSS falls back to `--accent` and `--accent-foreground`; a host sets them in its theme, e.g. `--agent-question: var(--cta)`): the step line, the title, the choices as chips with `preselected` on, « ou réponds avec tes mots, dans la barre ↓ », « Plus tard » (with `onLater`) and « Suivant » (`submit` sets the word, e.g. « Valider »). Suivant calls `onAnswer({ text: <selected>, source: 'choice' })`. `submit: null` drops the confirm button: a tap on a choice answers at once. `answered` shows the previous step's answer with a check. The card is also exported alone (`AgentQuestion`, `hint={false}`) for an answer card with `details` rows and a `footnote`.
- `agent-question-bar` while a question is open the field reads « Ou réponds ici » (`labels.answerHere`) and text typed or spoken (tap, hold) goes to `question.onAnswer({ text, source: 'bar' })`, never `onSend`; closing the question restores the placeholder.
- `agent-bar-history-badge` `historyBadge={{ label }}` puts an 8px `bg-primary` dot (`role="img"`, `aria-label` = `label`) on the history arrow; absent without the prop.
- `agent-bar-labels` every word is a `labels` key with a French default (`agentBarLabels`), including the microphone problems; icon buttons carry their label as `aria-label` and are 44px on touch.

## How to get to it (user POV)

- Type and press ↑, or tap the mic and speak, or hold the mic, speak and let go. The status line shows what the agent is doing above the bar.

## Driving it with the real browser test

Preconditions: `CHROMIUM` set (CI sets it); `node_modules` installed.

- `node --test test/contracts/agent-bar.test.mjs` mounts `test/fixtures/themes/agent-bar.jsx` (fake microphone and transcriber, fictional meals) at 390 touch and 1280 fine, light and dark, and drives it with real input. Query `?status=working|done` and `?quoted=1` pick the state.
- **Field.** `agent-bar-field`: type, click ↑, read `window.__sent`; press Enter; tap `Historique` and read `aria-expanded`.
- **Listen.** `agent-bar-listen`: tap `Parler`, check `data-state="listening"`, press `Arrêter`, read the field and `agent-bar-transcript`, then `Envoyer`; press `Annuler` instead and check nothing was sent.
- **Hold.** `agent-bar-hold`: press and hold `Parler` for 500ms (`data-state="holding"`, `agent-bar-hold-label`), release to send; move 200px away before release to cancel.
- **Review proofs.** `agent-bar-hold`, `agent-bar-cancel`, `agent-bar-focus`: `?deny=1` refuses the microphone (tap `Parler`: `data-state` stays `rest`, the alert shows); `?slow=1` makes transcription take 1.5s (hold, release, press `Annuler` or Escape: nothing sent); a 1px `move` during a hold keeps `holding`; after `Arrêter` or `Annuler` the active element is `agent-bar-input`.
- **Quoted.** `agent-bar-quoted`: `?quoted=1`, send (the payload has `quoted`), press `Retirer la citation` (`window.__cleared`).
- **Status.** `agent-status`: `?status=working` shows `agent-status-spinner` and `Annuler` (`window.__cancelled`); `?status=done` shows `agent-status-check` and no button.
- **Question.** `agent-question`, `agent-question-bar`: `?question=1` (tap `Maison`, `Plus tard`, `Suivant`; step 2 shows the answered line and `Valider`; type in the bar and press `Envoyer`: `window.__answered` has `source: 'bar'`, `window.__sent` stays empty), `?question=3` (a tap answers at once), `?question=info` (answer card, no hint).
- **History dot.** `agent-bar-history-badge`: `?question=1&badge=1` shows the dot on `Historique` (the shot `question-badge-*`); without `badge=1` it is absent.
- **Labels.** `agent-bar-labels`: the same test reads every `aria-label` and measures the 44px targets at 390.
- **Live.** `agent-bar-live`: `?live=1`; tap `Parler`, call `window.__sink.partial('...')` then `.final('...')` and read `agent-bar-transcript` (the dimmed span is the partial); press `Arrêter` and read the field; `window.__stream` counts opened, stopped, cancelled.
- **Partial.** `agent-bar-partial`: pass `partial="de la crème"` in the fixture and read `agent-bar-transcript`.
- The shots land in `.cache/evidence/agent-bar` (CI artifact `agent-bar-shots`).

## Gotchas

- The bar never clears the quote; `onClear` is the app's, and the app decides whether a send consumes it.
- The waveform needs the Web Audio path (levels); the MediaRecorder fallback shows quiet dots.
- The block's CSS targets only its own parts (`data-agent-bar` on its buttons and field), never every shadcn Button or Input, so a host's are never restyled.
- On a fine pointer the icon buttons are the kit's 36px; the 44px floor applies on touch.
- The hint under the bar (« Glisse un repas vers la droite… ») is the app's. The history-arrow dot of the answer board is not built.
