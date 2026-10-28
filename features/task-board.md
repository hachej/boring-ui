# Task board

Host-owned business requests rendered from authorized records, shared by a board, its detail and compact own-request rows. No task backend, Pi scheduler or PM conversation is created.

## Sub-features

- `task-board-columns` Waiting / Working / Open columns, Done and Closed folded; the component's container selects columns or a list. `packages/ui/src/task-board.ts`, `registry/task-board/task-board.tsx`.
- `task-board-detail` URL selection with back/forward, keyboard Back/Escape and side detail only where the container fits; questions, options and history come from the host. `registry/task-board/task-detail.tsx`.
- `task-board-mine` own requests, newest first, filtered before `limit`; compact rows contain only title and status chip and open through the host's shared detail path. `packages/ui/src/task-board.ts`, `registry/task-board/task-board.tsx`.
- `task-request-card` one request card and chip for board, detail and the PM's À confirmer card, with screen/capture and host actions slots. `registry/task-board/task-request-card.tsx`.

## How to get to it (user POV)

- Open the fictional task-board example; the right stage contains Tasks and the left example shows Vos dernières demandes and À confirmer.
- Select a task to inspect it; Back to tasks or Escape returns to the originating card.

## Driving it with the task-board journey

Preconditions: `npm run build`, Chromium, fictional data only.

- `task-board-columns`: run `npm run task-board:journey`; compare the wide stage with the same desktop's Narrow panel, then the 375px phone. Terminal sections start folded.
- `task-board-detail`: focus D-201 and press Enter; check `?task=D-201`, choose a route, Back/Escape, then browser back/forward. Wide detail sits beside the board; a narrow container replaces it.
- `task-board-mine`: verify exactly two own requests, with no task ID, capture or signals. The same host task path opens their detail.
- `task-request-card`: inspect the shared title/chip/screen/capture language and the outlined question card; Modifier/Confirmer report only fictional local intent. Capture light/dark desktop, narrow and phone screenshots and the phone accessibility tree.

## Gotchas

- Hosts authorize and adapt records before rendering. `filter: 'mine'` is not authorization; the adapter supplies `requesterId`, never inferred from the assignee. Missing `currentUser` matches no own requests.
- Question/action callbacks are host intents, not approval, persistence or confirmed execution. Text remains escaped; captures are labels, not arbitrary remote image URLs.
- Default selection uses the page's `task` query parameter. Multiple boards should use controlled selection or `onOpen` to route to one detail; with `onOpen`, the component does not also open a local detail. Unmount only removes presentation subscriptions.
