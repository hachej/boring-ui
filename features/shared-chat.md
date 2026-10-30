# Shared chat

`shared-chat` is a room where people and agents talk in one conversation, over a `SharedChatController`.

## Sub-features

- `shared-timeline` grouped bubbles, day pills, quotes, request cards, traces. `registry/shared-chat/timeline.tsx`, `messages.tsx`.
- `shared-mentions` members as `@id` tokens, agents first. `registry/shared-chat/use-shared-chat.tsx`.
- `shared-members` presence and member list. `registry/shared-chat/shared-chat.tsx`.
- `shared-reply` reply with a quoted parent, reveal the parent. `registry/shared-chat/timeline.tsx`.
- `shared-presented-artifacts` native successful `present` descriptors keep exact title/target/revision through room stream, question, settlement and history; removed messages clear them. `packages/agent/src/room.ts`, `packages/ui/src/shared-chat/room.ts`.
- `shared-artifact-cards` optional `artifacts` card/opener config reuses PM mockup cards/full views with a host reader; repeated exact descriptors appear once at their latest message. `registry/shared-chat/messages.tsx`, `text.tsx`, `registry/pm-panel/pm-mockups.tsx`.
- `shared-answered-choice` answered questions leave the person’s actual reply, not a repeated assistant prompt/Answered log or quote; their presented mockups remain accessible. `registry/shared-chat/messages.tsx`, `timeline.tsx`.
- `shared-labels` English and French words. `registry/shared-chat/shared-labels.ts`, `shared-labels-fr.ts`.

## How to get to it (user POV)

- A `SharedChat` or `useSharedChat` page, in a shell screen or a workspace.

## Driving it with the example journeys

Preconditions: `npm run build`, Chromium.

- **Room.** `shared-timeline`, `shared-members`, `shared-labels`: `npm run shared-chat:journey`.
- **Live room.** `shared-mentions`, `shared-reply`: `npm run shared-chat:journey:room`; mention an agent, reply to a card.
- **Mockups.** `shared-presented-artifacts`, `shared-artifact-cards`: `node --test test/packages/agent-room.test.mjs test/packages/ui-room-source.test.mjs test/contracts/shared-room-mockups.test.mjs`; then `CHROMIUM=<binary> node scripts/test-shared-room-mockups-browser.mjs` opens all three cards/full sandboxes at 375px and 1280px, answers B and reloads native room history. Fictional local reader, no deployed access-policy claim.
- **Answered choice.** `shared-answered-choice`: `node --test test/contracts/shared-room-mockups.test.mjs test/ui/shared-chat.test.mjs`; choose B, mark the question answered, verify only the person’s reply and all exact mockup cards remain.
- **Install.** `npm run test:shared-chat-consumer` mounts the installed item.
- **Proof.** ARIA snapshot and screenshot, light and dark.

## Gotchas

- Member names only: an id sent in a name's place never reaches the picker or a chip.
- The kit does not decide who may be a member; the host does.
- Descriptors grant no byte access. The host rechecks original requester/task rights on every exact-revision read and keys/resets the full-view state and provider on app/requester/controller changes. See `registry/README.md` (Room artifact cards).
