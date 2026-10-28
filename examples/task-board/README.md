# Task board host

One real native Pi Harness, a keyless scripted model and one `AmbientChat artifactTarget="host"` conversation at left; authorized business tasks and ordinary file viewers at right. Uses the Studio theme compiler and the app's Base UI controls, not a redesigned Studio or PM header/composer.

```sh
npm run task-board
CHROMIUM=/path/to/chromium npm run task-board:journey
```

Requires built packages. Try **Show D-201**, **Show waiting on me**, **Show my requests**, **Show denied task** or **Show missing task** in the actual composer. The scripted model calls `createPresentTool({ ack: { timeoutMs: 15000 } })`; only the loaded task/list's committed effect reports `{ subject }`, cleanup reports `{ subject, hidden: true }`, and missing/denied views report `{ subject, reason }`. The fixture-only `?deferMount=1` exposes a Mount requested task control so the journey proves native `opened: true` cannot arrive before mount. It never acknowledges a descriptor or click.

The host passes `TaskRecord[]` and handles answers/Other as local intent, not approvals. `?task=D-201`, compact own requests and the native artifact card all use the same controlled selection + URL path. Narrow panel verifies list/in-place task detail within a desktop viewport.

D-201 supplies adapter paths `docs/tasks/D-201/brief.md`, `mockup.html` and `evidence.png`. All bytes are seeded through one real workspace provider's conditional publication and read through the authorized resource route. The regular `FileViewer` and document kinds supply Markdown/HTML/image rendering, name, back/close, zoom, more and fullscreen; the task remains at left, file at right. The resource route is read-only and permits exactly those three paths. Tasks remain host records, never dummy workspace files.

`renderFile(task, file, api)` is the Studio integration slot. Forward `api.onBack`, `api.onClose` and `api.onShowFile` to the existing host viewer/window service. **Montrer here only reports the exact task/path to a host callback. Actual PM pointing/chips and comment handling belong to Coach Max's PM panel/viewer service; this example does not implement them or import unpublished sibling source.** No extra feedback session, selection strip or composer is created.

The journey checks real native opened/refused results, keyboard/history, wide/narrow/375px layouts, answered-by chips, three regular file kinds, task-left/file-right geometry, back/close/fullscreen, image zoom and host themes. Screenshots, phone accessibility and `journey.json` with native results live under `.cache/evidence/d417/task-board/`; selected evidence is retained under `.agent-handoff/d417/task-board/`.

The fixture uses temporary workspace SQLite plus native MemoryStorage, cleaned on shutdown: no production task API, durable task backend, credentials or live model qualification is claimed. API: [registry guide](../../registry/README.md#task-board-task-board); driving map: [Task board](../../features/task-board.md).
