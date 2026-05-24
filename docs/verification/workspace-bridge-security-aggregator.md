# WorkspaceBridge security and non-regression aggregator

Bead: `boring-ui-v2-reorg-poox`
Date: 2026-05-24

## Verdict

WorkspaceBridge v1 non-regression coverage is in place for the implemented phases. Unit/integration suites cover registry behavior, HTTP transport auth policy, runtime tokens/env, idempotency, human-input/ask-user flows, Macro bridge handlers, large Macro file-asset fallback, and package/invariant boundaries.

## Security invariants checked

- `WorkspaceBridge.emitUiEffect` remains the UI side-effect lane; RPC goes through `WorkspaceBridge.call/registerHandler` and `/api/v1/workspace-bridge/call` transport only.
- Runtime bearer tokens are scoped and redacted in tests/logs; browser callers do not receive runtime tokens.
- Browser CSRF/origin policy and runtime bearer policy are covered by WorkspaceBridge HTTP/auth tests.
- Capability checks are default-deny and tested for missing capability/workspace/session/plugin denial.
- Mutation idempotency and one-shot/concurrent answer-cancel paths are covered.
- Ask-user hard cutover is tested end-to-end through `human-input.v1.*`; frontend tests assert the old `/api/v1/questions/commands` route is not called.
- Macro bridge ops are limited to the approved v1 domain ops; no `workspace-files.v1.*`, deck, or `ch-query` bridge ops were added.
- Large Macro outputs use the injected file-asset/raw-file pointer fallback and reject unsafe paths/non-raw URLs.
- Transcript access is server/super-admin/debug only and denied to runtime/browser contexts in tests.
- Logs in the new tests include diagnostic op/session/caller/actor context while redacting tokens, answers, SQL text/full payloads, file contents, host paths, and raw URLs where sensitive.

## Commands and evidence

Passed:

```bash
pnpm typecheck
pnpm lint
pnpm lint:invariants
pnpm --filter @hachej/boring-workspace run test
pnpm --filter @hachej/boring-agent run test
pnpm --filter @hachej/boring-ask-user exec vitest run --maxWorkers=1
pnpm --filter @hachej/boring-workspace build
pnpm --filter workspace-playground test
```

Downstream Macro (`/home/ubuntu/projects/boring-macro`, commit `00f9ba71a`):

```bash
pnpm test src/plugins/macro/front/__tests__/macroSeriesAdapter.test.ts \
  src/plugins/macro/front/__tests__/macroSeriesData.test.ts \
  src/plugins/macro/server/__tests__/pythonSdkBridge.test.ts \
  src/plugins/macro/server/__tests__/macroServerPlugin.test.ts
pnpm typecheck
pnpm test
```

Macro results: targeted tests passed (11 tests), typecheck passed, full downstream tests passed (53 tests). Live direct/local/vercel Macro provider smoke was not runnable in this environment because no live Macro provider/WorkspaceBridge host is available; unit tests validate bridge request shapes, bearer env parsing, idempotency, and redaction.

Partially blocked by local infrastructure:

```bash
pnpm test
```

The root suite ran until `@hachej/boring-core` Postgres-backed suites attempted migrations against the local default DB and failed with `PostgresError: password authentication failed for user "ubuntu"` (`SQLSTATE 28P01`). This is an environment credential issue, not a WorkspaceBridge regression. Non-Postgres package suites relevant to WorkspaceBridge were run directly and passed as listed above.

## Grep/invariant checks

- `pnpm lint:invariants` passed.
- Ask-user shared has no `node:*` imports or `Buffer` usage.
- Ask-user package exports omit `./server`; old server setup is historical/fail-fast only.
- Macro supported front data/SDK/provisioning paths no longer contain `/api/macro/*`, `BORING_MACRO_API_URL`, `127.0.0.1`, or localhost assumptions (remaining matches are standalone/deck routes, test fixtures, or negative assertions).

## Residual risks / explicit skips

- Full DB-backed core test coverage requires valid local Postgres credentials. The failure and SQLSTATE were captured; no token or secret value was logged.
- Live Macro provider smoke is deferred until a provider/WorkspaceBridge host is available.
- `workspace-playground test` exits 0 with no script output.
