# D-417 — logic ready; Opus owns fidelity

## Authority and state

- Continue **PR #1900**, branch `feat/d417-task-board`. **DO NOT MERGE.** Julien explicitly assigned the pixel/fidelity pass to an Opus worker.
- Main/release **0.4.27 is merged into this branch** (`841bb8619`); source registry dependency pins and generated items follow 0.4.27. Task changes remain under Unreleased, not the already-shipped migration section.
- Spec source: `/home/ubuntu/projects/_work/pm-spec/README.md` first (rules 1–8 and R1–R8), then `3-studio.md` §3–§6/§10 and acceptance; compact card also follows `2-pm-panel.md` C7. These supersede the earlier rolling canvas updates.
- No new fidelity screenshots or side-by-side comparisons were made in this logic pass. Existing `.agent-handoff/d417/task-board/` images are historical, **not acceptance evidence for the new spec**.

## Implemented logic/API

- Host-owned business-task model, original store/adapter boundary, `filter: 'mine'`, filtering before limits, URL selection and task/file identity are preserved. No task backend, second store, agent loop or conversation was added.
- `@hachej/boring-ui-kit/task-board` now accepts task `age`, `requester`, `refiner`, `captureCount`, `folder`; question `askedBy` / `askedAt`; file `kind: 'markdown' | 'mockup' | 'capture'`. Existing fields and `TaskRecord.requesterId` remain compatible. Display identities never authorize or filter records.
- `deriveTaskStatus(task)` returns `waiting-on-viewer`, `waiting-on-builder`, `high-risk` or `none`, in that precedence. Viewer status uses the native `waiting_on_you` projection; builder status requires explicit `waiting_on.type: 'builder'`. Names/free-form status text are never interpreted as authority.
- `taskStatusLabel(status, locale?, viewerAction?)` supplies exact EN/FR labels. French viewer action explicitly distinguishes `question` (À vous) from `confirmation` (À confirmer). `none` has no label/pill.
- Registry `TaskCard` / `TaskCardProps` alias the shared request card. **This does not redesign compact rendering**; that remains Opus work.
- Existing `onAnswer`, `onOther`, `onDiscussQuestion`, `renderFile`, `onOpenFile`, `onShowFile` callbacks retain host ownership. File-view API exposes back/close/fullscreen callbacks; real Markdown/HTML/image viewers are already composed.
- The example's Discuss callback preserves unsent text, adds one task mention plus the question, focuses the existing composer and **does not send**. Explicit Send reaches the same native PM conversation and settles through the host answer service.
- One-tap/free-text answers enter that same native PM transcript using stable native write request IDs. Identical retries retain one entry/answer; changed answers conflict. The fixture accepts bounded real free text for Other; it still needs the inline UI described below. This fictional in-memory host is not production crash/transaction qualification.
- Native `present({ task })` / filtered lists, exact-subject mount/failure acknowledgements, independent file/task mount evidence and phone task presentation remain implemented. Files do not become task mirrors. Hosts route the same subject into Studio or the app's one PM conversation.

## Remaining Opus pass — do not mistake green CI for fidelity

1. **D2 board/task bar:** exact uppercase columns/counts, `1 on you`, id/age metadata, semantic pills, attention border, Mine default/All control, Done/Closed list links, spacing/radii/tokens.
2. **D2/D3 detail:** replace the current viewport Drawer geometry with a **panel-scoped 400px absolute overlay**, 40px header and exact section order. Keep board widths unchanged. Apply title/requester/refiner metadata, QUESTION FOR YOU/PM time, 34px options and inline Other input/Send. Add Ask in the conversation. Discuss stages, never auto-sends.
3. **Answered/files:** exact card/header/row structure, latest-three previews and full-text expansion, folder header, file icons/kinds. Preserve lazy huge-answer mounting.
4. **D6:** **760px** panel-scoped file overlay, 52px breadcrumb/header, regular viewer, zoom and More, back to D-201. Wire Montrer to the **Coach Max PM pointing owner**; do not create another viewer/composer/pointing implementation.
5. **Compact C7:** full DEMANDE request card, À confirmer, title, screen and **2 captures (R6)**, equal Modifier/Confirmer actions. Current compact rows are still the old title/chip form. Keep one shared model and reuse the card in the mine/limit list.
6. **D3 integration/context:** real pi-ambient placement/buttons and the collapsed Studio bars follow the Studio/PM owner contracts. Studio header/sidebar and spec-1 composer/pointing are not implemented by this logic pass.
7. Add the requested 1440×900 board comparisons under `.agent-handoff/d417/compare/` against the immutable exported D2/D3/D6 PNGs and compact-card reference. C7 source is 390×844; preserve the specified reference dimensions/rulings rather than stretching or silently editing the baseline. No hard-coded hex in components; use the host's one theme and native shadcn seams without design-check exemptions.

## Verification and reproduction

- Public model/API tests: `node --test test/packages/ui-task-board.test.mjs` (the new exports failed before implementation).
- Real HTTP/native answer path: `node --test test/contracts/task-board-host.test.mjs` (failed before: no answer in the native conversation).
- No-screenshot browser logic probe: `CHROMIUM=/path/to/chromium node examples/task-board/journey-discussion.mjs` (failed before: Discuss discarded/sent the existing draft; passes after staging fix).
- Existing full browser driver can run logic-only with `TASK_BOARD_SCREENSHOTS=0 CHROMIUM=/path/to/chromium npm run task-board:journey`; CI keeps its existing proof mode. No comparison baselines were changed.
- Use `npm run registry:build`, `npm run check`, `npm run typecheck`, and the existing isolated app consumer/CI gates after updates. All heavy local commands serialize through `flock /tmp/boring-ui-d417-heavy.lock systemd-run --user --scope -p MemoryMax=8G`.
- Raw evidence stays in ignored `.cache/evidence/d417/spec-*`. Final head/check status is recorded in the external `spec.md.report.md`; do not merge even when green.

## Fidelity pass (Opus, 2026-10-28)

Board, detail, files, file overlay and compact card now follow spec 3 §3–§5 and C7. Side-by-side shots (light/dark) are in `compare/`, made by `examples/task-board/compare.mjs`. What is still off, and why, is in the external `fidelity.md.report.md`.
