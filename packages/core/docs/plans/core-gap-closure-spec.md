# @boring/core — Gap Closure Spec

**Status:** v7 — final review patches applied, **steady-state, ready to ship**, decisions locked 2026-04-28
**Path:** `boring-ui-v2/packages/core/`

> **v7 changelog (vs v6)** — final review pass, both reviewers said "ship after these"
> - **Delete-failure semantics unified.** v6 had four contradictory passages about what happens when destroy fails. Single rule now: `/runtime/retry` is provision-only; destroy-retry is just re-issuing DELETE. Runtime row carries `last_error_op: 'provision' | 'destroy'` to disambiguate the retry-route's precondition. Workflow throws 500 on destroy failure and updates the runtime row before re-throwing.
> - **No-provisioner-mode UX gated.** `WorkspaceSettingsPage` runtime card renders only when a runtime row exists. Apps without a provisioner see name + danger zone only.
> - **Idempotency-table memory leak fixed.** Without a worker, `24h TTL` was a phantom. Now: the invite-create middleware runs `DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'` inline before each insert.
> - **Context section nit**: removed the `machine_id/volume_id/fly_region` mention in the workspace-data-model summary — those columns are dropped in v6's migration.
> - **Retry route precondition added**: must assert `state = 'error' AND last_error_op = 'provision'`, else 409 `INVALID_RETRY_STATE`.

> **v6 changelog (vs v5)** — radical scope cut, ship-the-minimum
> - **Provisioner = synchronous filesystem driver in v1.** SPI shape preserved for future drivers (Fly, Vercel Sandbox, Docker) but the only concrete implementation is `createFsProvisioner({ rootDir })` doing `mkdir`/`rm`. Combined with agent's existing `BwrapSandbox` (per-command isolation), this gives workspace-dir isolation on any Linux PaaS with bubblewrap.
> - **No worker, no async state machine.** Provision/destroy are synchronous. Runtime state collapses to `pending → ready/error`. Drops `provisioning`, `destroying`, `destroyed` states; the worker process; `LISTEN/NOTIFY`; the saga; the reconciler; all fencing columns (`provision_operation_id`, `destroy_operation_id`, `lease_expires_at`, `version`, `worker_id`, `deletion_requested_*`); the `managed/unmanaged` mode split; the volume-retention model.
> - **Email change deferred** to a later release. v1 ships read-only email in `UserSettingsPage`.
> - **Social auth (Google + GitHub) deferred** to a later release. v1 is email/password only. Drops `socialProviders`, link intent endpoint, nonce/step-up, Connected-accounts UI, capability flags.
> - **Multi-user features kept as v5 had them**: `MembersPage`, `InvitesPage`, `/invites/:token` page, role/member endpoints, last-owner FOR UPDATE invariant, invite resolve+accept with rate limits.
> - Future drivers will reintroduce the async machinery (state machine, saga, fencing, reconciler) — but only when there's a concrete consumer that needs it.

> v1–v5 changelogs preserved in git history.

---

## Context

`packages/core/` already ships:

- **Auth** (better-auth + drizzle): email/password with zxcvbn strength check, email verification, password reset, magic link, post-signup hook (auto-create default workspace + welcome email), `requireWorkspaceMember` guard, `deleteUserCompletely`, app-scoped cookie prefix.
- **Email** transport (`resend://`, `smtp://`, `console://`, `console-capture://`); templates for verify, reset, magic link, welcome, workspace invite.
- **Workspace data model**: `workspaces`, `workspace_members` (owner/editor/viewer), `workspace_invites` (sha256 hash, 7d TTL), `workspace_settings` (encrypted bytea), `workspace_runtimes` (state machine). *(Pre-existing `machine_id/volume_id/fly_region` columns are dropped in v6's migration — Fly was deferred.)*
- **REST routes**: full CRUD for workspaces, members, invites, settings; runtime get + retry; `/api/v1/me`; `/api/v1/config`; `/health`.
- **Stores**: `Postgres*` and `Local*` for User and Workspace, with shared conformance test suite.
- **App scaffolding**: Fastify with cors, helmet+CSP nonces, request-id, redacting logger, rate limiter, error handler, capabilities cache, graceful shutdown.
- **Frontend**: `BoringApp` orchestrator; auth pages; `WorkspaceSwitcher`, `UserMenu`, `ThemeToggle`; capability and member hooks.

The agent package is single-workspace per instance. Agent's "Local" execution mode = `NodeWorkspace` (workspace = a path on disk) + `BwrapSandbox` (bash isolated to that path). Core's filesystem provisioner creates the path the agent expects.

## Goal

`core` becomes the platform layer for v1: auth + workspace management (multi-user) + filesystem-level workspace provisioning. Future-proofed for Fly/Vercel/Docker drivers via the SPI shape, but ships with only the FS driver.

## Non-goals (v1)

- Async provisioner drivers (Fly, Vercel Sandbox, Docker) — SPI shape supports them, no concrete impl in v1.
- Email change (read-only in v1).
- Social auth / SSO (email/password only in v1).
- Account linking, OAuth link intent, step-up reauth.
- Organization/team layer above workspace.
- 2FA / TOTP / passkeys / active-session list.
- Persistent audit-log table.
- Per-invite TTL.
- Workspace duplication / fork.
- Workspace data export.
- Backward-compat with pre-v6 shapes (no in-flight users).

---

## Decisions locked

| # | Topic | Decision |
|---|---|---|
| 1 | Workspace UI | Ship `WorkspaceSettingsPage`, `MembersPage`, `InvitesPage` in core; export command-palette **builders** for apps to register. |
| 2 | Invite-accept UX | `POST /api/v1/invites/resolve` (token-only preview) + `POST /api/v1/invites/accept` (token-only). No legacy URL-id route. |
| 3 | Provisioner shape | Pluggable `WorkspaceProvisioner` interface (synchronous-friendly: returns Promise but expected to resolve fast); ship **`createFsProvisioner({ rootDir })`** as the only concrete driver in v1. Apps that don't pass a `provisioner` to `createCoreApp` skip provisioning entirely (workspace is just a DB row). |
| 4 | Runtime states | `pending | ready | error`. No async states (no `provisioning`, `destroying`, `destroyed`). Provision/destroy run inline in the route handler. |
| 5 | Idempotency | API `Idempotency-Key` header on `POST /invites` only (the only route where retry causes a real side effect — duplicate invite emails). |
| 6 | Ownership transfer | `PATCH .../role` AND `DELETE .../members/:userId` + UI. Last-owner invariant enforced via `SELECT ... FOR UPDATE` on `workspace_members` rows in transaction for **both** mutations. |
| 7 | Workspace context | React Query (`['workspaces']`, `['workspace', id]`). No `refetchInterval` — states resolve synchronously, never sit on transient. |
| 8 | Invite TTL | `features.inviteTtlDays` global (default 7). DB default dropped; computed in store layer. |
| 9 | UserMenu ownership | `BoringApp` provides `<UserMenu />` via `TopBarSlot` React context. Workspace's `ChatTopBar` consumes via `useContext`. `onAvatarClick` / `userInitial` props removed outright. |
| 10 | Rate limits | `/invites/resolve`: 60 req/min/IP (NAT-friendly). `/invites/accept`: 10 req/min per IP+userId. Per-token `failed_attempts`/`locked_until` columns on `workspace_invites` as a secondary circuit breaker (lock token at 50 fails). |
| 11 | Settings encryption | Audit current impl. **Single-key encryption**; document rotation procedure as a planned-outage ops task. Force AES-256-GCM only if compliance demands. |
| 12 | Volume cleanup | Always destroy on workspace delete (sync `rm -rf` for FS driver). |

---

## Architecture additions

### Provisioner interface

```ts
// src/server/provisioner/types.ts
export interface WorkspaceProvisioner {
  /** Called when a workspace is created. May throw to signal provision failure. */
  provision(ctx: ProvisionContext): Promise<ProvisionResult>
  /** Called when a workspace is deleted. Idempotent on workspaceId. */
  destroy(workspaceId: string): Promise<void>
}

export interface ProvisionContext {
  workspaceId: string
  workspaceName: string
  ownerId: string
  appId: string
}

export interface ProvisionResult {
  /** For FS driver: absolute path to the workspace directory.
   *  Future drivers may add machineId, volumeId, region, etc. as the result type evolves. */
  volumePath: string
}
```

### Filesystem driver

```ts
// src/server/provisioner/fsProvisioner.ts
export function createFsProvisioner(opts: { rootDir: string }): WorkspaceProvisioner {
  const root = path.resolve(opts.rootDir)

  return {
    async provision(ctx) {
      const dir = path.join(root, ctx.workspaceId)
      await fs.mkdir(dir, { recursive: true, mode: 0o700 })
      return { volumePath: dir }
    },
    async destroy(workspaceId) {
      const dir = path.join(root, workspaceId)
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}
```

~30 LOC including the type defs. That's the entire provisioner story in v1.

### Runtime states

```
(no provisioner)  → workspace inserted, no runtime row
(provisioner)     → on create:  pending → call provisioner.provision() → ready (or error)
                    on delete:  ready/error → call provisioner.destroy() → row removed
                    on provision failure: state = error, last_error set
                                          → admin retries via POST /runtime/retry
                    on destroy failure:   state = error, last_error set, row NOT removed, HTTP 500
                                          → admin retries by re-issuing DELETE
```

**Single rule**: `/runtime/retry` is **provision-retry only**. Destroy-retry is just re-issuing `DELETE /workspaces/:id` until it succeeds.

No async transitions. No worker. No saga.

### Workflow — workspace create

```ts
// inside POST /api/v1/workspaces handler
const workspace = await store.create(...)            // DB row
if (provisioner) {
  await store.putWorkspaceRuntime(workspace.id, { state: 'pending' })
  try {
    const result = await provisioner.provision({ workspaceId: workspace.id, ... })
    await store.putWorkspaceRuntime(workspace.id, {
      state: 'ready',
      volumePath: result.volumePath,
    })
  } catch (err) {
    await store.putWorkspaceRuntime(workspace.id, {
      state: 'error',
      lastError: String(err),
    })
    throw new HttpError({ status: 500, code: 'PROVISION_FAILED', ... })
  }
}
return { workspace }
```

### Workflow — workspace delete

```ts
// inside DELETE /api/v1/workspaces/:id handler
if (provisioner) {
  try {
    await provisioner.destroy(workspace.id)  // sync rm -rf for FS
  } catch (err) {
    await store.putWorkspaceRuntime(workspace.id, {
      state: 'error',
      lastError: String(err),
    })
    throw new HttpError({
      status: 500,
      code: 'DESTROY_FAILED',
      message: String(err),
    })
  }
}
await store.delete(workspace.id)           // DB row + runtime row gone
return { deleted: true }
```

If `provisioner.destroy` throws, the workspace is **not** deleted, the runtime row is updated to `error` with `last_error`, and the request returns 500. The admin retries by **re-issuing the same DELETE** (FS driver's `rm -rf … --force` is idempotent). `/runtime/retry` is **not** used for destroy failures — it's provision-only.

### Retry route

`POST /api/v1/workspaces/:id/runtime/retry`:
- No body. **Provision-retry only** — destroy retries are just "re-issue DELETE."
- **Precondition**: runtime state must be `error` AND the last failed operation was a provision (not a destroy). Otherwise 409 `INVALID_RETRY_STATE`. To distinguish, the runtime row carries `last_error_op: 'provision' | 'destroy'`; the retry route only proceeds when `last_error_op = 'provision'`.
- Calls `provisioner.provision()` again with the same `workspaceId`. FS driver's `mkdir -p` is idempotent.
- On success: `error → ready`, `last_error` cleared. On failure: stays `error` with new `last_error`.

### Schema migration `0007_*.sql`

Tiny.

```sql
-- States
ALTER TABLE workspace_runtimes
  DROP CONSTRAINT workspace_runtimes_state_check,
  ADD CONSTRAINT workspace_runtimes_state_check
    CHECK (state IN ('pending','ready','error'));

-- Filesystem driver result column + provision/destroy disambiguation
ALTER TABLE workspace_runtimes
  ADD COLUMN volume_path   text,
  ADD COLUMN last_error_op text;  -- 'provision' | 'destroy'; null when state ≠ 'error'

-- Invite rate-limit secondary
ALTER TABLE workspace_invites
  ADD COLUMN failed_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN locked_until    timestamptz;

-- Invite TTL: drop SQL default (compute in store layer)
ALTER TABLE workspace_invites
  ALTER COLUMN expires_at DROP DEFAULT;

-- Drop machine/volume/region columns from workspaces (Fly-specific, not v1)
ALTER TABLE workspaces
  DROP COLUMN machine_id,
  DROP COLUMN volume_id,
  DROP COLUMN fly_region;
```

(Last block depends on whether those columns have data; if existing migrations populated them, leave them and ignore in code. Cleaner is to drop them.)

### Provisioning lock semantics

Provisioning is synchronous, so the lock window is whatever the route handler takes (milliseconds for FS, seconds for future Fly). For FS driver, no lock matters.

| State | Member mutation | DELETE workspace |
|---|---|---|
| `pending` | ✅ (window is ~ms) | ✅ |
| `ready` | ✅ | ✅ |
| `error` | ✅ | ✅ (attempt destroy; on failure 500 + keep row for retry; on success row removed) |

No 202s. No saga. No async.

### Ownership invariant — role change AND member removal

Both routes share the same transactional invariant:

- `PATCH /api/v1/workspaces/:id/members/:userId/role`: body `{ role: 'owner' | 'editor' | 'viewer' }`.
- `DELETE /api/v1/workspaces/:id/members/:userId`.

Both use:
```sql
BEGIN;
SELECT * FROM workspace_members
  WHERE workspace_id = $id
  FOR UPDATE;
-- count owners after the proposed mutation
-- if zero → ROLLBACK with 409 LAST_OWNER
{UPDATE workspace_members SET role = ... | DELETE FROM workspace_members WHERE ...};
COMMIT;
```

`requireWorkspaceMember('owner')` guard applies to PATCH; DELETE allows self-removal even by non-owners.

### Invite resolve + accept

- `POST /api/v1/invites/resolve`: body `{ token }`. Looks up by sha256 hash. Returns `{ workspaceName, role, expiresAt }` or 404. **Constant-time** response on miss.
- `POST /api/v1/invites/accept`: body `{ token }`. Auth required. Resolves, accepts, returns `{ workspace, member }`.
- **Rate limits**:
  - `/invites/resolve`: 60 req/min/IP — NAT-friendly.
  - `/invites/accept`: 10 req/min per IP+userId.
  - **Secondary** circuit breaker: per-token-hash `failed_attempts` increments on miss/expired/wrong-user; `locked_until = now() + 1h` once `failed_attempts >= 50`. Reset on successful accept.

### Invite create

`POST /api/v1/invites`: supports `Idempotency-Key` request header. Server stores `(idempotency_key, response)` in a bounded `idempotency_keys` table with 24h retention.

**No background worker in v1**, so retention is enforced **inline** by the middleware:

```sql
DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours';
```

This runs once per invite-create call (rare-enough route that the scan is cheap; the `created_at` index keeps it ms-fast). When we eventually ship a worker (for async provisioner drivers), the inline sweep becomes a periodic job.

Subsequent calls with the same `Idempotency-Key` return the cached response. Prevents duplicate invite emails on client retry.

### Invite TTL

`features.inviteTtlDays: number` (default 7). Schema drops the SQL default. `PostgresWorkspaceStore.createInvite` (and `LocalWorkspaceStore`) compute `expiresAt = now() + ttlDays * 1d` from config.

### React Query refactor

```ts
const detailQuery = useQuery({
  queryKey: ['workspace', resolvedId],
  queryFn: () => fetchWorkspace(resolvedId),
  enabled: !!resolvedId,
})
```

No `refetchInterval` — states resolve synchronously, never sit on transient values.

Mutations on `WorkspaceSwitcher` and Members/Invites pages invalidate `['workspaces']` and `['workspace', id]`.

### Workspace UI pages

`src/front/workspace/`:
- `WorkspaceSettingsPage.tsx` — name edit, danger zone (delete). Runtime card (status + retry button) renders **only when the workspace has a runtime row**; in no-provisioner mode the card is omitted entirely.
- `MembersPage.tsx` — list, role dropdown, remove, transfer ownership.
- `InvitesPage.tsx` — list pending, create (with `Idempotency-Key`), revoke.

Mounted at `/w/:id/{settings,members,invites}` in `BoringApp`.

Command palette: core exports `getWorkspaceCommands(workspaceId, navigate)` returning `Command[]`. Apps register with their palette. **No core → workspace dep.**

### Invite-accept page

`/invites/:token`:
1. Signed out → `/auth/signin?next=/invites/:token`.
2. Authed → `POST /invites/resolve` for preview.
3. Render preview + Accept/Decline.
4. Accept → `POST /invites/accept` → navigate `/w/:id`.
5. Errors (expired, revoked, locked, wrong-account) render with actionable messaging.

### UserMenu via TopBarSlot bridge

`src/front/components/TopBarSlot.tsx`:

```ts
const TopBarSlotContext = createContext<ReactNode | null>(null)
export function TopBarSlotProvider({ children, slot }) { ... }
export function useTopBarSlot(): ReactNode | null { return useContext(TopBarSlotContext) }
```

`BoringApp` wraps children in `<TopBarSlotProvider slot={<UserMenu />}>`. Workspace's `ChatTopBar` (one-line change in workspace package): `const slot = useTopBarSlot(); const right = topBarRight ?? slot ?? null`.

`onAvatarClick` and `userInitial` props removed outright.

### Settings encryption — single key

- Config: `encryption.workspaceSettingsKey: Base64Key`.
- Encrypt: AES-256-GCM (or whatever audit reveals as canonical) with per-row nonce.
- **Rotation procedure** (documented as a planned-outage ops task, not automated in v1):
  1. Set the app to read-only mode (block writes via feature flag).
  2. Run a rotation script: SELECT all rows; decrypt with old key; re-encrypt with new key; UPDATE.
  3. Swap the config key.
  4. Unblock writes.

---

## Migration / DB changes

| File | Change |
|---|---|
| `0007_*.sql` | Narrow state check (`pending|ready|error`); add `volume_path` to `workspace_runtimes`; add `failed_attempts`/`locked_until` to `workspace_invites`; drop `expires_at` SQL default; drop `machine_id`/`volume_id`/`fly_region` from `workspaces` (or leave + ignore). |
| `src/server/db/schema.ts` | Reflect all of the above. New table `idempotency_keys` for invite-create middleware. |
| `src/server/config/schema.ts` | Add `features.inviteTtlDays`; `provisioner` is configured at `createCoreApp` call site (not via env config). |

No destructive migrations.

---

## Test plan

- **Provisioner conformance** (driver-agnostic): `provision` returns expected fields; `destroy` is idempotent on missing/already-deleted workspace.
- **Filesystem driver**: `provision` creates dir with `0o700` mode; `destroy` removes dir recursively; `destroy` on non-existent dir succeeds; provision-then-provision (retry) is idempotent (mkdir-recursive).
- **No-provisioner mode**: `createCoreApp` without provisioner → workspaces have no runtime row; `WorkspaceSettingsPage` omits the runtime card; DELETE just removes the workspace row.
- **Provision failure**: FS driver throws (e.g. permission denied) → workspace ends in `error` state with `last_error_op = 'provision'`; `POST /runtime/retry` re-attempts; cross-target retry (state in `error` with `last_error_op = 'destroy'`) → 409 `INVALID_RETRY_STATE`.
- **Destroy failure**: FS driver throws on `rm -rf` → 500 `DESTROY_FAILED`, runtime row updated to `error` with `last_error_op = 'destroy'`, workspace row NOT deleted; re-issuing DELETE succeeds once the underlying issue is fixed.
- **Idempotency cleanup**: invite-create middleware deletes rows older than 24h on each call; verify table size stays bounded under load.
- **Concurrency**: two simultaneous `PATCH role=editor` on the last owner → exactly one succeeds. **Cross-mutation race**: `PATCH demote-A` + `DELETE remove-self-B` (both owners) → exactly one succeeds via shared `FOR UPDATE`.
- **Invite endpoints**: resolve constant-time on miss; resolve allows 60 req/min/IP; accept allows 10 req/min per IP+userId; per-token secondary breaker at 50 fails; `Idempotency-Key` deduplication on create.
- **Settings encryption**: round-trip; at-rest (raw bytea ≠ plaintext); rotation script (lock → re-encrypt → swap → unlock) tested in CI.

---

## Rollout / phasing

### Phase 1 — Hygiene + audit (low risk)

- Settings encryption audit + rotation procedure docs.
- React Query refactor of `WorkspaceAuthProvider`.
- Invite TTL → global config (drop DB default; store-layer compute).
- `TopBarSlot` context bridge in `BoringApp`; remove workspace's `onAvatarClick`/`userInitial` props.

### Phase 2 — Provisioner SPI + FS driver

- Migration: narrow state check, add `volume_path`, drop Fly-specific columns, add `idempotency_keys` table, add invite secondary-breaker columns.
- `WorkspaceProvisioner` interface.
- `createFsProvisioner({ rootDir })` driver.
- Wire into `createCoreApp({ provisioner })`.
- Synchronous provision/destroy in workspace routes.
- `POST /runtime/retry` for the `error → ready` path.

### Phase 3 — Workspace management UX

- `MembersPage`, `InvitesPage`, `WorkspaceSettingsPage`.
- `PATCH /members/:userId/role` + `DELETE /members/:userId` (transactional last-owner check via shared `FOR UPDATE`).
- `POST /invites/resolve` + `POST /invites/accept` (token-only).
- `POST /invites` with `Idempotency-Key` middleware.
- `/invites/:token` page in `BoringApp`.
- Command-palette builder exports.

### Future (not v1)

- Email change.
- Social auth (Google/GitHub) + linking.
- Async provisioner drivers (Vercel Sandbox, Fly Machines, Docker) — will reintroduce state machine, fencing, saga, reconciler at that point. Each new driver triggers a re-evaluation of the SPI.

---

## Out-of-scope reminders

- Async provisioner drivers (Fly, Vercel, Docker).
- State machine beyond `pending|ready|error`.
- Worker process, `LISTEN/NOTIFY`, fencing, CAS, leases.
- Delete saga / 202 / status monitor.
- Reconciler.
- Volume retention / undelete.
- Email change.
- Social auth, account linking, OAuth link intent, step-up reauth.
- Organizations / teams.
- 2FA / passkeys / active-session list.
- Persistent audit log.
- Per-invite TTL.
- Workspace duplication / fork / data export.
- Backward-compat shims.

---

## Steady-state declaration

v7 is the build target for v1. Three review rounds + two simplification passes + one final patch round. The async-driver story (Fly / Vercel Sandbox / Docker) is a deliberate future expansion — when the first concrete async driver is needed, we'll reintroduce the worker/saga/reconciler machinery at that time, informed by what that driver actually requires. Shipping FS-only first means the SPI shape gets validated against a real implementation before we lock in the async contract.
