# Host run — Astra round 4

Date: 2026-09-17

Host API: `http://127.0.0.1:5210`  
Hub API: `http://127.0.0.1:9877`  
App origin: `http://127.0.0.1:9878`

Secrets came from the gitignored hub `.dev.vars`; no value is recorded here.

## Captured restart receipts

`.artifacts/astra4-restart-receipts.txt` records the live hub API, app-origin, and rebuilt workspace-host launcher PIDs. The hub and host were both restarted after the final builds. The host Apps route returned `{"apps":[],"workspaceId":"default"}` after restart: old store records intentionally point at the pre-change cell-address scheme and are omitted until republished.

## Serving-origin boundary — PASS

Astra's network-path and traversal probes against `:9878` returned 400 and never reached the host API:

```text
400 //127.0.0.1:5210/api/v1/plugins/app-runner/apps
400 /%2f%2f127.0.0.1:5210/api/v1/plugins/app-runner/apps
400 /w/e2e/demo/%2e%2e/%2e%2e/healthz
```

The listener constructs only `/w/{workspace}/{app}/...` requests against the configured fixed API origin. App responses set `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store`, a restrictive CSP, and `X-Content-Type-Options: nosniff`.

## Working browser app — PASS

`.artifacts/astra4-browser.mjs` published a fresh guestbook containing HTML, CSS, JavaScript, and a dynamic entries endpoint, then opened its signed URL with Playwright. Captured output is `.artifacts/astra4-browser.txt`; screenshot is `.artifacts/astra4-working-app.png`.

```json
{"document":["/w/proof/guestbook-mu5x3tib/",200],"js":["/w/proof/guestbook-mu5x3tib/client.js",200],"css":["/w/proof/guestbook-mu5x3tib/style.css",200],"api":["/w/proof/guestbook-mu5x3tib/api/entries",200],"body":"Guestbook\nAda"}
```

This proves the path-scoped HttpOnly cookie authorizes relative assets/API requests and the rendered body is non-empty with a visible entry. The panel refreshes its signed document URL every two minutes, before the three-minute token expiry; the app origin also exposes token-validated `__renew`.

## Exact-version execution — PASS

`.artifacts/astra4-version.txt` captures a fresh v1/v2 publication:

```json
{"previewV1":{"executedVersion":1},"advertisedV1AfterV2":{"status":409,"body":{"error":"version_mismatch","expectedVersion":1,"currentVersion":2}}}
```

Each version now has a stable `app:v{version}` facet. Activation copies the shared data snapshot into the target facet before running migrations. Hub E2E additionally proves rows survive v1→v2, failed migration, and rollback.

## Cell addressing — PASS

The hub uses a length-prefixed workspace/app identity and rejects `--` in either component. Hub E2E captured both ambiguous pairs being rejected. The README records the dev-state compatibility consequence.

## Profile isolation — PASS (regression boundary)

HTTP management/listing and prompt loading derive the sole permitted profile address with `profileAppName(authenticatedIdentity.id)`. Mutable record `kind` and `ownerUserId` do not grant access. Legacy ownerless records are claimed only after their derived address proves ownership. Plugin route/provider regressions pass, including the stored-record spoof case.

A second live authenticated host user was not available, so no two-browser-user claim is made.

## Dynamic capability admission — PASS (tests/typecheck)

The public dynamic seam now accepts only `ProvenancedRemoteAgentTool`. The harness rejects tools unless `executionKind === "remote"` and frozen provenance contains non-empty kind/address/SHA plus a positive version. Published provenance is frozen. The Apps route reads current hub inventory rather than stored manifest/SHA fields.

No host endpoint exposes the Pi runtime's active registry, and a new model turn was not run after the cell-address migration. Therefore this report does **not** call assistant prose or stored manifests an “actual mounted inventory,” and does not claim a fresh before/after rollback registry dump.

## a–g capability run

The restarted hub E2E (`.artifacts/astra4-hub-e2e.txt`) exercised the concrete a–g capability path with a fresh app: publish, native tool execution, migration with preserved rows, stale-version rejection, rollback with preserved rows, per-user profile instructions/tool execution, publish-as-truth, and persistence through version changes. Summary: `OVERALL: PASS` (39 checks, including the new collision check).

The earlier real-model a–g transcripts were **not regenerated** after the cell-address change. They remain historical evidence only; this report does not present them as a fresh full host/model run.

## Verification summary lines

- `pnpm --filter @hachej/boring-app-runner test`: **PASS**, 11 files / 48 tests.
- `pnpm --filter @hachej/boring-app-runner typecheck`: **PASS**.
- `pnpm --filter @hachej/boring-agent typecheck`: **PASS**.
- `pnpm --filter @hachej/boring-workspace typecheck`: **PASS**.
- `pnpm --filter @hachej/boring-agent test`: **PASS**, 249 files passed / 3 skipped; 2518 tests passed / 17 skipped; no type errors.
- `pnpm --filter @hachej/boring-workspace test`: **2334/2336 passed**; two unrelated failures (missing linked `@hachej/boring-bi-dashboard`, and an async chat-loading timing assertion).
- `pnpm typecheck:changed`: **BLOCKED before typecheck** by the existing `plugins/generated-pane` TS2883 declaration-build error.
- `pnpm test:changed`: **not reached** because it was chained after the blocked changed-typecheck command.
- Hub `node app-runner/scripts/e2e-test.mjs`: **OVERALL: PASS**.
- Live Playwright app: **document 200, JS 200, CSS 200, API 200, rendered `Guestbook / Ada`**.
- Exact-version probe: **v1 preview executed v1; stale advertised v1 returned 409 after v2 activation**.
- `git diff --check` in both repositories: **PASS**.
