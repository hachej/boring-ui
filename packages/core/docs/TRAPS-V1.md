# Traps from v1 — accepted decisions for v2

Status: **locked decisions from 2026-04-24 trap-scan review.** This doc records bugs and behaviors in v1 that v2 is (a) intentionally fixing, (b) intentionally carrying forward as known issues, or (c) deliberately dropping. No surprises for implementers.

The trap-scan inventory covered `packages/boring-ui` v1. Bug line references point at v1 source, not v2.

## 🔴 Fixed in v2 (M1-M6)

Items the v2 plan fixes on the way in.

### Workspace-route authorization audit (M2 blocker)

**v1 bug**: most `/api/v1/workspaces/:id/**` routes only check `verifySession`, not membership (`packages/workspace/src/server/http/workspaceRoutes.ts:27, 109, 161, 191`). Any authenticated user who guesses a workspace UUID can read/update/delete it.

**v2 fix**: every workspace-scoped handler wears `requireWorkspaceMember(role?)`. Integration test covers every route. M2 ships with an audit; v1 would not compile without this check.

### Email verification + password reset + magic links (M2, M3)

**v1 behavior**: shipped all three (`packages/cloud/src/server/http/authRoutes.ts:964, 999`; `packages/cloud/src/front/pages/AuthPage.jsx:214`).

**v2 action**: keep all three. better-auth enables each with a config flag + mail transport. ~1 day total vs the "non-goal" language in earlier drafts. Dropping would be a user-visible regression at first sign-up.

### Rate limiting / helmet / CSP / graceful shutdown / deep health (M6)

**v1 gap**: none of these exist (`apps/ide/src/server/app.ts:57, 68`; `packages/core/src/server/http/health.ts:32`).

**v2 action**: shipped in a dedicated hardening milestone (M6). `@fastify/rate-limit` on auth routes, helmet + CSP defaults, SIGTERM handler that drains + closes DB pool, `/health` that pings DB.

### PostgresUserStore app_id ignored

**v1 bug**: `PostgresUserStore.ts:16, 33` queries by `user_id` only, not `(user_id, app_id)`. `putSettings` at line 103 is a no-op if no row exists.

**v2 fix**: composite key `(user_id, app_id)` everywhere. `putSettings` is a real upsert. Integration test covers cross-app isolation.

### `pending_login` URL-embedded credentials

**v1 bug**: signup creates a `pending_login` JWE containing email+password and puts it in the email-verification callback query (`packages/cloud/src/server/http/authRoutes.ts:696, 932`). Even encrypted, this hits URL logs.

**v2 action**: dropped entirely. better-auth uses server-side nonce storage for post-verification continuation.

### Session scoping

**v1 bug**: JWT optionally carries `app_id` but middleware ignores it (`packages/core/src/server/auth/session.ts:81`, `middleware.ts:41`). Default cookie is global `boring_session` (`config.ts:344`). Cross-app leakage risk on same domain.

**v2 fix**: better-auth sessions, per-app cookie name (`{appId}_session`), server-side revocation via `sessions` table.

## 🟠 Accepted as known issues — carried from v1 (v1.1 fixes)

Items we are intentionally NOT fixing in v1. They ship with v1 and are scheduled for v1.1. Each is documented here so implementers don't accidentally "fix" them (and the related tests that encode the behavior) under schedule pressure.

### Invite-accept TOCTOU race

**v1 bug**: route-layer validation of `accepted_at`, expiry, and email followed by separate UPDATE statements (`packages/cloud/src/server/services/workspacePersistence.ts:850`). Concurrent accepts can both succeed; expired invites accept under race.

**v2 status**: **carried from v1**. Ship with the same TOCTOU window.

**v1.1 fix plan**: single transaction with conditional `UPDATE workspace_invites ... WHERE accepted_at IS NULL AND expires_at > now() RETURNING`; insert into `workspace_members` in the same tx keyed off the RETURNING row.

**Mitigation for v1**: the window is narrow and requires two legitimate requests to collide; impact is a single extra membership row for a duplicate invite. Not a security hole, just a data-integrity edge.

### Last-owner-removal race

**v1 bug**: remove-member reads owner count then deletes in separate statements (`workspacePersistence.ts:736`; `packages/core/src/server/providers/local/workspaceStore.ts:161`). Two concurrent owner-removes can strand a workspace with zero owners.

**v2 status**: **carried from v1**.

**v1.1 fix plan**: `SELECT ... FOR UPDATE` on owner rows before the DELETE, or transactional CHECK-then-DELETE.

**Mitigation for v1**: requires two concurrent owner-remove requests; an orphan workspace is recoverable manually (admin SQL promotes a member to owner).

### Default-workspace promotion on delete

**v1 bug**: deleting the default workspace doesn't promote another workspace to default (`workspacePersistence.ts:454`); DB has a partial unique index on `(created_by, app_id) WHERE is_default = true` (`schema.ts:67`).

**v2 status**: carried. Users may temporarily have no default workspace.

**v1.1 fix plan**: on soft-delete of a default workspace, promote the oldest sibling (or most-recently-used).

## 🟡 Behavioral quirks documented (not bugs)

### Encrypted workspace_settings contract — metadata-only

**v1 behavior** (`workspacePersistence.ts:647`): generic `getWorkspaceSettings(workspaceId)` returns `Array<{key, configured, updated_at}>`. It does NOT decrypt values. Callers that need actual values call typed accessors (e.g. `getGitHubInstallation`) which decrypt internally.

**v2 status**: **preserved by design.** Safer default — consumers can't accidentally log decrypted secrets; encryption key rotation doesn't break generic endpoints.

**Impact on API.md**: `GET /api/v1/workspaces/:id/settings` returns metadata only. Decrypted values are exposed only through typed agent/integration-specific endpoints that register them with core.

### Workspace soft-delete leaves orphans

**v1 behavior**: `DELETE /api/v1/workspaces/:id` sets `deleted_at` only. Members, invites, settings, runtime rows remain. Backing FS directory remains.

**v2 status**: **preserved as-is.** Cheapest. Orphan rows accumulate; GDPR-unclean. User accepted this as a known limitation.

**Operational guidance**: operators should schedule a manual cleanup job if storage/row counts become a problem, or use direct SQL. No built-in GC in v1.

**v1.x option**: add cascade-delete or scheduled GC job. Not planned.

### Dev auto-login dropped

**v1 behavior**: local mode injects a `dev-local` cookie automatically at app boot (`apps/ide/src/server/app.ts:79`) and the frontend `apiFetch` retries one 401 per page load (`packages/core/src/front/utils/transport.js:14`). "It just works" in dev.

**v2 action**: **both dropped.** Dev uses `LocalUserStore` with a seeded `dev@local` user and signs in through `/auth/signin` like prod. One code path. First-run adds ~10 seconds, removes subtle hidden behavior.

## Contracts preserved from v1

Documented here because they're easy to accidentally break.

### Error envelope

All routes return errors as `{ error: string, code: string, message: string }` (v1 `authRoutes.ts:590`, `collaborationRoutes.ts:14`). v2 preserves this; `@boring/core/shared/ERROR_CODES` enumerates the code values.

### Request ID

Middleware trusts inbound `x-request-id` header if present, else generates a UUID, and echoes in response header (v1 `requestId.ts:15`). v2 preserves verbatim.

### Validation rules

Port from v1:

- Workspace name: 1-100 chars (`workspaceRoutes.ts:54`).
- Settings key: 1-128 chars (`workspaceRoutes.ts:254`).
- Settings value: non-empty string.
- Max 50 settings keys per PUT request.
- Invite email: RFC-5322 permissive regex (`collaborationRoutes.ts:11`).

### Secret redaction

Pino path redaction + a regex pass (v1 `secretRedaction.ts:7`). Full structured scrub is out of scope. Redacted paths: `secret`, `token`, `clientSecret`, `password`, `authorization`, `cookie` (case-insensitive substring).

## Dropped from v2 (intentional)

- `pythonCompat.ts` capability shape + legacy feature aliases.
- Dual GitHub alias routes `/github/*` + `/auth/github/*` (if GitHub App returns in v1.x via agent, single canonical path).
- `controlPlaneProvider: 'local' | 'neon'` config branching (Postgres-only).
- `pending_login` URL-embedded credentials (covered above).
- Dev auto-login + 401 retry (covered above).
