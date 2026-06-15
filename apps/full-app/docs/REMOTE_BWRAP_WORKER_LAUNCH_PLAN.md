# Remote bwrap Worker Launch Plan

## Goal

Launch `https://boring-full-app.fly.dev/` publicly tomorrow with all user workspace execution and workspace files kept on EU Fly infrastructure, without running untrusted bwrap workloads on the public web app Machine.

This is a launch plan, not the final long-term runtime architecture. The priority is a small, safe-enough change that avoids split-brain filesystem behavior while keeping model/provider secrets on the public app. Because the agent stays on the public app, the minimal launch change is a narrow remote worker runtime adapter: host-side agent/file routes call an internal worker API for workspace filesystem and bwrap exec.

Simplicity rule: do not build worker pools, object-storage sync, plugin-runtime proxying, or durable distributed bridge state for tomorrow. Keep model/provider keys and the agent harness on the public app. Use one worker, one volume, one small internal worker API, one internal token, one execution semaphore, and explicit smoke checks.

## Current implementation summary

Current runtime modes in `@hachej/boring-agent`:

- `direct`: host filesystem + host shell.
- `local`: host filesystem + bwrap shell on the same Node host.
- `vercel-sandbox`: remote Vercel sandbox workspace + exec adapter.

Relevant files:

- `packages/agent/src/server/runtime/modes/local.ts`
- `packages/agent/src/server/sandbox/bwrap/createBwrapSandbox.ts`
- `packages/agent/src/server/sandbox/bwrap/buildBwrapArgs.ts`
- `packages/agent/src/server/workspace/createNodeWorkspace.ts`
- `packages/agent/src/server/registerAgentRoutes.ts`
- `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`
- `apps/full-app/src/server/main.ts`
- `apps/full-app/Dockerfile`
- `apps/full-app/fly.toml`

In `local` mode, `registerAgentRoutes` creates one runtime bundle per workspace scope:

```text
runtimeBundle.workspace   -> createNodeWorkspace(workspaceRoot)
runtimeBundle.sandbox     -> createBwrapSandbox(hostWorkspaceRoot)
runtimeBundle.fileSearch  -> createServerFileSearch(workspace, sandbox)
```

The file tree, file editor, agent file tools, search, and bash all share this runtime bundle when they run in the same server process.

## Existing mechanisms to leverage

Do not rebuild plumbing that already exists:

- **Runtime seam:** `RuntimeModeAdapter.create()` already returns `RuntimeBundle`. Add one `remote-worker` adapter instead of adding route-level conditionals.
- **Public route wiring:** `registerAgentRoutes` already registers public file/tree/fs/search/chat routes against `runtimeBundle.workspace`, `runtimeBundle.sandbox`, and `runtimeBundle.fileSearch`.
- **Workspace contract:** implement `RemoteWorkerWorkspace` against the existing `Workspace` interface. Public routes and file tools should not know it is remote.
- **Sandbox contract:** implement `RemoteWorkerSandbox` against the existing `Sandbox.exec` interface (`placement: 'remote'`, `provider: 'remote-worker'`).
- **File search:** reuse `createServerFileSearch(workspace, sandbox)` so search runs `find` through `RemoteWorkerSandbox.exec()`. Do not add a worker search endpoint for launch.
- **Path safety:** worker filesystem endpoints should use `createNodeWorkspace()` and `packages/agent/src/server/workspace/paths.ts`; do not write new path validators for file paths. Worker workspace ids themselves must be UUIDs, so storage paths are always `/data/workspaces/<workspace-uuid>`.
- **bwrap:** worker exec should reuse `createBwrapSandbox()` / `buildBwrapArgs()` and add only worker-level env allowlisting, semaphore, and optional `ulimit`/`prlimit` wrapper.
- **fs events:** public `/api/v1/fs/events` already supports `Workspace.watch()`, heartbeat, replay, and `resync-required`. Implement `RemoteWorkerWorkspace.watch()` by bridging worker file events into that interface.
- **Vercel remote patterns:** copy the shape of Vercel's remote workspace/sandbox adapters for streaming, abort, timeout, and cache invalidation; do not copy Vercel provider specifics.
- **UI bridge:** workspace UI tools already tolerate `workspaceRoot: undefined` in remote modes; keep UI bridge local on public app.

## Problem to avoid

Do not only move bash execution to another Machine while keeping file APIs on the public app. That creates split brain:

```text
public app /api/v1/files   -> public Machine /data/workspaces/<workspaceId>
worker bwrap bash          -> worker Machine /data/workspaces/<workspaceId>
```

The user would edit one filesystem while the agent executes against another.

## Launch architecture

Use two Fly apps in the same EU region (`cdg` unless changed deliberately):

```text
boring-full-app
  public HTTPS
  auth/core/frontend/db routes
  agent harness + model/provider calls
  public file/tree/search/ui routes
  no untrusted bwrap execution
  calls worker over Fly private networking for workspace fs + bwrap exec

boring-sandbox-worker
  private/internal only
  bwrap installed
  /data Fly Volume mounted
  owns /data/workspaces/<workspace-uuid>
  exposes a small internal worker API for filesystem, search/watch, and exec
```

The browser continues to call `https://boring-full-app.fly.dev/...`. The public app authenticates and authorizes the user, resolves the workspace id, and its runtime adapter calls the internal worker with trusted headers. The worker never receives browser cookies and never calls the LLM provider.

## Route ownership

### Public app owns

- Auth routes.
- Core workspace CRUD/member/settings/invites routes.
- Frontend SPA assets and fallback.
- Health route for the public app.

### Worker owns internally

Keep this boring: do **not** proxy public `/api/v1/agent` to the worker. The public app keeps owning all browser-facing runtime routes.

The worker exposes only an internal API over Fly private networking. Keep the API as thin as possible and reuse existing agent abstractions:

```text
/internal/workspaces/:workspaceId/files/*
/internal/workspaces/:workspaceId/tree
/internal/workspaces/:workspaceId/fs/events
/internal/workspaces/:workspaceId/exec
/internal/health
```

Do **not** add internal search or git endpoints for launch:

- Search can reuse existing `createServerFileSearch(workspace, sandbox)`, which runs `find` through `RemoteSandbox.exec()`.
- Git file URL needs a host git root and can be disabled/return unavailable in remote-worker mode for launch.

The worker only needs to satisfy the host-side `Workspace` and `Sandbox.exec` contracts. It should not expose chat, model, UI bridge, plugin, auth, member, invite, settings, search, or git routes.

Public routes that remain on `boring-full-app`:

```text
/api/v1/agent/*
/api/v1/files*
/api/v1/tree*
/api/v1/fs/events
/api/v1/git/*
/api/v1/ui/*
/api/v1/ready-status
/api/v1/workspace-settings
/api/v1/dirs
/api/v1/stat
/api/v1/agent-plugins*
/api/v1/plugins/*
```

For the worker-backed routes among these, public handlers call the remote worker runtime adapter; the browser still sees same-origin public app URLs.

Remote-mode filesystem-touch matrix for launch:

| Public surface | Existing owner | Remote-worker behavior |
| --- | --- | --- |
| `/api/v1/files*`, `/api/v1/dirs`, `/api/v1/stat` | `fileRoutes` using `Workspace` | Uses `RemoteWorkerWorkspace`; worker reuses `createNodeWorkspace()` validators. |
| `/api/v1/tree*` | `treeRoutes` using `Workspace.readdir` | Uses `RemoteWorkerWorkspace.readdir`. |
| `/api/v1/fs/events` | `fsEventsRoutes` using `Workspace.watch()` | Uses `RemoteWorkerWorkspace.watch()` bridged to worker file events. |
| `/api/v1/files/search` | `searchRoutes` using `FileSearch` | Reuse `createServerFileSearch(workspace, sandbox)`; no worker search route. |
| Agent read/write/edit/ls/find/grep tools | built from `RuntimeBundle` | Must use workspace-backed remote ops, not `boundFs(storageRoot)` on the public app. Reuse/generalize Vercel workspace ops. |
| Agent bash tool | built from `RuntimeBundle.sandbox` | Must call `RemoteWorkerSandbox.exec()`, not local bwrap spawn hook. Reuse/generalize Vercel `sandbox.exec` bash ops. |
| `/api/v1/git/file-url` | host git root helper | Disable/return unavailable in `remote-worker` launch mode; no worker git endpoint. |
| `/api/v1/ui/*`, pi-chat/model routes | public app | Stay local on public app; no worker calls except through agent tools. |
| plugin authoring/runtime plugin routes | public app/package system | Disabled for public launch unless explicitly re-approved. |

Plugin authoring/dynamic runtime plugins are disabled for the public launch unless explicitly re-approved.

## Why use a host-side remote runtime adapter

The public app creates one host-side runtime bundle whose `Workspace` and `Sandbox.exec` implementations talk to the worker. `FileSearch` should reuse the existing `createServerFileSearch(workspace, sandbox)` helper against that remote sandbox. That keeps all public routes, chat sessions, model calls, and UI bridge state on the host, while every filesystem mutation and shell command happens on the worker volume.

```text
Browser file tree -> public /api/v1/tree  -> RemoteWorkspace -> worker /data/workspaces/<id>
Browser editor    -> public /api/v1/files -> RemoteWorkspace -> worker /data/workspaces/<id>
Agent read/write  -> host tools           -> RemoteWorkspace -> worker /data/workspaces/<id>
Agent bash        -> host tool            -> RemoteSandbox   -> worker bwrap bind-mounted to same path
UI bridge         -> public /api/v1/ui    -> host in-memory bridge
Model calls       -> host agent harness   -> provider keys stay on host
```

The file tree and the agent still see the same files because both go through the same host-side remote runtime adapter.

## Public app changes

### Add config

Add environment variables:

```text
BORING_WORKER_BASE_URL=http://boring-sandbox-worker.internal:3000
BORING_WORKER_INTERNAL_TOKEN=<random secret shared with worker>
```

Keep existing model/provider secrets on `boring-full-app`; do not copy them to the worker.

### Add remote worker runtime adapter branch

In `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`, keep calling `registerAgentRoutes` locally. Add a branch that supplies a custom runtime adapter when `BORING_WORKER_BASE_URL` is set:

- If `BORING_WORKER_BASE_URL` is unset: keep current behavior.
- If set:
  - call `registerAgentRoutes` locally as today.
  - keep `uiRoutes` local as today.
  - pass a worker-backed `runtimeModeAdapter`/mode to agent route registration.
  - the adapter returns `RemoteWorkspace`, `RemoteSandbox`, and `fileSearch: createServerFileSearch(workspace, sandbox)`.
  - remote mode fails closed: if worker base URL, token, startup health, or worker auth fails, do not fall back to `direct`, `local`, or in-process bwrap.

Forward internal worker headers on server-to-worker calls only:

```text
x-boring-internal-token: <BORING_WORKER_INTERNAL_TOKEN>
x-boring-workspace-id: <authorized workspace id>
x-boring-request-id: <fastify request id when available>
```

Do not forward browser cookies or browser-supplied `x-boring-*` headers to the worker. The public app computes workspace identity after normal auth/authorization.

Enforce this through a single worker request builder, e.g. `createWorkerRequest({ workspaceId, requestId })`, that constructs headers from scratch. No worker client should pass through incoming browser headers.

### Worker client behavior

Requirements:

- Preserve binary/text file content correctly.
- Stream worker file events into `RemoteWorkerWorkspace.watch()` so the existing public `/api/v1/fs/events` route can handle heartbeat/replay/resync.
- Execute bwrap commands through worker `/internal/workspaces/:workspaceId/exec` and stream stdout/stderr updates back through the host tool pipeline.
- Use internal token + trusted workspace id on every worker call.
- Map worker 401/403/5xx responses into existing public route/tool errors.
- Add remote-worker branches or generic helpers in `buildFilesystemAgentTools()` and `buildHarnessAgentTools()` so file tools and bash use `Workspace`/`Sandbox.exec` rather than public-app host filesystem.

Prefer small focused modules, e.g.:

```text
packages/agent/src/server/runtime/modes/remote-worker.ts
packages/agent/src/server/workspace/createRemoteWorkerWorkspace.ts
packages/agent/src/server/sandbox/remote-worker/createRemoteWorkerSandbox.ts
packages/agent/src/server/sandbox/remote-worker/workerClient.ts
```

Keep them launch-specific and thin. Do not build a general worker-pool scheduler. Route registration should not know whether the runtime is local or remote; only runtime bundle creation should branch.

## Worker server changes

Add a worker entrypoint for full-app, e.g.:

```text
apps/full-app/src/server/agent-worker.ts
```

Decision for tomorrow: use a tiny explicit worker server, not `createWorkspaceAgentServer` and not `registerAgentRoutes`.

Register only:

- auth guard for `x-boring-internal-token`
- internal workspace filesystem endpoints
- internal file search/tree endpoints
- internal fs event stream if needed by `RemoteWorkspace.watch()`
- internal bwrap exec endpoint
- `healthRoutes` or a simple `/internal/health`

Avoid `createWorkspaceAgentServer` / `registerAgentRoutes` for launch because the worker must not own chat, model calls, UI bridge, or plugin-authoring behavior. Keep the worker surface boring and minimal.

Worker implementation should compose existing pieces per request/workspace:

```text
hostWorkspaceRoot = join(BORING_WORKER_WORKSPACE_ROOT, workspaceId)
runtimeContext = { runtimeCwd: '/workspace' }
workspace = createNodeWorkspace(hostWorkspaceRoot, { runtimeContext })
sandbox = createBwrapSandbox({ hostWorkspaceRoot, runtimeContext })
```

The worker endpoints should call these existing `Workspace` and `Sandbox` methods rather than duplicating filesystem or bwrap logic.

### Worker auth guard

Worker rejects all non-health runtime requests unless:

```text
x-boring-internal-token === BORING_WORKER_INTERNAL_TOKEN
```

It derives workspace id only from trusted internal header:

```text
x-boring-workspace-id
```

Validate workspace id as a single path segment before building any filesystem path.

### Worker workspace path

Use:

```text
/data/workspaces/<workspaceId>
```

Never use raw user input as a path. Never allow `/`, `..`, null bytes, or encoded traversal in workspace id.

## Fly deployment changes

### Public app

`apps/full-app/fly.toml` currently mounts `/data` on `boring-full-app`. Keep this mount for the launch window. It is not needed in the target architecture, but keeping it preserves the fastest config rollback path while the worker split is being validated.

Before enabling `BORING_WORKER_BASE_URL`, run the cutover data copy if existing workspaces live on the public app volume:

```text
1. Put public workspace writes/execution in maintenance/read-only mode.
2. Copy public /data/workspaces -> worker /data/workspaces, preserving ids, mtimes, symlinks, and permissions.
3. Verify a sample workspace file tree through the worker-backed public app.
4. Enable BORING_WORKER_BASE_URL.
5. Re-enable writes/execution.
```

Before public writes are allowed, decide the rollback data procedure:

- either copy worker `/data/workspaces` back to public `/data/workspaces` before disabling the worker path, or
- accept a temporary read-only/degraded workspace mode during rollback.

Do not rely on “unset `BORING_WORKER_BASE_URL`” as a complete rollback after users have created files on the worker volume.

Set secrets:

```bash
fly secrets set \
  BORING_WORKER_BASE_URL=http://boring-sandbox-worker.internal:3000 \
  BORING_WORKER_INTERNAL_TOKEN=<secret> \
  --app boring-full-app
```

Keep `primary_region = "cdg"`.

### Worker app

Create one worker Fly app and keep it single-Machine for launch:

```text
app = "boring-sandbox-worker"
primary_region = "cdg"
```

Do not scale to multiple workers tomorrow unless sticky-by-workspace routing exists. The launch architecture is explicitly **one worker Machine**. The worker owns the writable workspace volume, file-watch stream source, and active exec slots; a non-sticky worker pool would require routing and storage decisions that are out of scope for launch.

Attach volume:

```text
source = "workspace_data"
destination = "/data"
```

Enable and verify Fly volume snapshots before public launch. Treat this as a launch blocker. If Fly snapshots are not enough for the desired recovery posture, add an emergency backup job that archives `/data/workspaces` to EU object storage before announcement.

Set worker env/secrets from an allowlist only:

```text
NODE_ENV=production
BORING_WORKER_WORKSPACE_ROOT=/data/workspaces
BORING_WORKER_INTERNAL_TOKEN=<same secret>
```

Do not set provider/model keys, database URLs, auth secrets, mail secrets, or public-app session secrets on the worker. The worker is a filesystem/exec service only.

Install `bubblewrap` in the runtime image. Current `apps/full-app/Dockerfile` already installs:

```dockerfile
apt-get install -y --no-install-recommends bubblewrap ca-certificates
```

For tomorrow, reuse the same Dockerfile with a different CMD/env if quickest.

The worker Fly config must expose no public HTTP service. It should be reachable only over Fly private networking from `boring-full-app`. Confirm this in `fly.toml` and with a public reachability check before launch.

## Resource controls for tomorrow

Current bwrap code has:

- command timeout default: 30 seconds
- kill grace: 5 seconds
- max output default: 1 MiB
- bwrap namespace isolation

It does not currently enforce per-command memory/CPU limits in code.

Tomorrow controls:

- Worker Machine size is the hard outer resource cap.
- Add a worker-side active execution cap. This is a launch blocker, not optional.
- Start with small capacity and queue/reject when saturated.
- Keep public app isolated from worker resource exhaustion.

Initial launch settings:

```text
worker machines: 1
worker region: cdg
active worker execs: cap at 2-4 on the worker
command timeout: keep 30s default
max output: keep 1 MiB default
workspace quota: manual/operational at first if no code path exists
```

The concurrency cap must wrap worker exec only. Do not count or reject long-lived file-event streams as active executions, or the UI will break before the agent starts working.

Implementation target: a process-local semaphore around `/internal/workspaces/:workspaceId/exec`, with a clear “execution slots busy” response when full. Keep the first launch capacity low (2 active execs) and raise only after observing behavior. Do not add distributed queues or worker-pool scheduling for this launch.

Ship first with bwrap on the separate worker. BoxLite is explicitly deferred until after launch so tomorrow's scope stays bounded. Add a cheap `ulimit`/`prlimit` guard around bwrap command execution if it can be done surgically, but do not block launch on a BoxLite migration. The accepted launch posture is: no secrets on worker, no public worker HTTP, one worker, low exec concurrency, short command timeouts, output caps, worker-level Fly resource limits, and aggressive smoke/monitoring.

## Security / leak prevention requirements

Required for launch:

1. Public app authorizes workspace access before any worker call.
2. Public app strips any browser-supplied `x-boring-*` internal headers and reinjects trusted values after authorization.
3. Worker is protected by internal token. Worker startup fails if `BORING_WORKER_INTERNAL_TOKEN` is missing/empty, and the request guard rejects missing/empty header tokens before comparing.
4. Worker exposes no public HTTP service; it is reachable only over Fly private networking from the public app.
5. Worker uses workspace id from trusted host call only.
6. Worker validates workspace id as a UUID and rejects `default`, slugs, traversal, or any non-UUID segment.
7. Worker validates every file path as workspace-relative: reject absolute paths, `..`, null bytes, encoded traversal, and symlink escapes.
8. Worker has no model/provider keys, DB/auth/mail secrets, workspace settings encryption keys, GitHub tokens, PostHog/Sentry secrets, or public-app session secrets.
9. Worker env is allowlisted, not copied from the public app. Allowed launch env only: `NODE_ENV`, `BORING_WORKER_WORKSPACE_ROOT`, `BORING_WORKER_INTERNAL_TOKEN`, and explicit non-secret runtime toggles.
10. bwrap receives an allowlisted environment only. Do not pass `process.env` into bwrap. Default to `PATH`, `HOME=/workspace`, `PWD`, and explicitly provisioned non-secret runtime env.
11. bwrap does not bind-mount app/source/secrets/home directories. Do not mount `/app`, `/root`, `/home`, `/var/run`, `.env`, or secret files. Mount only workspace, required read-only system dirs, `/tmp` tmpfs, `/proc`, and `/dev` as currently needed.
12. Worker logs metadata only: request id, workspace id, operation, duration, exit code, byte counts. Do not log file contents, command env, auth headers, tokens, or full stdout/stderr by default.
13. Public app logging/telemetry follows the same no-content/no-token rule for prompts, file contents, tool args, command env, stdout/stderr, provider responses, and worker headers.
14. Worker runs in EU region only.
15. Worker volume lives in EU region only.
16. Public app does not run bwrap for untrusted users.
17. Launch copy must say: workspace storage and command execution are hosted on EU Fly infrastructure; model processing follows the selected model provider's terms and may not be EU-only.

Minimum no-leak launch checklist:

```text
[ ] Worker has no public HTTP service
[ ] Worker env contains no model/db/auth/mail/session secrets
[ ] Public app strips inbound x-boring-* headers before worker calls
[ ] Worker refuses to boot if internal token env is missing/empty
[ ] Worker requires non-empty internal token on every non-health endpoint
[ ] workspaceId UUID validation exists and rejects `default`
[ ] file path realpath/symlink escape validation exists and is tested
[ ] bwrap env is allowlisted; no process.env passthrough
[ ] bwrap does not bind /app, /root, /home, /var/run, .env, or secret files
[ ] cross-workspace symlink escape test passes
[ ] command cannot print host env secrets from inside bwrap
[ ] worker logs do not include file contents, command env, tokens, or full stdout/stderr
[ ] public app logs/telemetry do not include prompts, file contents, provider responses, command env, tokens, or full stdout/stderr
```

## Acceptance checks

### Local/dev smoke

- Start worker locally with a temp `/data/workspaces` equivalent.
- Start public app with `BORING_WORKER_BASE_URL` pointing at worker and model/provider keys present only on the public app.
- Open workspace in browser.
- Create/edit file via file tree.
- Ask agent to `cat` the file.
- Ask agent to create a file via bash.
- Confirm file appears in tree/editor.
- Confirm `/api/v1/ui` commands still work from agent to frontend.

### Deployed smoke

On Fly EU deploy:

- `/health` public app healthy.
- worker `/health` reachable only internally and not reachable from the public internet.
- Public browser can load workspace.
- File tree lists worker-backed files.
- Agent/model call runs on public app while bash runs in bwrap on worker.
- File created by agent is visible in file tree.
- File edited in editor is visible to agent bash.
- `/api/v1/fs/events` streams through proxy and receives a file-change event without buffering.
- `/api/v1/agent/pi-chat/:sessionId/events` streams from the public app during a prompt.
- `/api/v1/ui/commands/next` streams or long-polls from the public app and receives an agent UI command.
- Worker file-event stream connections survive longer than the configured heartbeat interval.
- Execution cap rejects or queues the N+1 worker exec while existing file-event streams remain connected.
- Reload browser mid-chat and confirm streams reconnect.
- Restart worker and confirm UI fails/reconnects gracefully rather than hanging silently.
- Public app remains healthy during a worker command timeout.

## Rollback plan

Fast rollback options:

1. Temporarily disable public execution while keeping auth/workspace UI live. This is the safest rollback after users have written data to the worker volume.
2. If Vercel sandbox credentials are valid, set `BORING_AGENT_MODE=vercel-sandbox` and keep current default behavior.
3. Unset `BORING_WORKER_BASE_URL` on public app to return to current in-process behavior **only after** copying worker data back or accepting degraded/read-only workspace behavior.

Data rollback procedure before disabling the worker path:

```text
1. Put workspace execution/file writes in maintenance/read-only mode.
2. Copy worker /data/workspaces -> public /data/workspaces, preserving ids, mtimes, symlinks, and permissions.
3. Verify a sample workspace file tree and agent read path on the public app.
4. Only then unset BORING_WORKER_BASE_URL or switch runtime mode.
```

Data created on the worker volume is not automatically present on the public app volume. Config rollback alone is service-shape rollback, not data rollback.

## Known launch compromises

- Worker shares one kernel across active bwrap sandboxes. This is acceptable for tomorrow only because it is separate from the public app and has no production secrets.
- Full per-sandbox CPU/RAM cgroup limits are not implemented in current bwrap code. This is an accepted launch risk. Launch compensates with no secrets on the worker, separate worker blast radius, low worker capacity, execution semaphore, command timeouts, output caps, Fly Machine resource limits, and preferably `ulimit`/`prlimit`.
- Fly Volume is attached to worker Machine; horizontal scaling with shared persistent storage is not solved. For tomorrow, use exactly one worker unless sticky workspace routing is implemented.
- UI bridge and chat session runtime stay on the public app. Restarting the worker should interrupt only active file watches/execs, not model/chat ownership; verify reconnect/retry behavior before launch.
- The launch `remote-worker` adapter is intentionally minimal and not the final scalable worker-pool architecture.

## Longer-term architecture after launch

Harden the minimal launch `remote-worker` adapter into a real `remote-bwrap` mode:

```text
RemoteWorkspace implements Workspace over HTTP/gRPC
RemoteSandbox implements Sandbox.exec over HTTP/gRPC
RemoteFileSearch delegates to worker
```

Long-term cleanup targets:

- Make filesystem tools operate generically on `Workspace` where possible, not Vercel-only vs host-fs special cases.
- Make bash tool use `Sandbox.exec` for remote providers instead of local spawn hooks.
- Add worker pool routing and sticky workspace placement.
- Add object storage or git-style snapshot persistence instead of one Fly Volume bottleneck.
- Add cgroup/prlimit resource controls around bwrap.
- Evaluate BoxLite as a post-launch replacement for the worker exec engine. Keep the worker `/internal/.../exec` API stable so `RemoteSandbox.exec()` can switch from bwrap to BoxLite without changing host routes or agent code.
- Add idle eviction and workspace snapshotting.

## Implementation order for tomorrow — leverage-first pass

Build the smallest adapter around existing seams. Do not duplicate route logic, path validators, search, or bwrap code.

### Phase 1 — worker core, reusing local mode internals

1. Add `apps/full-app/src/server/agent-worker.ts` as a tiny internal Fastify server.
2. Add a fail-closed worker auth plugin:
   - process exits on missing/empty `BORING_WORKER_INTERNAL_TOKEN`.
   - every non-health request requires a non-empty token.
   - token comparison uses constant-time comparison.
3. Add workspace resolver helper:
   - validates `workspaceId` as a safe segment.
   - maps to `join(BORING_WORKER_WORKSPACE_ROOT, workspaceId)`.
   - creates `runtimeContext = { runtimeCwd: '/workspace' }`.
   - returns `createNodeWorkspace(hostWorkspaceRoot, { runtimeContext })`.
4. Add internal filesystem/tree endpoints by delegating directly to that `Workspace` object. Reuse existing `createNodeWorkspace()` and `paths.ts`; do not implement custom path validation.
5. Add internal fs-events endpoint by delegating to `workspace.watch()` / existing watcher behavior. Keep the wire format minimal and convert back to `WorkspaceChangeEvent` in the host adapter.
6. Add internal exec endpoint by delegating to `createBwrapSandbox({ hostWorkspaceRoot, runtimeContext })`.
7. Add worker execution semaphore around the internal exec endpoint only.
8. Do not add internal search or git endpoints in the launch version.

### Phase 2 — host runtime adapter, reusing route registration

9. Add `remote-worker` `RuntimeModeAdapter` under `packages/agent/src/server/runtime/modes/remote-worker.ts`.
10. Implement `RemoteWorkerWorkspace` against the existing `Workspace` interface.
11. Implement `RemoteWorkerSandbox` against the existing `Sandbox.exec` interface, with `placement: 'remote'` and `provider: 'remote-worker'`.
12. Return `fileSearch: createServerFileSearch(workspace, sandbox)` from the adapter; do not implement `RemoteFileSearch` unless profiling later proves it necessary.
13. Add one worker client/request builder that constructs worker headers from scratch. No inbound browser headers are ever forwarded.
14. Wire the adapter from `createCoreWorkspaceAgentServer()` when `BORING_WORKER_BASE_URL` is set. Keep public `registerAgentRoutes` and `uiRoutes` local.
15. Remote mode fails closed: bad worker config, missing token, failed worker health, or worker auth failure must not fall back to `direct`, `local`, or public-app bwrap.

### Phase 3 — tool adapter leverage

16. Update filesystem tool selection so `remote-worker` uses workspace-backed operations, reusing/generalizing the existing Vercel workspace ops instead of `boundFs(storageRoot)`.
17. Update bash tool selection so `remote-worker` uses `Sandbox.exec`, reusing/generalizing the existing Vercel bash ops instead of local bwrap spawn hooks.
18. Disable/return unavailable for `/api/v1/git/file-url` in `remote-worker` launch mode because there is no public-app host git root.
19. Keep plugin authoring/runtime plugin routes disabled for launch.

### Phase 4 — deploy and prove

20. Add Docker CMD/env support for running worker entrypoint.
21. Add Fly worker config with no public HTTP service.
22. Deploy worker in `cdg` with volume and shared internal secret.
23. Enable/verify Fly volume snapshots or equivalent EU backup.
24. Deploy public app in `cdg` with worker base URL env.
25. Run local smoke, including file-tree/agent same-file behavior, fs-events, and execution-cap tests.
26. Run deployed smoke, including public-internet worker reachability check and worker restart behavior.
27. Only then announce public launch.

Non-goals for tomorrow: multi-worker scheduling, object-storage sync, per-user volume orchestration, Kubernetes, BoxLite migration, durable UI bridge, plugin authoring/runtime plugin proxying, and full cgroup manager. The minimal remote worker runtime adapter is intentionally in-scope because model/provider keys stay on the host. BoxLite can be added later behind the same worker exec API.
