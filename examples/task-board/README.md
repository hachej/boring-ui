# Task board

## PM spec fidelity

Coach Max data from the PM spec (D-201…) in a Studio-like frame: the rail and PM bar are fixture stand-ins; the conversation is the real AmbientChat; the tasks panel is the block. `studio-theme.css` is the fictional Studio (and, under `.coach`, Coach Max) theme. `?layout=ambient` is the collapsed D3 layout, `?view=compact` the C7 card at 390px. `node examples/task-board/compare.mjs` writes D2/D3/D6/C7 side by side with the mockups to `.agent-handoff/d417/compare/`. `node --test test/contracts/task-board-host.test.mjs` drives one-tap/free-text answers through HTTP into the same native PM transcript. `node examples/task-board/journey-discussion.mjs` drives Discuss → draft → explicit Send without taking screenshots. Set `TASK_BOARD_SCREENSHOTS=0` for a logic-only run of the existing full journey. Discuss preserves unsent text and never sends on its own; a one-tap answer records no second conversation.
 host

One real native Pi Harness, a keyless scripted model and one `AmbientChat artifactTarget="host"` conversation at left; authorized business tasks and ordinary file viewers at right. Uses the Studio theme compiler and the app's Base UI controls, not a redesigned Studio or PM header/composer.

```sh
npm run task-board
CHROMIUM=/path/to/chromium npm run task-board:journey
```

Requires built packages. Try **What's waiting on me?**, **Show D-201**, **Show waiting on me**, **Show my requests**, **Show denied task** or **Show missing task** in the actual composer. The scripted model calls `createPresentTool({ ack: { timeoutMs: 15000 } })`; only the loaded task/list's committed effect reports `{ subject }`, cleanup reports `{ subject, hidden: true }`, and missing/denied views report `{ subject, reason }`. The fixture-only `?deferMount=1` exposes a Mount requested task control so the journey proves native `opened: true` cannot arrive before mount. It never acknowledges a descriptor or click.

The host passes `TaskRecord[]`; one-tap answers and native PM answers use the same small fictional host service (not a library task backend or approval). Other… remains a distinct host free-answer intent. Open questions precede Answered · N; latest three have bounded one-line question/actor-answer previews, Show all, and lazy full-answer expansion. `?task=D-201`, compact own requests and the native artifact card all use the same controlled selection + URL path. Narrow panel verifies a list beneath the overlay at a desktop viewport. Right-hand shadcn Drawers stack board → task → wider file without squeezing the board; Back/Escape unwind one level.

D-201 supplies adapter paths `docs/tasks/D-201/brief.md`, `mockups/meal-card.html` and `evidence/day-plan.png`; the host enables the regular HTML viewer's sandboxed frame (`interactive`). All bytes are seeded through one real workspace provider's conditional publication and read through the authorized resource route. The regular `FileViewer` and document kinds supply Markdown/HTML/image rendering, name, back/close, zoom, more and fullscreen; the wider file overlay covers the preserved task overlay. Its regular back label and filename identify D-201 / file. The resource route is read-only and permits exactly those three paths. Tasks remain host records, never dummy workspace files.

Optional `taskMentions({ tasks, onOpen, base? })` composes the same authorized catalog with existing host file search and mention kinds. Typing @ searches ID/title and marks waiting-on-you; the existing composer inserts a task-kind chip and sent chips open the task overlay. `onDiscussQuestion(task, question)` posts the question with that task mention into the ONE native conversation; the scripted model calls answer_task_question and the host projection shows PM's settled answer.

`renderFile(task, file, api)` is the Studio integration slot. Forward `api.onBack`, `api.onClose` and `api.onShowFile` to the existing host viewer/window service. **Montrer here only reports the exact task/path to a host callback. Actual PM pointing/chips and comment handling belong to Coach Max's PM panel/viewer service; this example does not implement them or import unpublished sibling source.** No extra feedback session, selection strip or composer is created.

The journey checks real native opened/refused results, keyboard/history, wide/narrow/375px layouts, answered-by chips, three regular file kinds, unchanged-board/stacked-overlay geometry, back/close/fullscreen, image zoom and host themes. Screenshots, phone accessibility and `journey.json` with native results live under `.cache/evidence/d417/task-board/`; selected evidence is retained under `.agent-handoff/d417/task-board/`.

The fixture uses temporary workspace SQLite plus native MemoryStorage, cleaned on shutdown: no production task API, durable task backend, credentials or live model qualification is claimed. API: [registry guide](../../registry/README.md#task-board-task-board); driving map: [Task board](../../features/task-board.md).

## Compact native request fixture (no models)


