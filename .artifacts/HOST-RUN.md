# Host run — Astra round 6

Date: 2026-09-17

Host UI/API: `http://127.0.0.1:5202`  
Hub API: `http://127.0.0.1:9877`  
Per-app dev origin: `<app-id>.apps.localhost:9878`

Secrets came from the gitignored hub `.dev.vars`; no value is recorded here.

## Dynamic capability admission — PASS

Dynamic providers are now admitted by function identity minted through the
app-runner capability factory, not by the caller-supplied plugin id. The focused
workspace registration matrix in `.artifacts/astra6-workspace-registration.txt`
captures all four registration cases: an arbitrary id is rejected, a forged
`app-runner` object is rejected, a factory-minted provider under the wrong id is
rejected, and only the factory-minted app-runner provider is accepted.

The harness still rejects missing/non-remote/unfrozen provenance before mounting.
The app-runner provider resolves every retained address through the hub's
`/current` endpoint before constructing tools. The plugin suite now explicitly
covers an unresolvable address (nothing mounted) and stale retained metadata
(the mounted version and SHA come from hub current, and the record is refreshed).

## Atomic migration failure — PASS

`.artifacts/astra6-hub-e2e.txt` is a fresh live hub run: **OVERALL: PASS** (39
checks). The v2 database contains rows named `before`, `during`, and `after`.
The v3 migration deletes `during` and then executes invalid SQL. Publication and
explicit activation both return 400, current remains v2, and the subsequent v2
read contains all three rows. Migration statements and `_migrations` bookkeeping
run in one `ctx.storage.transactionSync` boundary, so the thrown statement rolls
back the entire activation migration.

## Sandboxed panel — PASS

`.artifacts/astra6-panel.txt` and `.artifacts/astra6-panel.png` are a fresh live
Apps-panel capture. The actual iframe retained exactly
`sandbox="allow-scripts allow-forms"`. Its document, CSS, JavaScript, and
`/api/entries` each returned 200 from the per-app origin, and the rendered body
was:

```text
Guestbook
Ada
```

## Verification

- `pnpm --filter @hachej/boring-app-runner test`: **PASS**, 11 files / 50 tests.
- `pnpm --filter @hachej/boring-app-runner typecheck`: **PASS**.
- focused workspace registration test: **PASS**, 41 tests.
- `pnpm --filter @hachej/boring-workspace typecheck`: **PASS**.
- hub `node app-runner/scripts/e2e-test.mjs`: **OVERALL: PASS**, 39 checks.
- live panel iframe: **document/CSS/JS/API 200**, rendered `Guestbook / Ada`.
- `pnpm typecheck:changed`: **BLOCKED** by the existing
  `plugins/generated-pane` TS2883 declaration-build error.
- `pnpm test:changed`: **BLOCKED during the same dependency build** by that
  existing generated-pane TS2883 error.
- `git diff --check` in both repositories: **PASS**.

The full external-model a–g transcript was **not rerun**. This round reran the
changed admission tests, exact migration-failure reproduction, hub E2E, and live
sandboxed panel path requested by the brief; those captures are not presented as
a substitute for a provider-backed model transcript.
