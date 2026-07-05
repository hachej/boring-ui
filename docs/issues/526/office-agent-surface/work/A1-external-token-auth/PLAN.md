# A1 — External Token Auth Plan

## Today / Delta

Today, boring-ui protects `/api/v1/*` through `authHook`. The hook reads a Better Auth session from request headers/cookies, sets `request.user`, and rejects protected API routes when no browser session exists (`packages/core/src/server/auth/authHook.ts:26-60`). Workspace resolution already reads `x-boring-workspace-id` or `workspaceId`, then checks membership through `WorkspaceStore.isMember` (`packages/core/src/app/server/createCoreWorkspaceAgentServer.ts:408-432`).

Delta: add workspace-scoped bearer tokens for external Office surfaces. Tokens are accepted alongside the Better Auth cookie only for approved workspace API paths. Token CRUD remains a logged-in owner surface.

## Deliverables

- Hashed workspace API token storage in core DB.
- Store helpers for create/list/revoke/verify.
- Bearer-token branch in `authHook`.
- Owner-only token CRUD routes scoped to one workspace.
- Tests proving bearer auth works for workspace file/agent routes and does not open admin routes.
- CORS documentation/test coverage for taskpane origins through existing `CORS_ORIGINS`.

## Threat Notes

- Store only a hash of the secret, never the raw token.
- Return the raw token once at create time.
- Scope each token to exactly one workspace.
- Treat tokens as non-admin principals. They can call approved workspace file/agent routes, not workspace membership, invite, settings, or token CRUD routes.
- Do not log bearer token values.
- Do not serialize token values into refs, tool results, fixtures, or error payloads.

## Smallest Robust Change

Use a token shape with a lookup id and secret, for example `bu_wst_<tokenId>_<secret>`. Store `tokenId`, `workspaceId`, `secretHash`, `createdByUserId`, timestamps, optional `expiresAt`, and `revokedAt`.

In `authHook`, try the Better Auth session first. If it is absent and the request is an approved `/api/v1` workspace route with `Authorization: Bearer ...`, verify the token against the workspace id from header/query. Set `request.user` to a token principal with stable internal id and attach token metadata to the request for downstream auditing.

## Exit Criteria

- `Authorization: Bearer <workspace-token>` plus `x-boring-workspace-id` can access workspace file/agent routes.
- The same token is rejected for token CRUD and workspace admin/member routes.
- Revoked or wrong-workspace tokens fail.
- Token list responses never include token secrets.
- Core tests and typecheck pass.

