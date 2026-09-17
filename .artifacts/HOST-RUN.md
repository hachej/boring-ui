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
