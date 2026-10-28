# Task board host

Fictional requests in a right stage, with a compact own-request list and the same request card's confirmation actions beside it. Uses the live Studio theme compiler and the app's Base UI controls. This demonstrates the component, not a redesigned Studio or a second PM chat.

```sh
npm run build
npm run task-board
CHROMIUM=/path/to/chromium npm run task-board:journey
```

The host passes `TaskRecord[]` and handles choices as fictional local intent. It does not read production tasks or persist approvals. `?task=D-201` opens a detail; the Narrow panel button verifies a list/in-place detail at a desktop viewport. Compact `filter="mine" currentUser="alice" limit={2}` routes to that same detail.

The journey checks keyboard Enter/Escape, native browser back/forward, wide side detail, narrow containers, folded terminals, own-request rows, question callbacks, 375px overflow and host light/dark tokens. Raw screenshots, the phone accessibility tree and results live under `.cache/evidence/d417/task-board/`. API: [registry guide](../../registry/README.md#task-board-task-board); driving map: [Task board](../../features/task-board.md).
