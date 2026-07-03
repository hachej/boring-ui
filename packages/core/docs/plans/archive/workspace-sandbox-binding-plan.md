# Workspace Sandbox Binding Plan

Status: draft for review
Date: 2026-04-29

## Problem

The full app currently does not enforce the runtime invariant the product needs:

> One workspace owns one sandbox. Requests for that workspace must always route
> to that workspace's sandbox until an explicit reset/reprovision action changes
> the binding.

The live Vercel sandbox failure exposed three separate gaps:

1. `workspace_runtimes` has no `sandbox_id` column. The current Drizzle schema
   tracks runtime state, sprite metadata, `volume_path`, and `last_error_op`, but
   no provider sandbox identity.
2. The live Neon table is behind the checked-in schema. It only has
   `workspace_id`, sprite fields, `state`, `last_error`, `updated_at`,
   `provisioning_step`, and `step_started_at`; it is missing the checked-in
   `0007_v7_substrate.sql` columns `volume_path` and `last_error_op`.
3. Embedded agent routes build one runtime bundle at Fastify boot from a single
   `workspaceRoot`. The request hook also sets
   `request.workspaceContext.workspaceId = "default"`, so file/tree/chat/search
   traffic is not scoped to the selected core workspace.

The current Vercel sandbox handle persistence is also wrong for the full app:
`FileHandleStore` stores handles in `~/.config/boring-agent/sandboxes.json`,
keyed by the adapter's `workspaceId`. In embedded full-app mode that key is the
static workspace root path, not the core workspace id. That creates one sandbox
for the app server process instead of one sandbox per workspace.

## Goals

- Persist the Vercel `sandbox_id` in core, keyed by `workspace_id`.
- Route file, tree, search, chat, session, and UI bridge calls through the
  current workspace id.
- Reuse the same sandbox id for repeated requests to the same workspace.
- Do not silently replace a stopped/expired sandbox. If the provider says the
  persisted sandbox is terminal or inaccessible, mark the workspace runtime as
  `error` and require an explicit user/admin reset to create a new sandbox id.
- Keep `@boring/agent` core-free. Agent should accept injected runtime stores
  and workspace resolvers; it must not import `@boring/core`.
- Preserve standalone `npx @boring/agent` behavior with the file-backed handle
  store.
- Make the Vercel timeout/keepalive behavior explicit so local testing does not
  accidentally rely on the provider's short default timeout.

## Non-Goals

- No broad cloud package or billing orchestration.
- No automatic migration of the current local JSON sandbox handle into a
  workspace runtime row. The current handle was keyed by a temp root and is not
  a trustworthy workspace binding.
- No silent sandbox replacement on 404/410/stopped. Replacement is only allowed
  in an explicit provision/reset path.
- No deletion of remote sandboxes as part of this work unless a later task asks
  for destructive cleanup explicitly.

## Current State

### Core Runtime Store

Relevant files:

- `packages/core/src/server/db/schema.ts`
- `packages/core/src/shared/types.ts`
- `packages/core/src/server/db/stores/PostgresWorkspaceStore.ts`
- `packages/core/src/server/db/stores/LocalWorkspaceStore.ts`
- `packages/core/src/server/routes/settings.ts`
- `packages/core/src/front/workspace/WorkspaceSettingsPage.tsx`

`WorkspaceRuntime` currently has:

- `workspaceId`
- `spriteUrl`
- `spriteName`
- `state: "pending" | "ready" | "error"`
- `lastError`
- `volumePath`
- `lastErrorOp`
- `provisioningStep`
- `stepStartedAt`
- `updatedAt`

There is no field for:

- sandbox provider
- sandbox id
- sandbox status
- sandbox last-seen timestamp
- sandbox expiration/timeout timestamp
- explicit reset/provision lineage

`getWorkspaceRuntime()` auto-creates a `ready` runtime row when a workspace has
no row. That was acceptable for local filesystem runtimes, but it is misleading
for Vercel sandbox runtimes because `ready` should mean there is an actual
provider sandbox binding.

### Agent Embedded Runtime

Relevant files:

- `packages/agent/src/server/registerAgentRoutes.ts`
- `packages/agent/src/server/runtime/modes/vercel-sandbox.ts`
- `packages/agent/src/server/sandbox/vercel-sandbox/resolveSandboxHandle.ts`
- `packages/agent/src/shared/sandbox-handle-store.ts`
- `packages/agent/src/server/sandbox/vercel-sandbox/FileHandleStore.ts`

`registerAgentRoutes()` resolves the runtime once at server boot:

- `const runtimeBundle = await resolveMode(resolvedMode).create(...)`
- all routes receive that same `runtimeBundle.workspace`
- chat receives one harness built from that same bundle

That means all workspaces share one workspace/sandbox. The request hook also
hardcodes `workspaceId: "default"`.

`createVercelSandboxModeAdapter()` currently sets:

- `const workspaceId = ctx.workspaceRoot`

That makes the persisted handle key the root path, not the core workspace id.

`resolveSandboxHandle()` currently recreates from snapshot/tarball on 404/410
and also creates a fresh sandbox after seeing an expired in-process sandbox.
That is useful for standalone agent resilience, but unsafe for the full app
because it hides a workspace sandbox replacement from the user.

### Frontend Request Scoping

Relevant files:

- `packages/workspace/src/data/DataProvider.tsx`
- `packages/workspace/src/data/fetchClient.ts`
- `packages/workspace/src/data/hooks.ts`
- `packages/agent/src/front/ChatPanel.tsx`
- `apps/full-app/src/front/main.tsx`

The workspace package has an `authHeaders` path through `DataProvider` and
`FetchClient`, so file/tree/search requests can carry a workspace header.

Chat and session requests need the same scoping. The chat path needs a
request-header or URL parameter propagation path from the full app to
`ChatPanel` and the underlying chat transport.

SSE is special: browser `EventSource` cannot send custom headers. File-event
or UI-event streams should use `?workspaceId=<id>` on the stream URL, with
server-side membership validation before the stream opens.

## Target Architecture

### 1. Persist Sandbox Binding In Core

Add sandbox metadata to `WorkspaceRuntime`.

Recommended columns:

- `sandbox_provider text null`
  - initial value: `"vercel"`
  - future values can include `"local"`, `"fly"`, `"modal"`, etc.
- `sandbox_id text null`
  - provider id, e.g. `sbx_...`
- `sandbox_status text null`
  - provider-observed status such as `pending`, `running`, `stopped`, `failed`,
    `aborted`, `snapshotting`, `stopping`, or null when unknown
- `sandbox_snapshot_id text null`
  - last known source snapshot id, if any
- `sandbox_created_at timestamptz null`
  - provider binding creation time as known by the app
- `sandbox_last_used_at timestamptz null`
  - app-observed last use
- `sandbox_last_seen_at timestamptz null`
  - app-observed last successful provider lookup
- `sandbox_expires_at timestamptz null`
  - app-estimated timeout horizon; default derivation is
    `sandbox_created_at + VERCEL_SANDBOX_TIMEOUT_MS` unless the provider SDK
    returns a better timestamp

The `workspace_id` primary key remains the ownership boundary. A workspace has
at most one active sandbox binding.

Migration strategy:

1. Audit `packages/core/drizzle/` for duplicate migration prefixes before
   adding a migration. The current tree contains two `0001_*.sql` files, so the
   migration chain/order must be made unambiguous before this change lands.
2. First reconcile the live database gap:
   - apply `0007_v7_substrate.sql`, or
   - create a forward idempotent migration that adds `volume_path` and
     `last_error_op` if missing and normalizes the state check.
   - use `ADD COLUMN IF NOT EXISTS` or equivalent `information_schema` checks
     for every gap column; do not assume `0007` is fully unapplied.
3. Add the sandbox columns in a new migration.
4. Update `packages/core/drizzle/schema.ts` and any migration metadata if this
   repo's Drizzle flow requires it.

Runtime type changes:

- Extend `WorkspaceRuntime` in `packages/core/src/shared/types.ts`.
- Update `toWorkspaceRuntime()` in `PostgresWorkspaceStore`.
- Update `LocalWorkspaceStore` to carry the same fields.
- Extend store conformance tests to assert sandbox fields persist and survive
  partial updates.

Important behavior change:

- For managed sandbox mode, a runtime row without `sandbox_id` is not `ready`.
  It is `pending` until provisioning succeeds.
- If preserving `getWorkspaceRuntime()` auto-create is required for old local
  tests, the created row should be mode-aware or clearly marked unmanaged. Do
  not auto-create `ready` Vercel runtime rows with no sandbox id.

### 2. Add A Core Sandbox Handle Store

Core should provide the DB-backed implementation. The full app should only wire
that implementation into the agent route registration.

To preserve package direction, core must not import `@boring/agent`. Instead,
core exports a structurally compatible handle-store object using core-owned
types:

```ts
type WorkspaceSandboxHandleRecord = {
  workspaceId: string
  sandboxId: string
  snapshotId?: string
  createdAt: string
  lastUsedAt: string
}

class WorkspaceRuntimeSandboxHandleStore {
  constructor(private readonly workspaceStore: WorkspaceStore) {}

  async get(workspaceId: string): Promise<WorkspaceSandboxHandleRecord | null>
  async put(record: WorkspaceSandboxHandleRecord): Promise<void>
  async delete(workspaceId: string): Promise<void>
  async list(): Promise<WorkspaceSandboxHandleRecord[]>
}
```

The full app passes this object to `registerAgentRoutes({ sandboxHandleStore })`.
TypeScript's structural typing lets the core object satisfy
`@boring/agent`'s `SandboxHandleStore` without core importing agent. If the app
needs an explicit type annotation, that annotation lives in `apps/full-app`, not
in core.

Mapping:

- `record.workspaceId` maps to `workspace_runtimes.workspace_id`.
- `record.sandboxId` maps to `sandbox_id`.
- `record.snapshotId` maps to `sandbox_snapshot_id`.
- `record.createdAt` maps to `sandbox_created_at`.
- `record.lastUsedAt` maps to `sandbox_last_used_at`.

Fields not present in the handle-store record are written by the provision path
or runtime callbacks directly through the workspace store:

- `sandbox_provider`
- `sandbox_status`
- `sandbox_last_seen_at`
- `sandbox_expires_at`

`delete()` must not be used as a silent reset in embedded full-app mode. It may
clear the binding only from an explicit reset/destroy flow.

The default file store remains the standalone agent default.

### 3. Make Agent Runtime Resolution Request-Scoped

Extend `registerAgentRoutes()` options with injected workspace and runtime
resolution hooks. Exact names can change during implementation, but the seam
should look like this:

```ts
interface RegisterAgentRoutesOptions {
  workspaceRoot?: string
  mode?: RuntimeModeId
  sandboxHandleStore?: SandboxHandleStore
  getWorkspaceId?: (request: FastifyRequest) => string | Promise<string>
  getWorkspaceRoot?: (workspaceId: string, request: FastifyRequest) => string | Promise<string>
  onRuntimeError?: (workspaceId: string, error: unknown) => Promise<void>
  missingWorkspaceIdBehavior?: "error" | "fallback-default"
}
```

Embedded full-app behavior:

- `getWorkspaceId()` reads `x-boring-workspace-id`.
- If the header is missing or malformed in embedded mode, the route responds
  with 400. It must not fall back to `"default"`.
- It verifies the authenticated user is a member of that workspace before any
  agent route touches filesystem or chat state.
- `getWorkspaceRoot()` maps local/direct mode to a per-workspace root under the
  provisioned volume path, not a single shared root.
- Vercel mode uses the core-backed handle store keyed by the core workspace id.

Runtime bundle cache:

- Replace one boot-time runtime bundle with a cache keyed by
  `{ workspaceId, mode }`.
- Same workspace id returns the same bundle while it remains healthy.
- Different workspace ids never share a bundle.
- In-flight runtime creation is deduped per workspace id.
- Cache entries must be evicted or marked unhealthy when provider access fails.
- Session ids in the chat harness are derived from the core workspace id, not
  from `workspaceRoot`; `DEFAULT_WORKSPACE_ID` is not used in embedded full-app
  mode.

Routes:

- Existing route plugins currently accept concrete `workspace`, `fileSearch`,
  `harness`, and trackers at registration time.
- Add lightweight request-scoped adapters so route handlers resolve the current
  bundle inside the request rather than sharing the boot bundle.
- Keep the existing registration-time code path for standalone mode if that is
  simpler, but embedded mode must be request-scoped.

Invariant:

- No `@boring/core` imports from `@boring/agent`.
- Agent only sees `workspaceId`, `SandboxHandleStore`, and callbacks/interfaces.

### 4. Stop Silent Vercel Sandbox Replacement In Embedded Mode

Change `resolveSandboxHandle()` to support explicit replacement policy.

Recommended option:

```ts
type MissingSandboxPolicy = "error" | "create"

interface ResolveSandboxHandleOptions {
  missingSandboxPolicy?: MissingSandboxPolicy
  terminalSandboxPolicy?: MissingSandboxPolicy
}
```

Standalone default:

- `missingSandboxPolicy: "create"`
- `terminalSandboxPolicy: "create"`

Embedded full-app default:

- `missingSandboxPolicy: "create"` only during first provision
- `terminalSandboxPolicy: "error"`
- after a `sandbox_id` exists, 404/410/stopped/failed/aborted returns a stable
  error instead of creating a fresh sandbox

On terminal provider state:

- update `workspace_runtimes.state = "error"`
- update `last_error`
- update `last_error_op = "sandbox_access"`
- persist provider `sandbox_status`
- keep the old `sandbox_id` visible for diagnosis until explicit reset

This is the critical product behavior: the app must never make it look like the
same workspace silently got a new sandbox.

### 5. Make Vercel Timeout Explicit

Add config for Vercel sandbox timeout:

- `VERCEL_SANDBOX_TIMEOUT_MS`
- default to a conservative value that works for the account tier used in dev
  and production
- clamp or validate against known provider limits if the SDK exposes them

Creation should pass the timeout explicitly if `@vercel/sandbox` supports it.

If the SDK supports `extendTimeout`, active workspaces should extend the timeout
on meaningful use:

- chat message start
- file tree open
- file read/write
- command execution

If timeout extension fails, record a warning but do not replace the sandbox.

### 6. Propagate Workspace Id Through Frontend Calls

Full app owns the selected workspace id. It should pass it into the workspace
and agent panels as request context.

Data/file calls:

- Set `authHeaders={{ "x-boring-workspace-id": workspaceId }}` on
  `WorkspaceProvider` / `DataProvider`.
- Include `workspaceId` in React Query keys so switching workspaces cannot show
  stale file trees from the previous workspace.

Chat/session/model calls:

- Add a `requestHeaders` or `workspaceId` prop through:
  - full app shell
  - workspace panels config
  - `ChatPanel`
  - chat transport
- Every chat/session request sends `x-boring-workspace-id`.

SSE/event calls:

- Use `?workspaceId=<id>` or a workspace-scoped path because native
  `EventSource` cannot send custom headers.
- The server must still authorize membership for that workspace before opening
  the stream.

### 7. Runtime UX

Update the workspace settings/runtime card to show sandbox identity when present:

- provider
- sandbox id
- provider status
- last seen
- last used
- estimated expiration
- current runtime state/error

Add explicit recovery actions:

- `Retry provision` remains for `last_error_op = "provision"` and no usable
  `sandbox_id`.
- `Reset sandbox` appears only for owners/admins when a sandbox exists but is
  terminal or inaccessible.

Reset behavior:

- must be an explicit POST endpoint, separate from generic retry
- should require a confirmation in the UI because the new sandbox id will not be
  the same provider instance
- should preserve old metadata in logs/audit if possible
- must log the old sandbox id before overwriting the current runtime row,
  because a separate runtime history table is out of scope for this plan
- should write the new `sandbox_id` only after create succeeds

Suggested endpoint:

- `POST /api/v1/workspaces/:id/runtime/sandbox/reset`

Do not overload `POST /api/v1/workspaces/:id/runtime/retry` with destructive
provider replacement semantics.

## Implementation Phases

Phase ordering note:

- Phase 3 and Phase 5 should deploy together. If server request scoping ships
  without frontend workspace propagation, embedded routes will correctly reject
  missing workspace context.
- Phase 4 and Phase 6 must deploy together. If terminal sandbox replacement is
  disabled without reset UX, users can reach an error state with no in-app
  recovery.

### Phase 1: Database And Store Contract

Files:

- `packages/core/src/server/db/schema.ts`
- `packages/core/drizzle/*.sql`
- `packages/core/src/shared/types.ts`
- `packages/core/src/server/db/stores/PostgresWorkspaceStore.ts`
- `packages/core/src/server/db/stores/LocalWorkspaceStore.ts`
- `packages/core/src/server/db/__tests__/storeConformance.ts`
- `packages/core/src/server/db/__tests__/workspaceRuntimes.schema.test.ts`

Tasks:

1. Audit `packages/core/drizzle/` for duplicate migration prefixes and make the
   apply order unambiguous before adding new migrations.
2. Add idempotent migration coverage for missing `0007` live columns if needed,
   using `ADD COLUMN IF NOT EXISTS` or equivalent column checks.
3. Add sandbox metadata columns.
4. Extend runtime types and mappers.
5. Add store tests for persistence and partial update behavior.
6. Decide whether runtime auto-create should stay `ready` for unmanaged local
   mode or become `pending` for managed sandbox mode.

Acceptance:

- Live Neon can migrate without losing runtime rows.
- Store conformance covers sandbox fields.
- `workspace_runtimes` can represent "workspace has a known but stopped sandbox"
  without losing the old id.
- Managed Vercel mode cannot auto-create a `ready` runtime row with a null
  `sandbox_id`.

### Phase 2: Core Sandbox Handle Store

Files:

- `packages/core/src/server/runtime/WorkspaceRuntimeSandboxHandleStore.ts`
- core runtime/store tests
- `apps/full-app/src/server/main.ts`

Tasks:

1. Implement a core-owned, structurally compatible sandbox handle store backed
   by `WorkspaceStore`.
2. Map `SandboxHandleRecord` to `WorkspaceRuntime` sandbox fields.
3. Add tests for `get`, `put`, `list`, and guarded `delete`.
4. Wire full app Vercel mode to pass the core store object into agent
   registration.
5. Keep any `@boring/agent` type annotations in `apps/full-app`, not
   `packages/core`.

Acceptance:

- Creating a Vercel sandbox writes `workspace_runtimes.sandbox_id`.
- Repeating the same workspace access reads the same DB id.
- Standalone agent still uses `FileHandleStore`.

### Phase 3: Request-Scoped Agent Runtime Binding

Files:

- `packages/agent/src/server/registerAgentRoutes.ts`
- `packages/agent/src/server/http/routes/*`
- `packages/agent/src/server/runtime/modes/vercel-sandbox.ts`
- route tests under `packages/agent/src/server/**/__tests__`

Tasks:

1. Add request workspace id resolver option.
2. Replace boot-time runtime bundle with per-workspace resolution in embedded
   mode.
3. Keep standalone route registration simple and backward compatible.
4. Ensure chat harness/session state is workspace-scoped.
5. Ensure file/tree/search calls resolve the request workspace bundle.

Acceptance:

- Two different `x-boring-workspace-id` values use different runtime bundles.
- Repeating the same id reuses the same bundle.
- Tests prove route handlers do not use `"default"` in embedded full-app mode.

### Phase 4: Vercel Replacement Policy And Timeout

Files:

- `packages/agent/src/server/sandbox/vercel-sandbox/resolveSandboxHandle.ts`
- `packages/agent/src/server/runtime/modes/vercel-sandbox.ts`
- Vercel mode tests

Tasks:

1. Add missing/terminal sandbox policies.
2. Use `terminalSandboxPolicy: "error"` in embedded full-app mode.
3. Add stable error type/code for terminal sandbox access.
4. Pass explicit timeout on sandbox creation.
5. Extend timeout on active use if SDK supports it.

Acceptance:

- A persisted sandbox returning 410 does not create a new sandbox in embedded
  mode.
- The old `sandbox_id` remains in DB.
- Runtime row becomes `error` with `last_error_op = "sandbox_access"`.
- Explicit reset/provision path can create a new sandbox and write the new id.

### Phase 5: Frontend Workspace Scoping

Files:

- `apps/full-app/src/front/main.tsx`
- `packages/workspace/src/data/DataProvider.tsx`
- `packages/workspace/src/data/hooks.ts`
- `packages/workspace/src/data/fetchClient.ts`
- `packages/workspace/src/data/useFileEventStream.ts`
- `packages/agent/src/front/ChatPanel.tsx`
- chat hook/transport files

Tasks:

1. Pass selected workspace id into data and chat request context.
2. Add workspace id to query keys.
3. Scope SSE streams with `?workspaceId=<id>` and server membership validation.
4. Add tests that file and chat requests include the workspace context.

Acceptance:

- Switching workspace changes file/tree/chat request scope.
- Switching back reuses the previous workspace sandbox id.
- No stale file tree from another workspace appears after switching.

### Phase 6: Runtime Settings And Reset UX

Files:

- `packages/core/src/server/routes/settings.ts`
- `packages/core/src/front/workspace/WorkspaceSettingsPage.tsx`
- related tests

Tasks:

1. Show sandbox metadata on the runtime card.
2. Add explicit sandbox reset route.
3. Gate reset by role.
4. Add UI confirmation.
5. Add tests for retry vs reset semantics.

Acceptance:

- Runtime settings shows sandbox id and provider state.
- Terminal sandbox shows a clear error and explicit reset action.
- `retry` cannot silently replace a terminal sandbox.

## Test Plan

Unit tests:

- `PostgresWorkspaceStore` persists sandbox fields.
- `LocalWorkspaceStore` persists sandbox fields.
- `WorkspaceRuntimeSandboxHandleStore` maps records to runtime rows correctly.
- `resolveSandboxHandle()` does not recreate on 410/stopped when terminal policy
  is `error`.
- `resolveSandboxHandle()` still recreates for standalone default policy.
- `registerAgentRoutes()` resolves runtime per request workspace id.
- Chat transport sends workspace id.
- File client sends workspace id.

Integration tests:

- Full app route auth rejects a workspace id the user is not a member of.
- Create workspace -> provision sandbox -> DB row has `sandbox_id`.
- Request tree -> uses workspace's sandbox id.
- Create second workspace -> DB row has a different `sandbox_id`.
- Switch back to first workspace -> same first `sandbox_id` is reused.
- Simulate provider 410 -> runtime row stays bound to old `sandbox_id`, state
  becomes `error`, and no create call is made.

Manual live smoke:

1. Start full app in Vercel sandbox mode.
2. Sign in as dev user.
3. Create workspace A.
4. Open file tree; verify `workspace_runtimes.sandbox_id` is populated.
5. Create workspace B.
6. Verify workspace B has a different `sandbox_id`.
7. Switch back to workspace A.
8. Verify the file tree uses workspace A's original `sandbox_id`.
9. Stop or let sandbox A expire.
10. Open workspace A; verify the UI shows terminal runtime error and does not
    create a new sandbox until reset is clicked.

Quality gates:

- `pnpm --filter @boring/core lint`
- `pnpm --filter @boring/core typecheck`
- `pnpm --filter @boring/core test`
- `pnpm --filter @boring/agent lint`
- `pnpm --filter @boring/agent typecheck`
- `pnpm --filter @boring/agent test`
- focused full-app smoke/e2e where available

## Risks And Decisions

### Vercel Sandboxes Are Not Durable Forever

The product invariant cannot mean "the exact provider microVM lives forever."
If Vercel reports `stopped`, `failed`, `aborted`, 404, or 410 and there is no
resume API, the app cannot keep using that sandbox. The invariant means:

- the app persists the exact sandbox id for the workspace
- the app never silently swaps it
- the app surfaces terminal state clearly
- only an explicit reset creates a replacement id

### Runtime Auto-Create Semantics Need Care

Current stores auto-create a `ready` runtime row on read. That can hide missing
provisioning. The implementation should either:

- make auto-created rows `pending` for managed runtime mode, or
- keep auto-create only for local/unmanaged mode and add explicit managed
  provision calls for Vercel.

Do not let a Vercel workspace without `sandbox_id` appear ready.

### Header Scoping Is Not Enough For SSE

Headers work for normal fetch requests. Native `EventSource` does not support
custom headers, so SSE endpoints use `?workspaceId=<id>` plus server membership
validation. A fetch-based SSE transport is not part of this plan unless token
security or browser behavior makes URL scoping insufficient.

### Runtime Bundle Cache Is Per-Process

The in-memory runtime bundle cache is scoped to one server process. In a
multi-replica deployment, two replicas can hold independent bundles for the same
workspace. The DB-backed sandbox handle store prevents double-creation of a
current `sandbox_id`, but timeout tracking and in-flight creation dedupe are not
shared across replicas.

This plan assumes the full app is single-process/single-replica for this phase.
Do not scale the full app horizontally without revisiting the runtime cache
strategy.

### Agent Must Stay Core-Free

All core integration must happen through injected interfaces. This preserves the
published package boundary:

`apps/* -> @boring/agent` and `apps/* -> @boring/core`, but no
`@boring/agent -> @boring/core`.

## Open Questions For Review

1. Should `sandbox_provider` and `sandbox_status` be constrained enums in SQL or
   loose text to avoid churn as providers change?
2. Should old sandbox ids be stored only on the current runtime row, or should we
   add a separate runtime history table now?
3. Should reset be owner-only, or should editors be allowed to reset a broken
   dev sandbox?
4. Should `getWorkspaceRuntime()` stop auto-creating rows entirely and move row
   creation to workspace creation/provisioning only?
5. Should embedded agent routing use a header, a workspace-scoped route prefix,
   or both for workspace id propagation?
6. Should `sandbox_expires_at` ever be trusted as authoritative, or should the
   UI label it explicitly as an estimate unless the provider returns a real
   expiry timestamp?

## Definition Of Done

- `workspace_runtimes.sandbox_id` exists and is populated for Vercel workspaces.
- Every agent/workspace API request resolves the selected core workspace id.
- One workspace maps to one current sandbox binding in DB.
- Workspace switching changes the sandbox binding; switching back reuses the
  previous binding.
- Terminal provider states do not silently create a new sandbox.
- Runtime settings displays sandbox id/status and offers explicit reset only
  when appropriate.
- Standalone `@boring/agent` behavior remains backward compatible.
- Relevant core, agent, workspace, and full-app tests pass.
