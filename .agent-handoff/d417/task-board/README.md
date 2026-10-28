# D417 task-board UI proof

Fictional records only. Uses the live Studio theme compiler and host Base UI components, not a new Studio header or chat implementation.

`npm run task-board:journey` drove Chromium at 1600×1000, the same desktop with a narrow right container, and 375×812. Eleven screenshots cover board/detail, light/dark, wide/narrow and phone. Raw accessibility snapshot, step results and logs remain under `.cache/evidence/d417/`.

Passing checks: kit build, repo check, strict exact-optional component types, 15 focused package/registry test entries (the component entry drives five DOM scenarios), and real pinned shadcn app-registry installation with non-default UI alias, strict declarations and browser bundle. The terminal deep-link keyboard-return regression failed before correction. Full repository suites and native ambient present(task) host integration belong to the integrating parent.
