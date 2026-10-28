# « Améliorer l’app »: the PM panel and the shared PM composer

The product manager inside any app (spec 2, boards C1–C7) and in Studio's conversation column (spec 1, boards D1, D7, D7b, D8, D9): one composer with « Montrer » to point at the app while speaking, numbered pins, timestamped chips and a review before sending. Specs: `/home/ubuntu/projects/_work/pm-spec`. Compare images: `.agent-handoff/pm-panel/compare/<board>.png`.

## Sub-features

- `pm-composer`: `PmComposer`, one component with a `touch` (app) and a `desktop` (Studio) preset, FR/EN strings (`pmTextFr`, `pmTextEn`) and theme tokens (`--pm-*` in the registry theme). `registry/pm-panel/pm-composer.tsx`, `pm-text.ts`.
- `pm-strip`: the point strip in place of the composer: `point.idle` (hint · mic · ×), `point.rec` select (toggle · hint · timer · pause · ×), navigate (no hint), paused (the mic replaces pause, the timer freezes). The timer opens the kit dictaphone. Esc = ×. `pm-composer.tsx`, `use-pm-panel.ts`.
- `pm-pins`: picks through the public feedback picker: select never activates the element, a second tap removes, numbers stay in order, pins (24px, the element's top-right corner, the element's radius) show only on their screen and only over the page. The overlay's `labels: 'corner'`, `shape: 'element'`, `clip` and `mount` options are in `packages/feedback/src/page/picker/overlay.ts`. `use-pm-panel.ts`, `point-state.ts`.
- `pm-review`: × transcribes and merges each pick after the last word ending at or before its time (picks before the mic go first); editable atomic chips (Backspace removes a chip and renumbers), the meta line « Dicté · 0:14 · 2 captures · modifiable ». `point-state.ts`, `inline-point-input.tsx`.
- `pm-one-line`: `improve={{ agent: 'pm' }}` is the app's only PM code: on the first open the kit reads `GET /api/pm/agent` (identity), picks or creates the viewer's conversation at `/api/pm/conversations`, opens `useRemoteChat` on `/api/pm/chat` and transcribes at `/api/pm/transcribe` (same origin, the door of hachej/boring-factory#854). `registry/pm-panel/use-improve-agent.ts`.
- `pm-back`: the panel owns Back like a layer: one history entry while it shows (sheet or strip), one more for the full panel, so Back goes full → sheet → closed and never leaves the page. `registry/app-shell/agent-layer.tsx`.
- `pm-panel-layout`: `AppShell improve={…}`: the first account-menu item, the sheet (C2/C6, the tab bar hidden), the 60px strip above a visible, working tab bar (C3–C5), and the full panel from 40px (C7) with the thread, the request card (`StudioTaskBoardSeam.renderRequest`) and « Mes demandes » (`renderBoard({ filter: 'mine', variant: 'compact' })`). The draft and pins persist across × and reopen. `pm-panel.tsx`, `registry/app-shell/account.tsx`.
- `pm-chat`: `PmChat`, the same conversation and composer for a Studio column (desktop preset), the point layer in the host's app frame. `pm-panel.tsx`.
- `pm-task-mentions`: `@` opens « TÂCHES · {query} » above the composer, the typed `@d-2` shows as an inline token (Composer `markMentionQuery`): the viewer's tasks (`filter: 'mine'`), at most 6 rows, « À vous » when the task waits on the viewer, ↑/↓/Enter/Tab/Esc; the `@ D-201 · Title` chip opens the task. `task-mentions.tsx`, `registry/pi-chat/composer.tsx`.
- `pm-send`: the message carries the text with chip markers, one PNG capture per pick and `pm.points@1` metadata (`n`, `kind`, `label`, `screen`, `selector`, `t`, `dictatedMs`); the draft, picks and pins clear on admission. `use-pm-panel.ts`, `point-message.tsx`.

## How to get to it (user POV)

In the app: account menu, « Améliorer l’app ». Type, or tap the arrow (« Montrer ») and tap what you want to show; the microphone records while you tap, the hand lets the app navigate, × gives the draft back to review, send opens the thread. In Studio: the same composer at the bottom of the conversation column, pointing inside the app frame.

## Driving it with the example journeys

Set `CHROMIUM` to a Chromium binary; heavy runs use the brief's resource scope.

- `pm-composer`, `pm-strip`: `node --test test/contracts/pm-composer.test.mjs` (strings, order, mic/pause exclusion, sent chips).
- `pm-pins`, `pm-review`: `node --test test/contracts/pm-point-state.test.mjs`, `node --test test/packages/feedback-picker.test.mjs`, then `node examples/pm-panel/journey.mjs` (select never activates, renumbering, pins per screen, Backspace, caret after chips).
- `pm-panel-layout`, `pm-send`, `pm-task-mentions`: `node examples/pm-panel/journey.mjs` (rectangle and hit tests in C2–C6, persistence, recorder, Esc on desktop, payload, « Modifier »/« Confirmer », « Mes demandes », @ keyboard and chip).
- `pm-one-line`, `pm-back`: `PM_ONE_LINE=1 node examples/pm-panel/journey.mjs` runs the spec 2 journey on `examples/pm-panel/oneline.tsx` (only `improve={{ agent: 'pm' }}`) against the fake door; both runs end with Back full → sheet → closed and strip → closed, on the same URL.
- Faults: `node examples/pm-panel/journey-faults.mjs` (long input, IME, pending transcription, two recordings, lost reply and reconciliation, controller replacement).
- `pm-chat`: `node examples/pm-panel/journey-studio.mjs` drives `PmChat` in the Studio story at 1440×900: Esc review, send, idle picks inside the app frame, recording, the @ picker.
- Boards: `node examples/pm-panel/journey-boards.mjs` (C1–C7, « Mes demandes ») and `node examples/pm-panel/journey-studio.mjs` (D1, D7, D7b, D8, D9) write the side-by-side compare images. The server is `node examples/pm-panel/server.mjs` (`?studio=1` for the Studio story).

## Gotchas

The Factory PM door's watch is blocked by #854: the fixtures use the kit remote transport with a scripted model, a fake microphone and a fixed transcript. The C7 request card in the fixture is drawn by the host through `StudioTaskBoardSeam` until PR #1900's `TaskRequestCard variant="compact"` lands; the kit ships no card. With the one line there is no task-board seam yet (request card, « Mes demandes », @ tasks): those come with #1900's board through a host `ImproveSpec`. App chrome (account sheet title, header avatar, tab bar) is AppShell's and differs from the boards.
