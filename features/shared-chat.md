# Shared chat

`shared-chat` is a room where people and agents talk in one conversation, over a `SharedChatController`.

## Sub-features

- `shared-timeline` grouped bubbles, day pills, quotes, request cards, traces. `registry/shared-chat/timeline.tsx`, `messages.tsx`.
- `shared-mentions` members as `@id` tokens, agents first. `registry/shared-chat/use-shared-chat.tsx`.
- `shared-members` presence and member list. `registry/shared-chat/shared-chat.tsx`.
- `shared-reply` reply with a quoted parent, reveal the parent. `registry/shared-chat/timeline.tsx`.
- `shared-labels` English and French words. `registry/shared-chat/shared-labels.ts`, `shared-labels-fr.ts`.

## How to get to it (user POV)

- A `SharedChat` or `useSharedChat` page, in a shell screen or a workspace.

## Driving it with the example journeys

Preconditions: `npm run build`, Chromium.

- **Room.** `shared-timeline`, `shared-members`, `shared-labels`: `npm run shared-chat:journey`.
- **Live room.** `shared-mentions`, `shared-reply`: `npm run shared-chat:journey:room`; mention an agent, reply to a card.
- **Install.** `npm run test:shared-chat-consumer` mounts the installed item.
- **Proof.** ARIA snapshot and screenshot, light and dark.

## Gotchas

- Member names only: an id sent in a name's place never reaches the picker or a chip.
- The kit does not decide who may be a member; the host does.
