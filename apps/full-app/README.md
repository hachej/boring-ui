# full-app

The production-shaped reference app. Composes all three core packages — `@hachej/boring-core` (auth, multi-user workspaces, Postgres), `@hachej/boring-agent` (runtime), and `@hachej/boring-workspace` (workbench) — into a single deployable Fastify + React app with email/password auth, Postgres-backed workspaces with roles and invites, and Fly.io/Docker deployment.

For a backend-free workbench use [`workspace-playground`](../workspace-playground/README.md); for the bare agent chat use [`agent-playground`](../agent-playground/README.md).

## What it is

The server is built by `createCoreWorkspaceAgentServer` (from `@hachej/boring-core/app/server`), which layers core (auth + workspace management on Postgres) over the workspace + agent stack. Auth is **better-auth** with email/password, email verification, and password reset (mail via `MAIL_TRANSPORT_URL` / Resend). Workspaces are persisted in Postgres with role-based membership and invites.

- **Dev** (`dev`): builds agent/workspace/core, then `tsx src/server/dev.ts` runs the dev server — Vite frontend on **`http://localhost:5173`** in front of the Fastify API.
- **Prod** (`start`): `node dist/server/main.js`, listening on **`PORT`** (default `3000`).

App-specific server plugins live in `src/server/plugins.ts`. The generic `boring-mcp` Sources plugin is statically composed for this app; set `BORING_MCP_ENABLED=0` to disable its server prompt/plugin registration. Set `BORING_PLUGIN_AUTHORING=1` to install the in-app plugin-authoring surface (dev and prod).

## Run (local dev)

```bash
# from repo root, after `pnpm install`
cp apps/full-app/.env.example apps/full-app/.env   # then fill in values
# bring up Postgres, then apply migrations:
pnpm --filter full-app migrate
pnpm --filter full-app dev
```

Open `http://localhost:5173`.

## Scripts

| Script | What it does |
|--------|--------------|
| `dev` | Build agent/workspace/core, then `tsx src/server/dev.ts` (Vite :5173 + Fastify) |
| `build` | Build packages, then `build-app.mts` (frontend → `dist/front`, server → `dist/server`) |
| `start` | `node dist/server/main.js` (prod, listens on `PORT`) |
| `migrate` | `tsx src/server/migrate.ts` — apply DB migrations |
| `typecheck` / `lint` | `tsc --noEmit` (`lint` is an alias of `typecheck`) |
| `e2e` / `e2e:smoke` | Playwright against `e2e/playwright.config.ts` (the two scripts are identical) |
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
| `ENABLE_DEV_LOGIN` | `0` | Dev server only. Set `1` to enable `GET /dev-login`, which creates/signs in a local dev user and redirects to `/`. Ignored in `NODE_ENV=production`. |
| `DEV_LOGIN_EMAIL`, `DEV_LOGIN_PASSWORD`, `DEV_LOGIN_NAME` | `dev@example.test`, strong local password, `Dev` | Optional credentials for `ENABLE_DEV_LOGIN=1`. |
| `RESEND_API_KEY` | — | Resend mail transport |
| `BORING_AGENT_WORKSPACE_ROOT` | — | Host/control-plane workspace root. In `vercel-sandbox` prod this is `/data/workspaces`; it is not the sandbox cwd. Agent files live in sandbox `/workspace`. |
| `BORING_AGENT_SESSION_ROOT` | — | Durable Pi chat transcript root. In Fly prod use a mounted-volume path such as `/data/pi-sessions`; do not rely on container `/root/.pi`. |
| `BORING_AGENT_DEFAULT_MODEL_PROVIDER`, `BORING_AGENT_DEFAULT_MODEL_ID`, `INFOMANIAK_API_TOKEN`, `BORING_AGENT_INFOMANIAK_PRODUCT_ID`, `BORING_AGENT_INFOMANIAK_MODEL` | — | Default chat model, incl. OpenAI-compatible Infomaniak endpoint |
| `BORING_AGENT_MODE` | `local` | Set `vercel-sandbox` to run the agent in a Vercel Firecracker microVM. Also configure Vercel credentials such as `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`, and local/dev auth via `VERCEL_TOKEN` when OIDC is not available. |
| `BORING_MCP_ENABLED` | `1` | Enables the generic boring-mcp server plugin/prompt for app-owned Sources wiring. |
| `COMPOSIO_API_KEY` | — | Optional server-only managed connector credential resolved by the app's boring-mcp managed connector secret resolver. Do not create a `VITE_*` mirror. |
| `BORING_MCP_MAX_READONLY_INPUT_BYTES` | `65536` | Governed read-only MCP call input limit. |
| `BORING_M1_MCP_MANAGED_AGENT_ENABLED` | `0` | `1` mounts the M1 vertical managed-agent MCP endpoint in full-app. |
| `BORING_M1_MCP_WORKSPACE_ID`, `BORING_M1_MCP_USER_ID` | — | Host-selected real `SessionCtx` for the M1 endpoint. The MCP caller cannot supply tenant authority; `BORING_M1_MCP_USER_ID` is required when full-app metering is wired. |
| `BORING_M1_MCP_BEARER_TOKEN` | — | Required bearer token for the M1 endpoint when `BORING_M1_MCP_MANAGED_AGENT_ENABLED=1`. |
| `BORING_M1_MCP_ENDPOINT_PATH` | `/mcp/managed-agent` | Streamable HTTP MCP endpoint path for stock MCP clients. |

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

The root `docker-compose.local-apps.yml` enables this helper by default for the externally reachable local full app:

```txt
http://100.68.199.114:6301/dev-login
```

### M1 Managed-Agent MCP Endpoint

BBM1-002 hosts one vertical `Engagement Analyst` managed-agent composition in full-app. When enabled, stock MCP clients connect to:

```txt
https://<full-app-host>/mcp/managed-agent
```

The endpoint exposes `delegate_task`, `delegate_task_start`, and `delegate_task_status` over Streamable HTTP. Delivery v0 returns final assistant text plus workspace-relative Markdown artifact references only. It does not return share links; BBM1-004 owns share-link delivery after PR #424 lands. Small text artifacts are inlined when their content is at most `8000` characters; larger text artifacts keep the workspace-relative path and set `truncated: true`.

Artifacts are written under `artifacts/mcp-managed-agent/...` inside the configured workspace. Caller-visible refs never include absolute host paths or Pi/session-storage paths. Use `BORING_AGENT_SESSION_ROOT` for durable sidecar chat transcripts; with `BORING_AGENT_WORKSPACE_ROOT=/data/workspaces`, keep it on the sibling mounted volume `/data/pi-sessions`.

## Deployment

- **Fly.io**: `fly.toml` (app `boring-full-app`, region `cdg`, `/health` checks, `release_command` runs `migrate.js`, mounted `workspace_data` volume at `/data`). Secrets via `fly secrets set`.
- **Docker**: `Dockerfile` builds the app; run with `-p 3000:3000 --env-file apps/full-app/.env`.

In the production Docker image, `BORING_AGENT_MODE=vercel-sandbox` splits storage:

```txt
Fly volume:
  /data/workspaces/<workspaceId>   host/control-plane anchor, normally empty in sandbox mode
  /data/pi-sessions/<workspaceId>  durable chat transcripts

Vercel sandbox:
  /workspace                       actual agent cwd, file tree, and shell workspace
```

Do not debug missing sandbox files by looking under `/data/workspaces/<id>`; inspect
the Vercel sandbox `/workspace` instead. Do inspect `/data/pi-sessions/<id>` when
checking whether chat history survives Fly deploy/restart.

After deploy, run `pnpm --filter full-app smoke:post-deploy` (with `DEPLOY_URL` set) to verify the live instance.

## Composition

Depends on `@hachej/boring-core` and `@hachej/boring-workspace` directly; `@hachej/boring-agent` is pulled in transitively as the runtime. `createCoreWorkspaceAgentServer` wires core's auth/workspace layer on top of the workspace + agent server, so this app is the canonical example of all three packages running together.

## License

MIT
