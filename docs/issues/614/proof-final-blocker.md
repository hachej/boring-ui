# #614 final blocker proof

## Change

- `createCoreWorkspaceAgentServer` now honors an explicitly injected hosted `runtimeModeAdapter` instead of forcing only the remote-worker env adapter through to `registerAgentRoutes`.
- The hosted Tasks/Postgres integration test now runs through the Vercel sandbox mode adapter plus the existing mock Vercel sandbox fixture, with the production Postgres-backed `WorkspaceRuntimeSandboxHandleStore` bound after Core boot.
- The test persists a task/session binding in Postgres, expires the current hosted sandbox, asserts adapter get/create replacement lifecycle calls, asserts the Postgres sandbox handle changes, then reopens/searches the linked session through the composed Tasks session port and TaskCard path.

## Test seam

A real Vercel sandbox cannot be created in unit/integration CI without external credentials. The seam uses the existing agent mock Vercel sandbox fixture with the real `createVercelSandboxModeAdapter`, so health check, cache eviction, `resolveSandboxHandle`, persisted handle store, and runtime bundle recreation are exercised without calling Vercel.

## Proof

- PASS: `pnpm --filter @hachej/boring-core exec vitest run src/app/server/__tests__/createCoreWorkspaceAgentServer.tasksPostgres.integration.test.ts --no-file-parallelism`
- PASS: `pnpm --filter @hachej/boring-core run typecheck`
- PASS: `/home/ubuntu/.pi/agent/skills/coding-autoreview/scripts/autoreview --mode local` (clean; no accepted/actionable findings after one accepted P2 fix)
