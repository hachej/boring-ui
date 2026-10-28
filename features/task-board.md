# Task board

Host-owned business requests rendered from authorized records, shared by a board, its detail and compact own-request rows. No task backend, Pi scheduler or PM conversation is created by the component.

## Sub-features

- `task-board-status` explicit viewer/builder/high-risk/none semantics and EN/FR labels, plus host display metadata for the revised task/detail/compact API. This is data/logic only; the Opus fidelity pass wires the exact visual renderings. `packages/ui/src/task-board.ts`.
- `task-board-columns` Waiting / Working / Open columns, Done and Closed folded; the component's container selects columns or a list. `packages/ui/src/task-board.ts`, `registry/task-board/task-board.tsx`.
- `task-board-detail` URL selection with back/forward and keyboard Back/Escape; a right-hand shadcn Drawer overlays the unchanged board, with host-owned overlayClassName appearance; questions and history come from the host. `registry/task-board/task-detail.tsx`.
- `task-board-answers` open outlined question cards precede Answered · N: latest three, two bounded one-line previews per item, chevron expansion and Show all. Optional answeredAt sorts newest first; otherwise latest source entries first. Options and Other… are direct host intents; Discuss in chat is a separate injected callback, never invoked by a one-tap answer. The example stages that question in the existing draft; only Send submits it. `registry/task-board/task-detail.tsx`, `packages/ui/src/task-board.ts`.
- `task-board-files` adapter-authorized paths open through `renderFile` in a wider right-hand shadcn Drawer over the task; Back/Escape navigate file → task → unchanged board. The host supplies its regular viewer and optional `onOpenFile` / `onShowFile` services. `registry/task-board/task-board.tsx`.
- `task-board-mentions` optional task-mentions registry adapter composes authorized ID/title search and waiting markers with the host's file search/kinds, using the existing MentionPicker and composer; a task-kind sent chip opens the same overlay. `registry/task-mentions/task-mentions.tsx`.
- `task-board-native-present` one real native Pi Harness and AmbientChat host task/list presentation; actual loaded mount, cleanup and denied/missing reports, no dummy task file. `examples/task-board/server.mjs`, `examples/task-board/page.tsx`.
- `task-board-mine` own requests, newest first, filtered before `limit`; compact rows contain only title and status chip and open through the host's shared detail path. `packages/ui/src/task-board.ts`, `registry/task-board/task-board.tsx`.
- `task-request-card` one request card and chip for board, detail and the PM's À confirmer card, with screen/capture and host actions slots. `registry/task-board/task-request-card.tsx`.

## How to get to it (user POV)

- Open the fictional task-board example; one native Ambient PM conversation sits left, the task stage right. Vos dernières demandes and À confirmer reuse the shared cards below that same conversation.
- Select a task to inspect it; Back to tasks or Escape returns to the originating card. Open a file to stack the wider regular viewer over that task; Back returns through the preserved task state.

## Driving it with the task-board journey

Preconditions: built packages, Chromium, fictional data only. Run `CHROMIUM=/path/to/chromium npm run task-board:journey`.

- `task-board-status`: run `node --test test/packages/ui-task-board.test.mjs`; verify precedence, no status inferred from person names/free text, EN/FR question/confirmation wording and missing-status omission. Display fields do not change ownership or mine filtering.
- `task-board-columns`: compare the wide stage with the same desktop's Narrow panel, then the 375px phone. Terminal sections start folded.
- `task-board-detail`: focus D-201 and press Enter; check `?task=D-201`, Back/Escape, then browser back/forward. The task overlays from the right without squeezing or removing the board; the fixture host supplies its existing shadow token through overlayClassName. Phone overlay fills the viewport.
- `task-board-answers`: open D-201, inspect Sam: Noon, latest-three folding and Show all; huge answers do not enter the DOM until expanded. Choose a route or Other… without opening chat. Discuss preserves the existing draft, adds one task mention and the question, and focuses the composer without sending. Explicit Send invokes the native answer_task_question in that ONE conversation. One-tap/free-text answers use the same fictional task service and post an idempotently keyed native transcript entry. `node --test test/contracts/task-board-host.test.mjs` drives the HTTP/native path; `node examples/task-board/journey-discussion.mjs` is a no-screenshot logic probe. The public test separately drives Other and large-answer expand/collapse.
- `task-board-files`: open brief.md, mockup.html and evidence.png. Verify regular Markdown/HTML/image viewers, wider-file-over-task geometry, back/close, viewport-bound fullscreen geometry, image zoom and existing more menu. Montrer reports the exact task/path to a host callback only; PM pointing remains the PM panel owner's feature.
- `task-board-mentions`: type @D-201 in the existing ambient composer, select the waiting-marked result, inspect the task-kind chip and no raw task token in the textarea. After Discuss sends, activate the sent task chip and verify the same URL/overlay. The helper test also preserves base file search/kinds and rejects unknown task chip opens.
- `task-board-native-present`: send actual ambient prompts for D-201, waiting-on-me and mine. With fixture-only `?deferMount=1`, assert no native result before Mount requested task, then `opened: true` after the authorized view commits. Reopen its artifact card through the same selection/URL path. Denied D-403 and missing D-999 return `opened: false` via onFailed. Native results are saved in journey.json.
- `task-board-mine`: verify exactly two own requests, with no task ID, capture or signals. The same host task path opens their detail.
- `task-request-card`: inspect the shared title/chip/screen/capture language and outlined question card; Modifier/Confirmer report only fictional local intent. Capture light/dark desktop, narrow and phone screenshots and the phone accessibility tree; send another native present at phone width and verify opened, not the file-sheet refusal.

## Gotchas

- The revised pm-spec geometry, compact-card rendering, exact styling and comparison screenshots are deferred to the Opus fidelity owner; `.agent-handoff/d417/HANDOFF.md` records the remaining acceptance items. Current screenshots predate that pass.
- Hosts authorize and adapt records before rendering. `filter: 'mine'` is not authorization; the adapter supplies `requesterId`, never inferred from the assignee. Missing `currentUser` matches no own requests.
- Question/action callbacks are host intents, not approval, persistence or confirmed execution. Text remains escaped; captures are labels, not arbitrary remote image URLs.
- Files, answer identities and permissions belong to the adapter. The example resource route permits only the three supplied D-201 paths. `renderFile` borrows the host viewer; fullscreen/comments/pointing are that viewer/host's services, not TaskBoard implementations. The fixture records Montrer intent only: no PM point capture/chip, comment storage or second composer.
- Default selection uses the page's `task` query parameter. Multiple boards should use controlled selection or `onOpen` to route to one detail; with `onOpen`, the component does not also open a local detail. Unmount only removes presentation subscriptions.
