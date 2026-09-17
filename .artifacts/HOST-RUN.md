# Host run — Astra round 8

Date: 2026-09-17

Host UI/API: `http://127.0.0.1:5202`  
Hub API: `http://127.0.0.1:9877`  
Per-app dev origin: `<app-id>.apps.localhost:9878`

Secrets came from the gitignored hub `.dev.vars`; no value is recorded here.

## Dynamic capability boundary — PASS

The plugin dynamic seam now accepts only `RemoteCapabilityDescriptor[]`. Ordinary
`AgentTool` callbacks no longer share that channel; trusted host callbacks remain
on the existing static host-tool paths. The harness sends every dynamic entry
through descriptor admission and rejects an ordinary callback before execution.

Descriptor admission first makes a recursive own-property, data-only snapshot.
It rejects accessors, proxies, functions, symbols, cycles, and non-plain objects
without invoking caller accessors. Validation, manifest lookup, executor creation,
and dispatch use only that snapshot. A regression mutates `workspaceId` while the
`/current` request is pending and confirms execution remains bound to the original
workspace.

For `kind: "profile"`, the runtime independently derives the sole permitted
profile address from the authenticated user id and rejects another user's profile
before contacting the hub.

Focused admission coverage is **13 passing tests**, including Astra's callback,
accessor, mutation-race, and cross-user profile reproductions plus the round-6/7
manifest/dispatch/refresh matrix.

## Hub and sandboxed panel — PASS

`.artifacts/astra8-hub-e2e.txt` is a fresh live hub run: **OVERALL: PASS** (39
checks), including failed-migration rollback and version-pinned dispatch.

`.artifacts/astra8-panel.txt` and `.artifacts/astra8-panel.png` are a fresh live
Apps-panel capture. The iframe retained exactly
`sandbox="allow-scripts allow-forms"`; document, CSS, JavaScript, and
`/api/entries` each returned 200, and the rendered body was `Guestbook / Ada`.

## Verification

- agent focused descriptor admission: **PASS**, 13 tests.
- agent typecheck: **PASS** after rebuilding `@hachej/boring-ui-kit`.
- app-runner plugin tests: **PASS**, 11 files / 48 tests.
- app-runner plugin typecheck: **PASS**.
- workspace registration tests: **PASS**, 41 tests.
- workspace typecheck: **PASS**.
- `pnpm lint:invariants`: **PASS**.
- hub `node app-runner/scripts/e2e-test.mjs`: **OVERALL: PASS**, 39 checks.
- live panel iframe: **document/CSS/JS/API 200**, rendered `Guestbook / Ada`.
- full workspace test command: **FAILED**, 17 tests in 5 files (timeouts under
  concurrent full-suite load plus the pre-existing missing
  `node_modules/@hachej/boring-bi-dashboard` fixture link); 2309 tests passed.
- full agent test command: **FAILED**, 3 tests plus one suite (timeouts and the
  initially unbuilt `@hachej/boring-ui-kit` dependency); 2447 tests passed. The
  affected admission file was rerun independently and passed after the UI build.
- `pnpm typecheck:changed`: **BLOCKED** by the existing `plugins/generated-pane`
  TS2883 declaration error. Scoped affected-package typechecks passed.
- `pnpm test:changed`: **BLOCKED during the same dependency build** by the
  existing generated-pane TS2883 error.

The full external-model a–g transcript was **not rerun**. No provider-backed
model/inventory/restart claim is made. The live services were already running;
their startup/restart procedure was not rerun.
