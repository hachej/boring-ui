# Needs-you blocks

Generic blocks for the "what needs me" surfaces of an app: a waiting question answered in one tap, then the status paragraph and the space card. They take props and call back; the host fetches and posts. Inspired by the Bench patterns (patterns only), built on the style v1 tokens.

## Sub-features

- `inline-question` `InlineQuestion` shows a waiting question where it is mentioned. `kind: 'decision'` is Approve/Refuse for a gate or review; `kind: 'question'` offers up to four choices plus free text (free text only without options) and an optional "Reply in chat". Once `answered` is set it shows the answer instead. A decision calls `onAnswer(id, 'approve' | 'refuse')` (exported as `DECISION_VALUES`): stable values, never the translated button words, so a host never compares labels; an answered decision reads by those values and any other value shows neutrally as "Answered: <value>". `maxOptions` (default 4), `freeText` (false: choices only), `disabled` and `notice` (a line under the controls) let a host such as the chat's `QuestionCard` drive it; the controls carry the test ids `question-option`, `question-input`, `question-submit`. `registry/inline-question/inline-question.tsx`.
- `status-narrative` `StatusNarrative` is the status paragraph: `segments` are text and link parts `{ label, app?, task? }` in order (code-made or model-made text), `at` is the time already formatted by the host, `by` the author, `needsYou` the one number of things waiting on the person (tasks waiting + open gates + critical security alerts; hidden at 0), `onOpen(link)` and an optional `onRefresh`. Link parts with `onOpen` are inline text links (an `<a href="#">` with `preventDefault`, so it breaks across lines like text: `text-link`, underlined, no padding or height), exempt from the 44px rule (ruling D-1696); the refresh button keeps it. The theme item defines `--link`. `registry/status-narrative/status-narrative.tsx`.

## How to get to it (user POV)

- The question appears in a message, a card or a home view. One tap answers a decision or a choice; free text goes with Send. The host posts the answer under the signed-in person's own login, never a shared token.

## Driving it with the render test

Preconditions: `node_modules` installed, so in CI on this VM.

- **Narrative.** `status-narrative`: the same test renders links in order, the time and author, the count pill (hidden at 0 or omitted), French labels, and checks the block reads no clock and never fetches.
- **Question.** `inline-question`: `node --test test/ui/attention-blocks.test.mjs` renders both kinds, free text, the answered states, stable decision values under overridden labels and the four-choice cap, and checks that the block never fetches.

## Gotchas

- The block sends nothing. `onAnswer` is the host's job; keep the question id in the host's closure.
- Store the decision value (`'approve'` or `'refuse'`), not the label; pass it back as `answered`. Labels (`labels`) only change the words.
- Choices beyond four are dropped; a longer list is a form, not an inline question.
- Long replies belong in the chat (`onReplyInChat`); the field here is one line.
- `StatusNarrative` reads no clock: pass `at` already formatted. Pass the same `needsYou` number everywhere on a surface; never sum it twice.
- Without `onOpen`, link parts show as plain emphasis.
- In the chat `StatusNarrative` is a host slot (the host supplies the paragraph as the first message through `timeline`, or `belowComposer`); `PiChat` never builds it. The waiting question in the chat is this `InlineQuestion`.
