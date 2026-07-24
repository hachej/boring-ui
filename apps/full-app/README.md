# full-app

The production-shaped reference app. Composes all three core packages — `@hachej/boring-core` (auth, multi-user workspaces, Postgres), `@hachej/boring-agent` (runtime), and `@hachej/boring-workspace` (workbench) — into a single deployable Fastify + React app with email/password auth, Postgres-backed workspaces with roles and invites, and Fly.io/Docker deployment.

For a backend-free workbench use [`workspace-playground`](../workspace-playground/README.md); for the bare agent chat use [`agent-playground`](../agent-playground/README.md).

## What it is

The server is built by `createCoreWorkspaceAgentServer` (from `@hachej/boring-core/app/server`), which layers core (auth + workspace management on Postgres) over the workspace + agent stack. Auth is **better-auth** with email/password, email verification, and password reset (mail via `MAIL_TRANSPORT_URL` / Resend). Workspaces are persisted in Postgres with role-based membership and invites.

- **Dev** (`dev`): builds agent/workspace/core, then `tsx src/server/dev.ts` runs the dev server — Vite frontend on **`http://localhost:5173`** in front of the Fastify API.
- **Prod** (`start`): `node dist/server/main.js`, listening on **`PORT`** (default `3000`).

App-specific server plugins live in `src/server/plugins.ts`. The generic `boring-mcp` Sources plugin is statically composed for this app; set `BORING_MCP_ENABLED=0` to disable its server prompt/plugin registration. Set `BORING_PLUGIN_AUTHORING=1` to install the in-app plugin-authoring surface (dev and prod).

## Managed Agent MCP Endpoint

`full-app` can expose its configured default boring agent over MCP at `GET|POST|DELETE /mcp/managed-agent`. This endpoint is dark by default and is enabled only when all of these server-only env vars are present:

```txt
BORING_MANAGED_AGENT_MCP_ENABLED=1
BORING_MANAGED_AGENT_MCP_BEARER_TOKEN=<opaque bearer token>
BORING_MANAGED_AGENT_MCP_WORKSPACE_ID=<authorized workspace id>
BORING_MANAGED_AGENT_MCP_USER_ID=<authorized user id>
```

Clients connect with `Authorization: Bearer <token>` using the MCP Streamable HTTP transport. The configured user/workspace pair is resolved by the host, checked against the full-app workspace store, and bound to the existing `WorkspaceAgentDispatcher` for that workspace. Tool arguments grant no routing authority: callers cannot select another workspace, user, deployment, agent, runtime, filesystem path, or model key.

This endpoint **exposes** a boring agent to MCP clients. `plugins/boring-mcp` is the inverse: it **consumes** external MCP sources and contributes governed tools to a boring agent.

Delivery v0 returns final assistant text plus at most one complete UTF-8 Markdown artifact. Binding-level caps are brief 32 KiB, final text 96 KiB, one Markdown artifact 256 KiB, and complete serialized result 384 KiB. The artifact payload includes `content`, `sha256`, `byteSize`, and `mediaType`; it must not include a workspace path, host root, truncation flag, token, or model credential. Stable artifact rejection codes are `MCP_AGENT_ARTIFACT_INVALID`, `MCP_AGENT_ARTIFACT_TOO_LARGE`, and `MCP_AGENT_ARTIFACT_UNAVAILABLE`.

The M1 receipt/status state is process-local. It is suitable for same-process polling and retained terminal status, but it is not restart-durable and is not a cross-replica admission authority. A host restart can lose in-flight delegation state.

Run the deterministic stock-client smoke with:

```bash
pnpm --filter full-app smoke:mcp-managed-agent
```

The smoke boots a local ephemeral `127.0.0.1` Fastify listener, registers `registerFullAppManagedAgentMcpRoutes`, injects a deterministic fake existing dispatcher/workspace binding, and connects with the unmodified `@modelcontextprotocol/sdk` `Client` plus `StreamableHTTPClientTransport`. It proves bearer rejection, `delegate_task_start` polling progress, completed inline Markdown delivery, and `MODEL_BUDGET_EXCEEDED` error shape without a live model call. It is proof of the route/protocol/binding contract, not proof of a live provider/model configuration.

## Run (local dev)

```bash
# from repo root, after `pnpm install`
cp apps/full-app/.env.example apps/full-app/.env   # then fill in values
# bring up Postgres, then apply migrations:
pnpm --filter full-app migrate
pnpm --filter full-app dev
```

Open `http://localhost:5173`.

### Hosted automation scheduler

The hosted Automation plugin starts an internal Croner wake-up once per minute
by default and evaluates the current minute once when Fastify becomes ready.
Each automation creator is re-authorized before execution, overlapping ticks in
one process are skipped, and database constraints prevent duplicate active or
scheduled-minute runs across processes.

For a deployment that intentionally uses an external scheduler, set
`BORING_AUTOMATION_INTERNAL_SCHEDULER=false` and set
`BORING_AUTOMATION_TRIGGER_TOKEN` to a deployment secret. Invoke:

```bash
curl --fail --silent --show-error -X POST \
  -H "Authorization: Bearer $BORING_AUTOMATION_TRIGGER_TOKEN" \
  http://localhost:5173/api/v1/boring-automation/due/hosted
```

The token authenticates only the external service principal. The endpoint stays
available as an operational fallback when the internal scheduler is enabled.

## Scripts

| Script | What it does |
|--------|--------------|
| `dev` | Build agent/workspace/core, then `tsx src/server/dev.ts` (Vite :5173 + Fastify) |
| `build` | Build packages, then `build-app.mts` (frontend → `dist/front`, server → `dist/server`) |
| `start` | `node dist/server/main.js` (prod, listens on `PORT`) |
| `migrate` | `tsx src/server/migrate.ts` — apply DB migrations |
| `typecheck` / `lint` | `tsc --noEmit` (`lint` is an alias of `typecheck`) |
| `e2e` / `e2e:smoke` | Playwright against `e2e/playwright.config.ts` (the two scripts are identical) |
| `smoke:mcp-managed-agent` | `node --import tsx scripts/managed-agent-mcp-smoke.ts` — local stock MCP client smoke for `/mcp/managed-agent` |
| `smoke:post-deploy` | `tsx scripts/post-deploy-smoke.ts` — post-deploy smoke against a live `DEPLOY_URL` |

## Env vars

From `.env.example` and code. Required for a working server:

| Var | Notes |
|-----|-------|
| `DATABASE_URL` | Postgres connection string |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Auth secret + base URL |
| `WORKSPACE_SETTINGS_ENCRYPTION_KEY` | 32-byte hex; encrypts per-workspace settings |
| `MAIL_FROM`, `MAIL_TRANSPORT_URL` | Mail transport (`console://` for dev) |

Common optional:

| Var | Default | Notes |
|-----|---------|-------|
| `PORT` / `HOST` / `LOG_LEVEL` | `3000` / `0.0.0.0` / `info` | HTTP server |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:5173` | Allowed origins |
| `BORING_PLUGIN_AUTHORING` | `0` | `1` installs the plugin-authoring surface |
| `BORING_AUTOMATION_INTERNAL_SCHEDULER` | `true` | Set to `false` only when an external scheduler owns hosted Automation wake-ups |
| `ENABLE_DEV_LOGIN` | `0` | Dev server only. Set `1` to enable `GET /dev-login`, which creates/signs in a local dev user and redirects to `/`. Ignored in `NODE_ENV=production`. |
| `DEV_LOGIN_EMAIL`, `DEV_LOGIN_PASSWORD`, `DEV_LOGIN_NAME` | `dev@example.test`, strong local password, `Dev` | Optional credentials for `ENABLE_DEV_LOGIN=1`. |
| `RESEND_API_KEY` | — | Resend mail transport |
| `BORING_AGENT_WORKSPACE_ROOT` | — | Host/control-plane workspace root. In `vercel-sandbox` prod this is `/data/workspaces`; it is not the sandbox cwd. Agent files live in sandbox `/workspace`. |
| `BORING_AGENT_SESSION_ROOT` | — | Durable Pi chat transcript root. In Fly prod use a mounted-volume path such as `/data/pi-sessions`; do not rely on container `/root/.pi`. |
| `BORING_AGENT_DEFAULT_MODEL_PROVIDER`, `BORING_AGENT_DEFAULT_MODEL_ID`, `INFOMANIAK_API_TOKEN`, `BORING_AGENT_INFOMANIAK_PRODUCT_ID`, `BORING_AGENT_INFOMANIAK_MODEL` | — | Default chat model, incl. OpenAI-compatible Infomaniak endpoint |
| `BORING_AGENT_MODE` | `local` | Set `vercel-sandbox` to run the agent in a Vercel Firecracker microVM. Also configure Vercel credentials such as `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`, and local/dev auth via `VERCEL_TOKEN` when OIDC is not available. |
| `BORING_MCP_ENABLED` | `1` | Enables the generic boring-mcp server plugin/prompt for app-owned Sources wiring. |
| `BORING_MANAGED_AGENT_MCP_ENABLED` | `0` | Set `1` to expose `GET|POST|DELETE /mcp/managed-agent`. Requires the bearer, workspace, and user vars below. |
| `BORING_MANAGED_AGENT_MCP_BEARER_TOKEN` | — | Server-only bearer token required by MCP clients via `Authorization: Bearer ...`. |
| `BORING_MANAGED_AGENT_MCP_WORKSPACE_ID` | — | Host-configured authorized workspace. Caller tool arguments cannot override it. |
| `BORING_MANAGED_AGENT_MCP_USER_ID` | — | Host-configured authorized subject checked against workspace membership. |
| `COMPOSIO_API_KEY` | — | Optional server-only managed connector credential resolved by the app's boring-mcp managed connector secret resolver. Do not create a `VITE_*` mirror. |
| `BORING_MCP_MAX_READONLY_INPUT_BYTES` | `65536` | Governed read-only MCP call input limit. |

The post-deploy smoke script reads `DEPLOY_URL` plus a family of `SMOKE_*` vars (e.g. `SMOKE_EMAIL`, `SMOKE_PASSWORD`, `SMOKE_AGENT_MODEL_PROVIDER`) to exercise sign-up/verify/reset/agent-chat against a deployed instance.

### Local dev login

For local development only, the dev server can expose a one-click login helper:

```bash
ENABLE_DEV_LOGIN=1 pnpm --filter full-app dev
```

Then open:

```txt
http://localhost:3000/dev-login
```

The route signs in `DEV_LOGIN_EMAIL` (default `dev@example.test`) or creates it if missing, sets the normal Better Auth session cookie, and redirects to `/`. The core dev server proxies `/dev-login` from the frontend port to the API server. The route is unavailable unless `ENABLE_DEV_LOGIN=1` and is ignored in `NODE_ENV=production`.

## Deployment

- **Fly.io**: `fly.toml` (app `boring-full-app`, region `cdg`, `/health` checks, `release_command` runs `migrate.js`, mounted `workspace_data` volume at `/data`). Secrets via `fly secrets set`.
- **Docker**: `Dockerfile` builds the app; run with `-p 3000:3000 --env-file apps/full-app/.env`.

In the production Docker image, `BORING_AGENT_MODE=vercel-sandbox` splits storage. The image starts through `apps/full-app/docker/web-entrypoint.sh`, which repairs ownership of the mounted `/data/workspaces` and `/data/pi-sessions` roots before dropping to the unprivileged app user.


```txt
Fly volume:
  /data/workspaces/<workspaceId>   host/control-plane anchor, normally empty in sandbox mode
  /data/pi-sessions/<workspaceId>  durable chat transcripts

Vercel sandbox:
  /workspace                       actual agent cwd, file tree, and shell workspace
```

Do not debug missing sandbox files by looking under `/data/workspaces/<id>`; inspect
the Vercel sandbox `/workspace` instead. Do inspect `/data/pi-sessions/<id>` when
checking whether chat history survives Fly deploy/restart. If session creation fails
with `EACCES mkdir /data/pi-sessions/...`, see `docs/FIXES.md`.

After deploy, run `pnpm --filter full-app smoke:post-deploy` (with `DEPLOY_URL` set) to verify the live instance.

## Composition

Depends on `@hachej/boring-core` and `@hachej/boring-workspace` directly; `@hachej/boring-agent` is pulled in transitively as the runtime. `createCoreWorkspaceAgentServer` wires core's auth/workspace layer on top of the workspace + agent server, so this app is the canonical example of all three packages running together.

## License

MIT
