# Needs-you blocks

Generic blocks for the "what needs me" surfaces of an app: a waiting question answered in one tap, then the status paragraph and the space card. They take props and call back; the host fetches and posts. Inspired by the Bench patterns (patterns only), built on the style v1 tokens.

## Sub-features

- `inline-question` `InlineQuestion` shows a waiting question where it is mentioned. `kind: 'decision'` is Approve/Refuse for a gate or review; `kind: 'question'` offers up to four choices plus free text (free text only without options) and an optional "Reply in chat". Once `answered` is set it shows the answer instead. `registry/inline-question/inline-question.tsx`.

## How to get to it (user POV)

- The question appears in a message, a card or a home view. One tap answers a decision or a choice; free text goes with Send. The host posts the answer under the signed-in person's own login, never a shared token.

## Driving it with the render test

Preconditions: `node_modules` installed, so in CI on this VM.

- **Question.** `inline-question`: `node --test test/ui/attention-blocks.test.mjs` renders both kinds, free text, the answered states and the four-choice cap, and checks that the block never fetches.

## Gotchas

- The block sends nothing. `onAnswer` is the host's job; keep the question id in the host's closure.
- Choices beyond four are dropped; a longer list is a form, not an inline question.
- Long replies belong in the chat (`onReplyInChat`); the field here is one line.
