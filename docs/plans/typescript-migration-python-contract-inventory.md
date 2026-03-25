# TypeScript Migration Python Contract Inventory

Phase 0 artifact for the TypeScript backend migration.

This document inventories the currently-exposed Python/FastAPI contract so the
TypeScript/Fastify+tRPC rewrite can preserve behavior where required and
intentionally tighten behavior where the current surface is broader than the
product contract.

## Scope

Inventory source of truth:

- Mounted-route introspection of `boring_ui.api.app:create_app()` in two modes:
  - local control-plane default (`CONTROL_PLANE_PROVIDER=local`)
  - hosted Neon control-plane (`CONTROL_PLANE_PROVIDER=neon`)
- Targeted source review of:
  - `src/back/boring_ui/api/app.py`
  - `src/back/boring_ui/api/capabilities.py`
  - `src/back/boring_ui/api/middleware/request_id.py`
  - `src/back/boring_ui/api/policy.py`
  - router modules under `src/back/boring_ui/api/modules/`
  - optional plugin/router surfaces in `workspace_plugins.py` and `stream_bridge.py`

Observed route counts from `create_app()`:

| Variant | Total Registered Routes | Product Routes Excluding FastAPI Docs/OpenAPI |
| --- | ---: | ---: |
| Local default | 101 | 97 |
| Hosted Neon | 112 | 108 |

Optional families not mounted in the default introspection runs:

- GitHub App router under `/api/v1/auth/github/*`
  - mounted when `config.github_configured` or `config.auth_dev_auto_login`
- Workspace plugin REST routes under `/api/x/{plugin}` and WebSocket `/ws/plugins`
  - mounted when `WORKSPACE_PLUGINS_ENABLED=true`

Defined but not mounted by the current `create_app()` factory:

- legacy WebSocket `/claude-stream` from `src/back/boring_ui/api/stream_bridge.py`

## Legend

Auth classifications used below:

| Label | Meaning |
| --- | --- |
| `public` | No session check in the router. |
| `delegated-or-open` | No session check by default; `X-Scope-Context` claims are enforced only when that header is present. |
| `session` | Requires `boring_session` cookie. |
| `member` | Requires `boring_session` and workspace membership. |
| `owner` | Requires `boring_session`, membership, and owner role. |
| `editor+` | Requires `boring_session`, membership, and owner/editor role. |

Migration-critical observation:

- The root workspace-core families (`/api/v1/files`, `/api/v1/git`, `/api/v1/exec`, `/api/v1/ui`, `/api/v1/agent/normal`, `/api/v1/pty`, `/ws/pty`, `/ws/agent/normal/stream`, `/api/v1/control-plane`, `/api/approval`) are not session-gated at the router level. In hosted mode, the real membership wall is the `/w/{workspace_id}/...` boundary plus optional delegated-policy envelopes.

## Cross-Cutting Contract

### Middleware And Headers

| Header | Direction | Source | Contract |
| --- | --- | --- | --- |
| `X-Request-ID` | request + response + WS accept | `middleware/request_id.py` | Accepted inbound if provided; generated if missing; echoed on every HTTP response; added to WS accept headers. |
| `X-Scope-Context` | request | `policy.py` | JSON delegation envelope. Only enforced when present; direct UI calls without the header stay allowed. |
| `X-Workspace-Id` | request | `workspace/resolver.py`, workspace boundary routers | Selects workspace context for root service routes; injected by `/w/{workspace_id}/...` passthrough and PI harness. |
| `X-Boring-Local-Workspace` | request | hosted boundary router | Internal flag telling the resolver to use the mounted workspace volume root directly on a dedicated workspace Machine. |
| `fly-replay` | response | hosted workspace boundary | Returned in backend-agent mode when a workspace request must be replayed to another Fly Machine instance. |
| `Access-Control-Allow-*` | response | `CORSMiddleware` in `app.py` | CORS is `allow_credentials=True`, `allow_methods=["*"]`, `allow_headers=["*"]`, with origins from config/env. |

### Cookies And Ephemeral Auth Artifacts

| Item | Type | Issuer | Attributes / TTL | Notes |
| --- | --- | --- | --- | --- |
| `boring_session` | cookie (name configurable via `AUTH_SESSION_COOKIE_NAME`) | local auth routes, hosted Neon auth routes, dev auto-login middleware | `Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=AUTH_SESSION_TTL_SECONDS` (default 86400), `Secure` controlled by `AUTH_SESSION_SECURE_COOKIE` | HS256 JWT created by `auth_session.py`; carries `sub`, `email`, `exp`, optional `app_id`. |
| `pending_login` | callback query parameter, not a cookie | hosted Neon auth signup flow | Fernet-encrypted, TTL 30 minutes | Used to complete sign-in after verify-email callback. There is no `pending_login_token` cookie in the current implementation. |
| GitHub OAuth `state` | in-memory pending-state map, not a cookie | GitHub auth router | short-lived in process memory | Tracks authorize/callback correlation and optional `workspace_id`. |

### Redirects

| Route | Behavior |
| --- | --- |
| `GET /auth/login` (local dev adapter path) | Issues `boring_session`, sanitizes `redirect_uri`, returns `302`. |
| `GET /auth/callback` (local dev adapter path) | Same as local login: set cookie + `302` to sanitized `redirect_uri`. |
| `GET /auth/logout` | Clears `boring_session` and `302`s to `/auth/login`. |
| `GET /auth/social/{provider}` | Hosted-only social auth kickoff; usually `302`s to provider/Neon URL. |
| `GET /auth/callback` (hosted pending-login success path) | Reuses `Set-Cookie` from completed sign-in and `302`s to sanitized `redirect_uri`. |
| `GET /api/v1/auth/github/authorize` | Optional GitHub App route; `302`s to GitHub authorize/install URL. |
| `GET /api/v1/auth/github/callback` | Returns HTML that posts a message to opener or client-side redirects to workspace settings/base URL. |

## Mounted Route Inventory

### Core Utility And Runtime-Config Surface

Variant: `both`

Auth: `public`

| Path | Methods | Request Shape | Response Shape |
| --- | --- | --- | --- |
| `/health` | `GET` | none | `{status, workspace, features}`; returns `503` while PI startup is still in progress. |
| `/healthz` | `GET` | none | `{status, request_id, checks, workspace, metrics}` operational health snapshot. |
| `/metrics` | `GET` | none | Prometheus plaintext metrics. |
| `/api/config` | `GET` | none | workspace root, PTY provider list, static path info. |
| `/api/project` | `GET` | none | `{root}` for frontend bootstrapping. |
| `/api/capabilities` | `GET` | none | capability map, routers/features, runtime/agent metadata. |
| `/__bui/config` | `GET` | none | runtime config payload derived from `boring.app.toml` / env. |

FastAPI framework docs also remain mounted in both variants:

| Path | Methods | Notes |
| --- | --- | --- |
| `/docs` | `GET`, `HEAD` | Swagger UI. |
| `/docs/oauth2-redirect` | `GET`, `HEAD` | Swagger helper route. |
| `/openapi.json` | `GET`, `HEAD` | OpenAPI schema. |
| `/redoc` | `GET`, `HEAD` | ReDoc UI. |

### Approval Surface

Variant: `both`

Auth: `delegated-or-open`

| Path | Methods | Request Shape | Response Shape |
| --- | --- | --- | --- |
| `/api/approval/request` | `POST` | approval payload for tool-use request | pending approval record. |
| `/api/approval/pending` | `GET` | none | pending approval list. |
| `/api/approval/decision` | `POST` | approval decision payload | updated approval record. |
| `/api/approval/status/{request_id}` | `GET` | path `request_id` | approval status payload. |
| `/api/approval/{request_id}` | `DELETE` | path `request_id` | delete/clear result. |

### Files Surface

Variant: `both`

Auth:

- root `/api/v1/files/*`: `delegated-or-open`
- workspace-scoped via `/w/{workspace_id}/api/v1/files/*`: `member`

| Path | Methods | Request Shape | Response Shape |
| --- | --- | --- | --- |
| `/api/v1/files/list` | `GET` | query `path=.` | directory listing from `FileService.list_directory()`. |
| `/api/v1/files/read` | `GET` | query `path` | file read payload from `FileService.read_file()`. |
| `/api/v1/files/write` | `PUT` | query `path`, JSON `{"content": string}` | write result from `FileService.write_file()`. |
| `/api/v1/files/delete` | `DELETE` | query `path` | delete result. |
| `/api/v1/files/rename` | `POST` | JSON `{"old_path","new_path"}` | rename result. |
| `/api/v1/files/move` | `POST` | JSON `{"src_path","dest_dir"}` | move result. |
| `/api/v1/files/search` | `GET` | query `q`, optional `path=.` | search result list. |

### Git Surface

Variant: `both`

Auth:

- root `/api/v1/git/*`: `delegated-or-open`
- workspace-scoped via `/w/{workspace_id}/api/v1/git/*`: `member`

| Path | Methods | Request Shape | Response Shape |
| --- | --- | --- | --- |
| `/api/v1/git/status` | `GET` | none | `{is_repo, files, ...}` repository status summary. |
| `/api/v1/git/diff` | `GET` | query `path` | diff payload for a single file. |
| `/api/v1/git/show` | `GET` | query `path` | HEAD content payload for a single file. |
| `/api/v1/git/init` | `POST` | none | repo-init result. |
| `/api/v1/git/add` | `POST` | JSON `{"paths": [...] | null}` | staging result. |
| `/api/v1/git/commit` | `POST` | JSON `{"message","author":{"name","email"}}` | commit result. |
| `/api/v1/git/push` | `POST` | JSON `{"remote"?, "branch"?}` | push result; may use GitHub App or PAT credentials. |
| `/api/v1/git/pull` | `POST` | JSON `{"remote"?, "branch"?}` | pull result; may use GitHub App or PAT credentials. |
| `/api/v1/git/clone` | `POST` | JSON `{"url","branch"?}` | clone result. |
| `/api/v1/git/remote` | `POST` | JSON `{"name","url"}` | add/update remote result. |
| `/api/v1/git/branches` | `GET` | none | branch list payload. |
| `/api/v1/git/branch` | `GET`, `POST` | `GET`: none. `POST`: JSON `{"name","checkout"?}` | current branch (`GET`) or create-branch result (`POST`). |
| `/api/v1/git/checkout` | `POST` | JSON `{"name"}` | checkout result. |
| `/api/v1/git/merge` | `POST` | JSON `{"source","message"?}` | merge result. |
| `/api/v1/git/remotes` | `GET` | none | configured remotes payload. |

### Exec Surface

Variant: `both`

Auth:

- root `/api/v1/exec`: `delegated-or-open`
- workspace-scoped via `/w/{workspace_id}/api/v1/exec`: `member`

| Path | Methods | Request Shape | Response Shape |
| --- | --- | --- | --- |
| `/api/v1/exec` | `POST` | `ExecRequest` JSON (`command`, optional `cwd`) | command execution result from `execute_command()`. |

### UI State Surface

Variant: `both`

Auth:

- root `/api/v1/ui/*`: `delegated-or-open`
- workspace-scoped via `/w/{workspace_id}/api/v1/ui/*`: `member`

| Path | Methods | Request Shape | Response Shape |
| --- | --- | --- | --- |
| `/api/v1/ui/state` | `GET`, `POST`, `PUT`, `DELETE` | `GET`: none. `POST/PUT`: `UIStatePayload`. `DELETE`: none. | list all states, upsert a state, or clear all states. |
| `/api/v1/ui/state/latest` | `GET` | none | latest published frontend state. |
| `/api/v1/ui/state/{client_id}` | `GET`, `DELETE` | path `client_id` | one state payload or delete result. |
| `/api/v1/ui/panes` | `GET` | none | latest open-pane snapshot. |
| `/api/v1/ui/panes/{client_id}` | `GET` | path `client_id` | pane snapshot for one client. |
| `/api/v1/ui/commands` | `POST` | `UICommandEnvelope` | queued UI command. |
| `/api/v1/ui/commands/next` | `GET` | query `client_id` | next queued command (or `null`). |
| `/api/v1/ui/focus` | `POST` | `UIFocusRequest` | queued focus-panel command. |

### Agent-Normal, PTY, And Claude Stream Surfaces

Variant: `both`

Auth:

- HTTP lifecycle routes: `delegated-or-open`
- WebSockets: `delegated-or-open` and keyed by query params / workspace headers, not by session cookie

| Path | Methods | Request Shape | Response Shape |
| --- | --- | --- | --- |
| `/api/v1/agent/normal/sessions` | `GET`, `POST` | `GET`: none. `POST`: none. | list active PTY/stream sessions or mint a new session UUID. |
| `/api/v1/agent/normal/attachments` | `POST` | raw bytes or multipart form-data | stored attachment metadata `{file_id, relative_path, name, size}`. |
| `/api/v1/pty/sessions` | `GET`, `POST` | none | list PTY session summaries or mint PTY session UUID. |
| `/ws/pty` | `WS` | query `provider`, optional `session_id`; client frames `input`, `resize`, `ping` | PTY session stream; returns JSON error envelopes on startup failure and `pong` frames. |
| `/ws/agent/normal/stream` | `WS` | query `session_id`, `resume`, `force_new`, `mode`, model/tool limits/files; client frames include user messages | Claude stream-json session bridge with system/event payloads and persisted permission suggestions. |

### Messaging Surface

Variant: `both`

Auth:

- `connect`/`disconnect`/`channels` are router-public
- Telegram webhook is router-public by design

| Path | Methods | Request Shape | Response Shape |
| --- | --- | --- | --- |
| `/api/v1/messaging/channels` | `GET` | workspace context from headers/path | connected channel summary list. |
| `/api/v1/messaging/channels/telegram/connect` | `POST` | JSON `{"bot_token","workspace_id"}` | webhook registration result. |
| `/api/v1/messaging/channels/telegram/disconnect` | `POST` | JSON `{"workspace_id"}` | `{ok: true}`. |
| `/api/v1/messaging/channels/telegram/webhook/{workspace_id}` | `POST` | Telegram webhook JSON | `{ok: true}` after routing through PI harness when available. |

### Control-Plane Foundation Surface

Variant: `both`

Auth: `delegated-or-open`

This family is local-JSON foundation plumbing, even in hosted mode.

| Path | Methods | Request Shape | Response Shape |
| --- | --- | --- | --- |
| `/api/v1/control-plane/health` | `GET` | none | storage summary and counts. |
| `/api/v1/control-plane/snapshot` | `GET` | none | full local JSON snapshot. |
| `/api/v1/control-plane/users` | `GET` | none | user list. |
| `/api/v1/control-plane/users/{user_id}` | `PUT` | `MetadataPayload` JSON | upserted user. |
| `/api/v1/control-plane/workspaces` | `GET` | none | workspace list. |
| `/api/v1/control-plane/workspaces/{workspace_id}` | `PUT` | `MetadataPayload` JSON | upserted workspace. |
| `/api/v1/control-plane/memberships` | `GET` | none | membership list. |
| `/api/v1/control-plane/memberships/{membership_id}` | `PUT` | `MetadataPayload` JSON | upserted membership. |
| `/api/v1/control-plane/invites` | `GET` | none | invite list. |
| `/api/v1/control-plane/invites/{invite_id}` | `PUT` | `MetadataPayload` JSON | upserted invite. |
| `/api/v1/control-plane/workspaces/{workspace_id}/settings` | `GET`, `PUT` | `GET`: none. `PUT`: `MetadataPayload`. | workspace settings read/write. |
| `/api/v1/control-plane/workspaces/{workspace_id}/runtime` | `GET`, `PUT` | `GET`: none. `PUT`: `MetadataPayload`. | workspace runtime read/write. |

### User Identity And Settings

Variant: `both` with different backing stores

Auth: `session`

- local mode: JSON-backed service
- hosted mode: Neon/Postgres-backed `user_settings` table

| Path | Methods | Request Shape | Response Shape |
| --- | --- | --- | --- |
| `/api/v1/me` | `GET` | none | normalized user/profile payload. |
| `/api/v1/me/settings` | `GET`, `PUT` | `GET`: none. `PUT`: arbitrary JSON object merged into settings. | `{ok, settings}` payload. |

### Workspace Lifecycle And Collaboration

#### Local Control-Plane Variant

Auth:

- workspace lifecycle/settings: `delegated-or-open`
- collaboration members/invites: `session`

| Path | Methods | Request Shape | Response Shape |
| --- | --- | --- | --- |
| `/api/v1/workspaces` | `GET`, `POST` | `GET`: none. `POST`: optional JSON `{"name"?, "created_by"?}`. | workspace list or created workspace payload. |
| `/api/v1/workspaces/{workspace_id}/runtime` | `GET` | none | `{ok, runtime}`. |
| `/api/v1/workspaces/{workspace_id}/runtime/retry` | `POST` | none | `{ok, runtime, retried}`. |
| `/api/v1/workspaces/{workspace_id}/settings` | `GET`, `PUT` | `GET`: none. `PUT`: arbitrary JSON object. | `{ok, settings}`. |
| `/api/v1/workspaces/{workspace_id}/members` | `GET` | none | member list; bootstraps owner membership in dev auto-login mode. |
| `/api/v1/workspaces/{workspace_id}/members/{user_id}` | `PUT` | arbitrary JSON body with role metadata | upserted member. |
| `/api/v1/workspaces/{workspace_id}/invites` | `GET`, `POST` | `GET`: none. `POST`: invite JSON (`email`, `role` etc.). | invite list or created invite. |
| `/api/v1/workspaces/{workspace_id}/invites/{invite_id}/accept` | `POST` | none | accepted invite + membership payload. |

#### Hosted Neon Variant

Auth:

- list/create workspaces: `session`
- update/delete/runtime/settings: `member`
- member upsert: `owner`
- invite list/create: `editor+`
- invite accept: `session` plus email match

| Path | Methods | Request Shape | Response Shape |
| --- | --- | --- | --- |
| `/api/v1/workspaces` | `GET`, `POST` | `GET`: none. `POST`: optional JSON `{"name"?}`. | user-visible workspace list or created workspace payload. |
| `/api/v1/workspaces/{workspace_id}` | `PATCH`, `DELETE` | `PATCH`: JSON `{"name"}`. `DELETE`: none. | updated workspace or deletion result. |
| `/api/v1/workspaces/{workspace_id}/runtime` | `GET` | none | `{ok, runtime}` backed by `workspace_runtimes`. |
| `/api/v1/workspaces/{workspace_id}/runtime/retry` | `POST` | none | retry/provisioning result. |
| `/api/v1/workspaces/{workspace_id}/settings` | `GET`, `PUT` | `PUT`: arbitrary settings JSON. | `{ok, settings}` backed by DB. |
| `/api/v1/workspaces/{workspace_id}/members` | `GET` | none | DB-backed member list. |
| `/api/v1/workspaces/{workspace_id}/members/{user_id}` | `PUT` | arbitrary JSON body with `role` | upserted DB membership. |
| `/api/v1/workspaces/{workspace_id}/invites` | `GET`, `POST` | `POST`: JSON `{"email","role"?}` | invite list or created invite including one-time `invite_token`. |
| `/api/v1/workspaces/{workspace_id}/invites/{invite_id}/accept` | `POST` | none | accepted invite + membership payload. |

### Workspace Boundary Surface

Variant: `both`

Auth: `member`

Notes:

- browser `GET` with `Accept: text/html` returns SPA HTML for navigation routes
- hosted backend-agent mode may reply with `fly-replay` instead of handling locally
- passthrough injects `X-Workspace-Id`; hosted local-machine passthrough also injects `X-Boring-Local-Workspace: 1`

| Path | Methods | Request Shape | Response Shape |
| --- | --- | --- | --- |
| `/w/{workspace_id}/setup` | `GET` | browser navigation or API call | SPA HTML for browser navigation, or `{ok, workspace_id, route: "setup", runtime}` JSON. |
| `/w/{workspace_id}/runtime` | `GET` | none | forwarded `/api/v1/workspaces/{id}/runtime` payload. |
| `/w/{workspace_id}/runtime/retry` | `POST` | none | forwarded retry payload. |
| `/w/{workspace_id}/settings` | `GET`, `PUT` | `PUT`: forwarded arbitrary settings JSON | SPA HTML on browser GET or forwarded settings payload. |
| `/w/{workspace_id}/{path:path}` | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS` | workspace-scoped proxied request | forwards allowed API families, serves SPA for client routes, rejects reserved/denied paths. |

## Optional And Conditional Families

### GitHub App Surface

Mount condition: `config.github_configured` or `config.auth_dev_auto_login`

Base prefix: `/api/v1/auth/github`

Important auth note:

- Most routes in this family do not enforce a session cookie in the router itself.
- `status` optionally reads current-user account-link state from session if present.

| Path | Methods | Request Shape | Response Shape |
| --- | --- | --- | --- |
| `/api/v1/auth/github/authorize` | `GET` | query `redirect_uri?`, `workspace_id?`, `force_install?` | `302` to GitHub authorize/install URL. |
| `/api/v1/auth/github/callback` | `GET` | query `code?`, `state?`, `installation_id?`, `setup_action?` | HTML page that posts callback result and/or redirects browser. |
| `/api/v1/auth/github/connect` | `POST` | JSON `{"workspace_id","installation_id"}` | `{connected, installation_id}`. |
| `/api/v1/auth/github/status` | `GET` | query `workspace_id?` | connection/account-link status payload. |
| `/api/v1/auth/github/disconnect` | `POST` | JSON `{"workspace_id"}` | `{disconnected: true}`. |
| `/api/v1/auth/github/installations` | `GET` | none | installation list. |
| `/api/v1/auth/github/repos` | `GET` | query `installation_id` | repository list for installation. |
| `/api/v1/auth/github/repo` | `POST` | JSON `{"workspace_id","repo_url"}` | selected repo payload. |
| `/api/v1/auth/github/git-credentials` | `GET` | query `workspace_id` | git credential payload for connected workspace. |
| `/api/v1/auth/github/git-proxy/ws/{workspace_id}/{target:path}` | `GET`, `POST` | smart-HTTP proxy request | proxied GitHub smart-HTTP response with workspace-aware credentials. |
| `/api/v1/auth/github/git-proxy/{target:path}` | `GET`, `POST` | smart-HTTP proxy request | proxied GitHub smart-HTTP response without workspace binding. |

### Workspace Plugins

Mount condition: `WORKSPACE_PLUGINS_ENABLED=true`

| Path | Methods | Contract |
| --- | --- | --- |
| `/api/x/{plugin}/...` | dynamic | mounts each `kurt/api/*.py` router under `/api/x/{plugin}`. |
| `/ws/plugins` | `WS` | simple change-notification WebSocket; broadcasts `{"type":"plugin_changed"}`. |

### Legacy Defined-But-Unmounted Surface

| Path | Methods | Source | Notes |
| --- | --- | --- | --- |
| `/claude-stream` | `WS` | `src/back/boring_ui/api/stream_bridge.py` | Defined in a legacy bridge router, but not mounted by `create_app()`. |

## Migration Notes

Contract details that must be preserved or intentionally addressed during the TS rewrite:

1. `boring_session` is the shared cookie contract across control-plane and workspace routing. It is an HS256 JWT, not a provider-native session token.
2. Redirect sanitization is centralized around relative-path-only `redirect_uri` handling. The TS port must preserve the same fail-closed behavior.
3. Root workspace-core routes are broader than the product contract. If the TS rewrite tightens these, the change should be explicit and smoke-tested rather than accidental.
4. Hosted workspace access semantics live in the `/w/{workspace_id}/...` boundary router, including replay and membership checks.
5. `pending_login` is a callback query token, not a cookie; migration docs and tests should use the real current contract.
