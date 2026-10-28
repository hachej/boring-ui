# Task board

Host-owned business requests rendered from authorized records, shared by a board, its detail and compact own-request rows. No task backend, Pi scheduler or PM conversation is created by the component.

## Sub-features

- `task-board-columns` Waiting / Working / Open columns, Done and Closed folded; the component's container selects columns or a list. `packages/ui/src/task-board.ts`, `registry/task-board/task-board.tsx`.
- `task-board-detail` URL selection with back/forward, keyboard Back/Escape and side detail only where the container fits; questions and history come from the host. `registry/task-board/task-detail.tsx`.
- `task-board-answers` answered question chips name the adapter-provided actor; open choices are one-tap intents and Other opens the host's free-answer flow. `registry/task-board/task-detail.tsx`, `packages/ui/src/task-board.ts`.
- `task-board-files` adapter-authorized workspace paths open through `renderFile` on the right with task detail retained on the left; the host supplies its regular viewer and optional `onOpenFile` / `onShowFile` services. `registry/task-board/task-board.tsx`.
- `task-board-native-present` one real native Pi Harness and AmbientChat host task/list presentation; actual loaded mount, cleanup and denied/missing reports, no dummy task file. `examples/task-board/server.mjs`, `examples/task-board/page.tsx`.
- `task-board-mine` own requests, newest first, filtered before `limit`; compact rows contain only title and status chip and open through the host's shared detail path. `packages/ui/src/task-board.ts`, `registry/task-board/task-board.tsx`.
- `task-request-card` one request card and chip for board, detail and the PM's À confirmer card, with screen/capture and host actions slots. `registry/task-board/task-request-card.tsx`.

## How to get to it (user POV)

- Open the fictional task-board example; one native Ambient PM conversation sits left, the task stage right. Vos dernières demandes and À confirmer reuse the shared cards below that same conversation.
- Select a task to inspect it; Back to tasks or Escape returns to the originating card. Open a file from the task detail to keep the task left and regular viewer right.

## Driving it with the task-board journey

Preconditions: built packages, Chromium, fictional data only. Run `CHROMIUM=/path/to/chromium npm run task-board:journey`.

- `task-board-columns`: compare the wide stage with the same desktop's Narrow panel, then the 375px phone. Terminal sections start folded.
- `task-board-detail`: focus D-201 and press Enter; check `?task=D-201`, Back/Escape, then browser back/forward. Wide detail sits beside the board; a narrow container replaces it.
- `task-board-answers`: open D-201, inspect Noon · Sam, choose a route or Other; these call host intents, not approvals. The public component test drives Other separately.
- `task-board-files`: open brief.md, mockup.html and evidence.png. Verify regular Markdown/HTML/image viewers, task-left/file-right geometry, back/close, fullscreen, image zoom and existing more menu. Montrer reports the exact task/path to a host callback only; PM pointing remains the PM panel owner's feature.
- `task-board-native-present`: send actual ambient prompts for D-201, waiting-on-me and mine. With fixture-only `?deferMount=1`, assert no native result before Mount requested task, then `opened: true` after the authorized view commits. Reopen its artifact card through the same selection/URL path. Denied D-403 and missing D-999 return `opened: false` via onFailed. Native results are saved in journey.json.
- `task-board-mine`: verify exactly two own requests, with no task ID, capture or signals. The same host task path opens their detail.
- `task-request-card`: inspect the shared title/chip/screen/capture language and outlined question card; Modifier/Confirmer report only fictional local intent. Capture light/dark desktop, narrow and phone screenshots and the phone accessibility tree.

## Gotchas

- Hosts authorize and adapt records before rendering. `filter: 'mine'` is not authorization; the adapter supplies `requesterId`, never inferred from the assignee. Missing `currentUser` matches no own requests.
- Question/action callbacks are host intents, not approval, persistence or confirmed execution. Text remains escaped; captures are labels, not arbitrary remote image URLs.
- Files, answer identities and permissions belong to the adapter. The example resource route permits only the three supplied D-201 paths. `renderFile` borrows the host viewer; fullscreen/comments/pointing are that viewer/host's services, not TaskBoard implementations. The fixture records Montrer intent only: no PM point capture/chip, comment storage or second composer.
- Default selection uses the page's `task` query parameter. Multiple boards should use controlled selection or `onOpen` to route to one detail; with `onOpen`, the component does not also open a local detail. Unmount only removes presentation subscriptions.
