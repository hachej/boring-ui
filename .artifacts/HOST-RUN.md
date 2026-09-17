# Host run — Astra round 5

Date: 2026-09-17

Host UI/API: `http://127.0.0.1:5202`  
Hub API: `http://127.0.0.1:9877`  
Per-app dev origin: `<app-id>.apps.localhost:9878`

Secrets came from the gitignored hub `.dev.vars`; no value is recorded here.

## Per-app origin and sandboxed panel — PASS

The captured Playwright run is `.artifacts/astra5-panel.txt`; the screenshot is
`.artifacts/astra5-panel.png`. It opened the Apps panel through the live host UI,
not a standalone app navigation. The actual iframe had exactly
`sandbox="allow-scripts allow-forms"`. Inside that frame the document, CSS,
JavaScript, and `/api/entries` each returned 200, and the rendered body was:

```text
Guestbook
Ada
```

Every response URL used the app-specific
`7-default-9-guestbook.apps.localhost:9878` origin and inherited the same
`/t/<signed-token>/` prefix. No serving cookie is used. App responses retained
`Referrer-Policy: no-referrer`, `Cache-Control: private, no-store`, restrictive
CSP, and `X-Content-Type-Options: nosniff`. The wildcard DNS/TLS production
requirement is documented in `app-runner/API.md` and the plugin README.

`.artifacts/astra5-probes.txt` captures the cross-app replay probe: the victim's
signed path requested on `attacker.apps.localhost` returned **403**.

## Stable data facet and exact-version execution — PASS

`.artifacts/astra5-probes.txt` captures a delayed v1 write interleaved with v2
publication/activation. The delayed request completed with 200 and
`executedVersion: 1`; the v2 read contained all three rows written before,
during, and after activation. The same capture shows:

- explicit v1 preview while current was v2: `executedVersion: 1`;
- an advertised-v1 tool call after activation: **409 version_mismatch**;
- the current call executed v2.

The runtime has one stable facet name (`app`) per app. Activation no longer
dumps, restores, snapshots, or copies SQLite. App code is selected from the
resolved request version and cached by app+version+SHA; AppHome serializes facet
retargeting so an in-flight request completes on its selected code.

## Dynamic capability admission — PASS

`defineServerPlugin` now rejects `agentToolsDynamic` during registration unless
the contribution is the ratified `app-runner` boundary. The focused workspace
registration test passed (41/41), including rejection of an arbitrary provider.
The harness retains its second-line requirement for remote execution and frozen
kind/address/version/SHA provenance.

No Pi runtime endpoint exposes the live active-tool registry. Consequently this
report does not relabel stored manifests or assistant prose as a mounted
inventory capture.

## Hub and host capability path

`.artifacts/astra5-hub-e2e.txt` is a fresh live hub run: **OVERALL: PASS** (39
checks). It captures publish, dynamic requests, migrations, stale-version 409,
rollback, profile instructions/tool execution, limits, logs, and usage. The
live host Apps route refreshed its retained guestbook record from the hub, and
the panel capture proves the host-to-panel serving path after restart.

A fresh external-model chat run of steps a–g was **not captured**: this local
host exposes no active-registry inspection endpoint and no new provider-backed
model turn was executed. The hub E2E and panel run are concrete boundary
captures, but they are not presented as a substitute for a model transcript.

## Verification

- `pnpm --filter @hachej/boring-app-runner test`: **PASS**, 11 files / 48 tests.
- `pnpm --filter @hachej/boring-app-runner typecheck`: **PASS**.
- focused workspace registration test: **PASS**, 41 tests.
- `pnpm --filter @hachej/boring-workspace typecheck`: **PASS**.
- hub `node app-runner/scripts/e2e-test.mjs`: **OVERALL: PASS**, 39 checks.
- panel iframe: **document/CSS/JS/API 200**, rendered `Guestbook / Ada`.
- interleaving/version/cross-app probes: **PASS**.
- `pnpm typecheck:changed`: **BLOCKED** by the pre-existing
  `plugins/generated-pane` TS2883 declaration-build error.
- `pnpm test:changed`: **BLOCKED during dependency builds** by existing Core
  Fastify type incompatibilities; targeted plugin and workspace checks above
  passed.
- `git diff --check` in both repositories: **PASS**.
