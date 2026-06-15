# Remote bwrap Worker Implementation Tasks

## Task 1 — Worker internal server skeleton

Goal: add a tiny internal worker server entrypoint for `apps/full-app` without agent/chat/model/UI routes.

Files likely touched:

- `apps/full-app/src/server/agent-worker.ts`
- `apps/full-app/src/server/worker/config.ts`
- `apps/full-app/src/server/worker/auth.ts`
- `apps/full-app/tsconfig.server.json` or build config if needed
- `apps/full-app/package.json` scripts if useful

Acceptance:

- Worker starts as Fastify app.
- `/internal/health` returns ok.
- Worker refuses to boot if `BORING_WORKER_INTERNAL_TOKEN` or `BORING_WORKER_WORKSPACE_ROOT` is missing/empty.
- Non-health routes require non-empty `x-boring-internal-token` using constant-time comparison.
- Worker config is allowlisted; no model/db/auth/mail/session secrets are required by worker.
- Worker entrypoint stays small; config/auth/workspace/exec/routes live in focused modules.

## Task 2 — Worker workspace + bwrap endpoints using existing local internals

Goal: implement internal worker filesystem/tree/watch/exec API by reusing existing `Workspace` and `Sandbox` implementations.

Files likely touched:

- `apps/full-app/src/server/worker/workspace.ts`
- `apps/full-app/src/server/worker/routes.ts`
- `apps/full-app/src/server/worker/exec.ts`
- reuse `packages/agent/src/server/workspace/createNodeWorkspace.ts`
- reuse `packages/agent/src/server/sandbox/bwrap/createBwrapSandbox.ts`

Acceptance:

- Workspace id is validated as safe single segment.
- Workspace id must be a UUID; worker rejects `default`, slugs, and other non-UUID segments.
- Workspace root maps to `${BORING_WORKER_WORKSPACE_ROOT}/${workspaceId}`.
- File operations delegate to `createNodeWorkspace()`; no custom path validator.
- Worker fs-events endpoint delegates to `workspace.watch()` and emits a minimal typed event stream.
- Exec delegates to `createBwrapSandbox()`.
- Exec endpoint has process-local semaphore.
- Semaphore wraps exec endpoint only; fs-events streams are never counted/rejected.
- Exec honors timeout/max output/stdout/stderr/exit code.
- Exec env is allowlisted; no `process.env` passthrough.
- bwrap does not receive worker internal token.
- No internal search or git endpoint for launch.
- Unit tests cover worker auth fail-closed, workspace id validation, and symlink/path escape behavior via existing validators.

## Task 3 — Internal worker protocol + host remote-worker runtime adapter

Goal: add a typed worker protocol and a `RuntimeModeAdapter` that keeps public app routes/model/UI local but uses worker for workspace fs + bwrap exec.

Files likely touched:

- `packages/agent/src/server/sandbox/remote-worker/protocol.ts`
- `packages/agent/src/server/runtime/modes/remote-worker.ts`
- `packages/agent/src/server/workspace/createRemoteWorkerWorkspace.ts`
- `packages/agent/src/server/sandbox/remote-worker/createRemoteWorkerSandbox.ts`
- `packages/agent/src/server/sandbox/remote-worker/workerClient.ts`
- exports in `packages/agent/src/server/index.ts` if needed

Acceptance:

- Tiny shared protocol covers routes, headers, errors, binary/text file payloads, exec result/chunks, and fs-event wire format.
- Adapter id `remote-worker`.
- `workspaceFsCapability` conservative (`best-effort`).
- Returns `RemoteWorkerWorkspace`, `RemoteWorkerSandbox`, `runtimeContext: { runtimeCwd: '/workspace' }`.
- Returns `fileSearch: createServerFileSearch(workspace, sandbox)`.
- One worker request builder constructs headers from scratch; no browser headers pass through.
- Preserves binary/text file content correctly.
- `RemoteWorkerWorkspace.watch()` bridges worker events into existing public fs-events contract.
- `RemoteWorkerSandbox.exec()` supports stdout/stderr streaming callbacks, abort propagation, timeout mapping, max output, and worker error mapping.
- Remote mode fails closed; no fallback to direct/local on bad config, worker health failure, or worker auth failure.

## Task 4 — Remote-worker tool support

Goal: ensure agent file tools and bash use worker-backed `Workspace`/`Sandbox`, not public host filesystem.

Files likely touched:

- `packages/agent/src/server/tools/filesystem/index.ts`
- `packages/agent/src/server/tools/harness/index.ts`
- likely extract generic workspace-backed ops from `packages/agent/src/server/tools/operations/vercel.ts`

Acceptance:

- Shared workspace-backed tool ops are generic over `Workspace`/`Sandbox.exec`; avoid scattered `if mode === "remote-worker"` branches.
- Existing `vercel-sandbox` behavior remains covered/passing.
- `remote-worker` filesystem tools use workspace-backed ops.
- `remote-worker` bash tool uses `Sandbox.exec`.
- `boundFs(storageRoot)` is not used for remote-worker tools.
- Search works through `createServerFileSearch()` + `RemoteWorkerSandbox.exec()`.

## Task 5 — Core/full-app wiring

Goal: wire `BORING_WORKER_BASE_URL` into full app server as a host-side runtime adapter while keeping public routes local.

Files likely touched:

- `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`
- possibly `apps/full-app/src/server/main.ts`

Acceptance:

- When `BORING_WORKER_BASE_URL` is unset, behavior is unchanged.
- When set, `registerAgentRoutes` still runs on public app and receives `runtimeModeAdapter: remoteWorkerModeAdapter`.
- `uiRoutes` remains public/local.
- Git file-url returns unavailable/disabled in remote-worker launch mode rather than requiring a host `storageRoot`.
- Plugin authoring/runtime plugin routes are unavailable/disabled in remote-worker production launch mode unless explicitly enabled.

## Task 6 — Deploy/build/cutover config

Goal: enable building/running the worker app on Fly and document launch-critical operations.

Files likely touched:

- `apps/full-app/Dockerfile`
- new worker Fly config, e.g. `apps/full-app/fly.worker.toml`
- package/build scripts if needed
- docs/procedure notes if needed

Acceptance:

- Production worker image uses the `worker-runtime` Docker target and does not include `/app/apps/full-app`.
- Production image includes worker entrypoint JS.
- Worker can run with a different CMD.
- Worker Fly config uses `cdg`, one worker Machine, volume mounted at `/data`, and no public HTTP service.
- Worker env allowlist is documented: no provider/db/auth/mail/session secrets.
- `bubblewrap` remains installed.
- Fly volume snapshots or EU backup are verified before public launch.
- Cutover copy procedure blocks editor writes, agent writes, and exec while copying.
- Rollback copy-back procedure has direction, write-stop/read-only window, conflict policy, and verification.

## Task 7 — Tests and smoke coverage

Goal: prove no split brain and no obvious leak path.

Test targets:

- worker auth fail-closed behavior
- workspace id validation
- path/symlink escape behavior
- remote worker protocol/client behavior
- integration test with public app + worker or direct runtime adapter mocked worker
- bwrap smoke on Fly worker after deploy
- log sampling / assertions where feasible

Acceptance:

- File created by public file API is visible to agent bash.
- File created by agent bash is visible in public file tree/editor.
- File search returns worker files.
- `/api/v1/fs/events` streams worker file changes without buffering.
- Pi-chat SSE and UI command stream/long-poll remain host-owned and working.
- Reload mid-chat reconnects.
- Worker restart/failure produces clear degraded/runtime error and does not fall back to local bwrap/direct.
- Public app remains healthy during worker command timeout.
- Execution cap rejects or queues N+1 worker exec while file-event streams remain connected.
- Worker rejects missing/empty/bad internal token.
- Worker env is not visible inside bwrap command.
- bwrap env allowlisting, forbidden bind mounts, and no `process.env` passthrough are verified as far as tests can prove.
- Symlink escape test passes.
- Plugin authoring/runtime plugin routes are disabled/unavailable in launch mode.
- Worker/public logs do not include worker headers, stdout/stderr, tool args, provider payloads, or file contents by default.
- Relevant package typecheck/tests pass.

## Task 8 — Final thermo review and validation

Goal: before final response, run another strict review pass on the implementation diff and fix blockers.

Acceptance:

- Claude/Opus review of final diff has no P0/P1 blockers or they are fixed/explicitly accepted.
- Codex/GPT review of final diff has no P0/P1 blockers or they are fixed/explicitly accepted.
- Relevant tests/typecheck pass.
