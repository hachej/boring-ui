# A1 — External Token Auth TODO

### A1-001 — Add Workspace API Token Storage — M

- **Goal:** Store workspace API tokens as one-workspace, hashed secrets.
- **Files to touch/create:**
  - `packages/core/src/server/db/schema.ts`
  - `packages/core/drizzle/0015_workspace_api_tokens.sql`
  - `packages/core/src/server/workspaceApiTokens.ts`
  - `packages/core/src/server/__tests__/workspaceApiTokens.test.ts`
- **Steps:**
  1. Add a `workspace_api_tokens` table with `id`, `workspaceId`, `name`, `secretHash`, `createdByUserId`, `createdAt`, `lastUsedAt`, `expiresAt`, and `revokedAt`.
  2. Add indexes for `id`, `workspaceId`, and active token lookup.
  3. Implement token generation as `bu_wst_<id>_<secret>` where `secret` is at least 32 random bytes encoded base64url.
  4. Hash only the secret portion with SHA-256 before storage.
  5. Verify candidate hashes with `timingSafeEqual` only after digest lengths match.
  6. Implement helpers: `createWorkspaceApiToken`, `listWorkspaceApiTokens`, `revokeWorkspaceApiToken`, `verifyWorkspaceApiToken`.
  7. Ensure list helpers never return `secretHash` or raw token material.
- **VERIFICATION:**
  - `pnpm --filter @hachej/boring-core run test -- workspaceApiTokens` — exits 0; create/list/revoke/verify tests pass.
  - `pnpm --filter @hachej/boring-core run typecheck` — exits 0.
- **Acceptance criteria:**
  - Raw token is available only from create.
  - Raw secret entropy is at least 32 random bytes before base64url encoding.
  - Wrong secret, wrong token id, revoked token, and expired token all fail verification.
  - A valid token returns exactly `{workspaceId, tokenId, createdByUserId}` plus safe audit metadata.
- **Estimated size:** M.

### A1-002 — Wire Bearer Auth Into `authHook` — M

- **Goal:** Accept bearer tokens for approved workspace `/api/v1` routes without weakening browser auth.
- **Files to touch/create:**
  - `packages/core/src/server/auth/authHook.ts`
  - `packages/core/src/server/app/types.ts`
  - `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`
  - `packages/core/src/server/security/rateLimit.ts`
  - `packages/core/src/server/auth/__tests__/authHook.test.ts`
  - `packages/core/src/app/server/__tests__/createCoreWorkspaceAgentServer.externalWorkspaceAuth.test.ts`
  - `packages/agent/src/server/registerAgentRoutes.ts`
  - `packages/agent/src/server/__tests__/registerAgentRoutes.test.ts`
- **Steps:**
  1. Keep the existing Better Auth session path first.
  2. Add a bearer-token path only when the request has `Authorization: Bearer ...`.
  3. Resolve workspace id from `x-boring-workspace-id` first, then `workspaceId` query.
  4. Verify the token through the A1-001 helper.
  5. Attach a typed verified-token principal to the request; do not set token auth as a browser `request.user`.
  6. Treat a verified token principal as authenticated for protected API routing while keeping browser `request.user` reserved for Better Auth users.
  7. Skip the browser email-verification check for verified token principals; apply it only to Better Auth users.
  8. Update workspace resolution so browser users use `WorkspaceStore.isMember`, while token principals authorize only their exact `workspaceId`.
  9. Reject token auth for workspace admin/member/invite/settings/token CRUD routes.
  10. Update the agent route bridge so verified token requests set `workspaceContext.authenticated` to true; `registerAgentRoutes` currently derives it from `!!user`.
  11. Rate-limit failed bearer-token verification.
  12. Return the existing stable auth error shape for missing, invalid, revoked, expired, and wrong-workspace tokens.
- **VERIFICATION:**
  - `pnpm --filter @hachej/boring-core run test -- authHook createCoreWorkspaceAgentServer.externalWorkspaceAuth` — exits 0; bearer auth, cookie auth, and resolver tests pass.
  - `pnpm --filter @hachej/boring-core run typecheck` — exits 0.
- **Acceptance criteria:**
  - Better Auth behavior is unchanged.
  - Bearer token auth works only when workspace id matches the token scope.
  - Token principals never rely on `WorkspaceStore.isMember`.
  - Agent routes see `workspaceContext.authenticated: true` for verified token requests.
  - Email verification remains a browser-user check and is not applied to verified token principals.
  - Failed bearer verification is rate-limited.
  - Token auth cannot reach token CRUD or workspace admin/member routes.
  - No test snapshot or log contains the raw bearer token.
- **Estimated size:** M.

### A1-003 — Add Owner-Only Token CRUD Routes — M

- **Goal:** Let workspace owners create, list, and revoke workspace API tokens.
- **Files to touch/create:**
  - `packages/core/src/server/routes/workspaceApiTokens.ts`
  - `packages/core/src/server/routes/index.ts`
  - `packages/core/src/server/routes/__tests__/workspaceApiTokens.test.ts`
  - `packages/core/src/server/routes/__schemas__/workspaceApiTokens.ts`
  - `packages/core/src/server/security/rateLimit.ts`
- **Steps:**
  1. Add `GET /api/v1/workspaces/:workspaceId/api-tokens`.
  2. Add `POST /api/v1/workspaces/:workspaceId/api-tokens` with body `{name, expiresAt?}`.
  3. Add `DELETE /api/v1/workspaces/:workspaceId/api-tokens/:tokenId`.
  4. Guard every route with existing workspace owner membership checks.
  5. Return raw token only from `POST`, exactly once.
  6. Return token list rows without `secretHash` or raw token.
  7. Apply existing rate-limit plumbing to token CRUD.
  8. Add OpenAPI/schema coverage matching the route style in core.
- **VERIFICATION:**
  - `pnpm --filter @hachej/boring-core run test -- workspaceApiTokens` — exits 0; owner/non-owner/create/list/revoke cases pass.
  - `pnpm --filter @hachej/boring-core run typecheck` — exits 0.
- **Acceptance criteria:**
  - Owners can create, list, and revoke tokens for their workspace.
  - Members without owner role cannot create or revoke tokens.
  - Bearer-token principals cannot call token CRUD.
  - Token CRUD is rate-limited.
  - Revoked tokens immediately fail A1-002 bearer auth.
- **Estimated size:** M.

### A1-004 — Prove External Workspace Route Access — M

- **Goal:** Add integration tests that mirror the connector's boring-ui calls.
- **Files to touch/create:**
  - `packages/core/src/app/server/__tests__/createCoreWorkspaceAgentServer.externalWorkspaceAuth.test.ts`
  - `packages/agent/src/server/registerAgentRoutes.ts`
  - `packages/agent/src/server/__tests__/registerAgentRoutes.test.ts`
  - `docs/issues/526/office-agent-surface/work/A1-external-token-auth/HANDOFF.md`
- **Steps:**
  1. Add a test fixture workspace, user, and workspace API token.
  2. Call `GET /api/v1/tree` with `Authorization: Bearer ...` and `x-boring-workspace-id`.
  3. Call one text read route and one write route through the same token.
  4. Repeat each call with missing workspace id, wrong workspace id, revoked token, and no token.
  5. Add a browser-session control proving normal membership checks still apply.
  6. Assert route failures do not include the bearer token.
  7. Update the handoff if route allowlist details change during implementation.
- **VERIFICATION:**
  - `pnpm --filter @hachej/boring-core run test -- createCoreWorkspaceAgentServer.externalWorkspaceAuth` — exits 0; external auth route tests pass.
  - `pnpm --filter @hachej/boring-agent run test -- registerAgentRoutes` — exits 0; agent route auth expectations pass.
  - `pnpm lint:invariants` — exits 0.
- **Acceptance criteria:**
  - Workspace token can access the same file/agent routes needed by the A2 connector.
  - Wrong-scope token cannot access another workspace.
  - Browser sessions still require workspace membership.
  - Admin/token routes remain browser-session only.
  - No raw bearer token appears in assertions, snapshots, or logs.
- **Estimated size:** M.

### A1-005 — Document CORS and Taskpane Origin Setup — S

- **Goal:** Make taskpane-origin setup explicit without adding a second CORS system.
- **Files to touch/create:**
  - `docs/issues/526/office-agent-surface/work/A1-external-token-auth/HANDOFF.md`
  - `packages/core/src/server/config/__tests__/loadConfig.test.ts`
  - `packages/core/src/server/auth/__tests__/createAuth.test.ts`
- **Steps:**
  1. Add or update tests proving `CORS_ORIGINS` accepts the taskpane HTTPS origin.
  2. Assert Better Auth trusted origins use the same configured origin list.
  3. Document the required production value, for example `CORS_ORIGINS=https://office-agent.example.com`.
  4. Do not hard-code the production taskpane host in source.
- **VERIFICATION:**
  - `pnpm --filter @hachej/boring-core run test -- loadConfig createAuth` — exits 0; CORS/trusted-origin tests pass.
  - `pnpm --filter @hachej/boring-core run typecheck` — exits 0.
- **Acceptance criteria:**
  - Taskpane origin configuration is environment-driven.
  - Existing browser CORS behavior remains unchanged.
  - No source file embeds company-specific hostnames.
- **Estimated size:** S.
