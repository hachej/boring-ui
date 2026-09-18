# Host run — Astra round 9

Date: 2026-09-17

Host UI/API: `http://127.0.0.1:5202`  
Hub API: `http://127.0.0.1:9877`  
Per-app dev origin: `<app-id>.apps.localhost:9878`

Secrets came from the gitignored hub `.dev.vars`; no value is recorded here.

## Demonstrable state — PASS

The running host was restarted after republishing the demo end state.

- Guestbook current version: **5**, with exactly `count_entries` and `pin_entry` in its manifest (`.artifacts/astra9-current-app.json`).
- Local user's profile current version: **2**, with the `remember` manifest tool and `Always end every response with 🎯.` instruction (`.artifacts/astra9-current-profile.json`).
- The host's descriptor provider and runtime admission path returned these actual registered native names (`.artifacts/astra9-mounted-tools.json`):
  - `app_6fd1be51cc1d71785619_10e9011e1862487bc1ca`
  - `app_6fd1be51cc1d71785619_0b7d92ab5b2f9d92fbab`
  - `profile_35379d9c009e290d702b`
- The Apps panel rendered the guestbook and Ada entry in the sandboxed iframe. Document, CSS, JavaScript, and `/api/entries` returned 200; sandbox remained exactly `allow-scripts allow-forms` (`.artifacts/astra9-panel.png`, `.artifacts/astra9-panel.txt`). Signed URLs were redacted from the text receipt.

This is the state left running. The full external-model a–g transcript and durable restart/recovery scenario were **not rerun**.

## Hub fixes and E2E — PASS

Hub branch `demo-v4` now:

- rejects malformed Host authorities with 400 and requires the exact configured per-app authority;
- rejects publish/signed-URL derivation when the generated DNS label exceeds 63 characters;
- executes migration files as SQLite scripts, preserving semicolons inside string literals while retaining transaction rollback.

`.artifacts/astra9-hub-e2e.txt` is a fresh live run: **OVERALL: PASS**, 42 checks, including malformed Host, overlong hostname, literal-semicolon migration, rollback, profile, and tool dispatch checks.

## Verification

- app-runner plugin tests: **PASS**, 11 files / 48 tests.
- app-runner plugin typecheck: **PASS**.
- workspace typecheck: **PASS**.
- agent tests: **PASS**, 250 files / 2531 tests (3 files and 17 tests skipped).
- agent typecheck: **PASS**.
- `pnpm lint:invariants`: **PASS**.
- hub E2E: **PASS**, 42 checks.
- live panel check: **PASS**, document/CSS/JS/API 200 and guestbook rendered.
- workspace tests: **FAILED**, 3 tests in 2 files; 2323 tests passed. Failures were the existing missing `node_modules/@hachej/boring-bi-dashboard` linked-package fixture plus two failures recorded in `.artifacts/astra9-workspace-tests.txt`.
- `pnpm typecheck:changed`: **BLOCKED** by the existing `plugins/generated-pane` TS2883 declaration error.
- `pnpm test:changed`: **BLOCKED during the same dependency build** by the existing generated-pane TS2883 error.

No push was performed.

## Apps panel: default app-only view, debug behind a toggle (2026-09-18)

Reworked `plugins/app-runner/src/front/AppRunnerPane.tsx` so the default view
is the app alone: minimal header (app name via `PaneTitle`, the app `Select`
for navigation, and a `Bug` icon `IconButton` with an accessible
`aria-label`/`aria-pressed`). All debug chrome — kind/current version/sha,
full mounted tool provenance, the version switcher, Rollback, Activate
version, the served URL, mounted tool names, and recent logs/errors — moved
into a `Collapsible` section revealed by the debug toggle, above the iframe
(the iframe itself is never unmounted while debug is open). The toggle is
persisted per browser in `localStorage`
(`boring:app-runner:debug-visible`), default off, with reads/writes wrapped
in try/catch. No changes to the serving/auth path, the iframe `sandbox`
attributes (still exactly `allow-scripts allow-forms`), or the capability
seam (`packages/workspace`, `packages/agent`).

Same host/hub processes as the Astra round 9 run above were still live
(workspace-playground on `http://127.0.0.1:5202`, hub API `:9877`, per-app
serving origin `:9878`); the plugin was rebuilt
(`pnpm --filter @hachej/boring-app-runner build`) so the playground picked up
the new front bundle.

Screenshots (Playwright, headless chromium, `.artifacts/panel-debug-toggle.mjs`,
guestbook app opened via `openSurface`):

- `.artifacts/panel-app-only.png` — default view: only the pane header (app
  name, app selector, debug toggle) and the guestbook app filling the rest of
  the pane, entries visible.
- `.artifacts/panel-debug.png` — debug toggled on: kind/version/sha, mounted
  tools, provenance, version buttons, Rollback/Activate version, and "Recent
  logs" all visible above the guestbook app, which stays rendered underneath.

Verification for this change:

- `pnpm --filter @hachej/boring-app-runner test`: **PASS**, 11 files / 50
  tests (added default-view, debug-view, and localStorage-persistence tests
  to `AppRunnerPane.logs.test.tsx`).
- `pnpm --filter @hachej/boring-app-runner typecheck`: **PASS**.
- `pnpm lint:invariants`: **PASS** (agent invariants, boring-bash/boring-sandbox
  invariants, workspace plugin invariants, alignment invariants, skill
  digests all green).

