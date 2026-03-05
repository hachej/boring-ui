# boring-ui Core Ownership Contract (vNext)

Status: implemented (bead `bd-2ptn`)  
Date: 2026-03-04

## Goal

Define the migration baseline where `boring-ui` becomes the single source of truth for user/workspace/collaboration management, `boring-macro` stays domain-only, and `boring-sandbox` is optional edge-only infrastructure.

## Canonical Ownership

| Surface | Owner | Notes |
| --- | --- | --- |
| `/auth/*` | `boring-ui` core | Auth/session authority moves into core backend. |
| `/api/v1/me` | `boring-ui` core | Canonical user identity endpoint. |
| `/api/v1/workspaces*` | `boring-ui` core | Workspace list/create/runtime/settings authority. |
| `/api/v1/workspaces/{id}/members*` | `boring-ui` core | Membership + role authority. |
| `/api/v1/workspaces/{id}/invites*` | `boring-ui` core | Invite lifecycle authority. |
| `/api/v1/files/*`, `/api/v1/git/*` | `boring-ui` workspace-core | Filesystem/git ownership remains workspace-level in core. |
| `/api/v1/macro/*` | `boring-macro` | Domain extension only; not workspace authority. |
| edge proxy/routing/provisioning/token injection | `boring-sandbox` | Optional edge-only role. |

## Keep vs Move (boring-sandbox)

### Stays in `boring-sandbox`

1. L7 edge routing/proxying.
2. Provisioning orchestration for runtime infrastructure.
3. Token/header injection for upstream calls.

### Moves to `boring-ui` core

1. Auth/session business logic.
2. User identity and settings APIs.
3. Workspace lifecycle (create/runtime/settings).
4. Membership and invite business logic.
5. Workspace policy decisions for business APIs.

## Frontend Contract Baseline

Frontend keeps the same canonical route families, now served by `boring-ui` core authority:

1. `/auth/*`
2. `/api/v1/me`
3. `/api/v1/workspaces*`
4. `/w/{workspace_id}/*` (if workspace-scoped boundary is enabled)

## Deployment Modes

1. Core mode (single backend): frontend calls `boring-ui` directly; no sandbox in request path.
2. Proxy mode: frontend still uses canonical routes, with `boring-sandbox` pass-through at edge only.

## Explicit Non-Goals

1. No retro compatibility for legacy sandbox sessions/data.
2. No duplication of workspace/user/collaboration business logic in sandbox.
3. No filesystem authority in `boring-macro` or `boring-sandbox`.

## Migration Phase Outline

1. Freeze ownership contract and docs.
2. Implement core control-plane module in `boring-ui`.
3. Move auth/session + user/workspace/collaboration APIs into core.
4. Enforce `/w/{workspace_id}` precedence and policy at core boundary.
5. Constrain sandbox to edge-only pass-through.
6. Validate frontend-only (core) and edge modes.
7. Final ownership audit, proof suite, and cutover runbook.
