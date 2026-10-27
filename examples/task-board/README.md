# Fictional task board

```sh
npm ci
npm run build
npm run task-board
# Actual Chromium controls, geometry, keyboard, dark mode and screenshots:
CHROMIUM=/snap/bin/chromium npm run task-board:journey
```

Open the printed URL. Twelve fictional community-workspace tasks include two questions waiting on the viewer. Select a task for a read-only Sheet. `?layout=sections` changes the initial preference; at 390px either preference displays sections. The theme button demonstrates the same host tokens in dark mode. No credentials, model, task service or production data is used.

The [registry guide](../../registry/README.md#task-board) owns installation and API. The board never fetches, moves tasks or answers questions. This fixture supplies its clock and task array; a real host supplies authorized data and `onOpen`, optionally composing `TaskDetail` in its own panel.

The journey saves desktop kanban/sections, both requested layouts at 390px, and detail screenshots under `.agent-handoff/task-board/`; raw step results and browser logs live under `.cache/evidence/task-board/`.
