# Host run — Astra round 7

Date: 2026-09-17

Host UI/API: `http://127.0.0.1:5202`  
Hub API: `http://127.0.0.1:9877`  
Per-app dev origin: `<app-id>.apps.localhost:9878`

Secrets came from the gitignored hub `.dev.vars`; no value is recorded here.

## Descriptor-only capability admission — PASS

The registration surface no longer exports the public capability-minting
function and no longer accepts executable dynamic tools. App-runner contributes
plain descriptors containing exactly kind, workspace id, address, version, SHA,
tool name, description, and input schema. It does not construct, retain, or
supply an executor.

The agent runtime rejects malformed descriptors and any nested function-valued
property. At every refresh it fetches `/current` directly with host-owned hub
configuration and authenticated run identity, then verifies workspace/address,
kind, version, SHA, manifest membership, and schema before constructing a new
frozen executor. Execution rechecks the authenticated workspace and dispatches
to the pinned hub tool endpoint. No plugin callback is retained in the mounted
capability.

The focused regression matrix covers: function-bearing descriptors; wrong
workspace, version, and SHA; a tool absent from the manifest; a genuine
descriptor whose runtime-built executor emits the exact authenticated hub
request; attempted post-mount descriptor/executor mutation; and two refreshes
producing distinct executors after two fresh manifest requests.

This aligns with ratified R1/D33: executable selection and credentials remain
host-owned, while the plugin contributes serializable mechanism facts only.

## Hub and sandboxed panel — PASS

`.artifacts/astra7-hub-e2e.txt` is a fresh live hub run: **OVERALL: PASS** (39
checks), including failed-migration rollback and version-pinned dispatch.

`.artifacts/astra7-panel.txt` and `apps/workspace-playground/.artifacts/astra7-panel.png` are a fresh live
Apps-panel capture. The iframe retained exactly
`sandbox="allow-scripts allow-forms"`; document, CSS, JavaScript, and
`/api/entries` each returned 200, and the rendered body was `Guestbook / Ada`.

## Verification

- agent descriptor admission regression: **PASS**, 8 tests.
- `pnpm --filter @hachej/boring-app-runner test`: **PASS**, 11 files / 48 tests.
- `pnpm --filter @hachej/boring-app-runner typecheck`: **PASS**.
- focused workspace registration test: **PASS**, 41 tests.
- `pnpm --filter @hachej/boring-workspace typecheck`: **PASS**.
- `pnpm --filter @hachej/boring-agent typecheck`: **PASS**.
- `pnpm lint:invariants`: **PASS**, including workspace-plugin and
  cross-package alignment gates.
- hub `node app-runner/scripts/e2e-test.mjs`: **OVERALL: PASS**, 39 checks.
- live panel iframe: **document/CSS/JS/API 200**, rendered `Guestbook / Ada`.
- `pnpm typecheck:changed`: **BLOCKED** during broad dependency builds by the
  existing `plugins/generated-pane` TS2883 declaration error and existing
  `packages/core` Fastify type-identity errors. Scoped affected-package
  typechecks above passed.
- `pnpm test:changed`: **BLOCKED during the same dependency build** by the
  existing generated-pane TS2883 error; focused affected tests above passed.
- `git diff --check`: **PASS**.

The full external-model a–g transcript was **not rerun**. No provider-backed
model/inventory/restart claim is made from these focused checks. The live hub
and panel services were already running for this round; their startup procedure
was not rerun.
