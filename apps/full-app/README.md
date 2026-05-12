# full-app

Reference app wiring for `@boring/core` + `@boring/agent` + `@boring/workspace`. This is the production-ready template — see [`packages/core/docs/CORE.md`](../../packages/core/docs/CORE.md) for the full spec ([Quickstart](../../packages/core/docs/CORE.md#quickstart), [Deployment](../../packages/core/docs/CORE.md#deployment)).

## Run Locally

1. Install workspace deps:

```bash
pnpm install
```

2. Configure env:

```bash
cp apps/full-app/.env.example apps/full-app/.env
```

Update `.env` with real values for:
- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `WORKSPACE_SETTINGS_ENCRYPTION_KEY`
- `BETTER_AUTH_URL`

Optional model default:
- `BORING_AGENT_DEFAULT_MODEL_PROVIDER` + `BORING_AGENT_DEFAULT_MODEL_ID`
- For Infomaniak OpenAI-compatible chat, set `INFOMANIAK_API_TOKEN`, `BORING_AGENT_INFOMANIAK_PRODUCT_ID`, and `BORING_AGENT_INFOMANIAK_MODEL`

Optional Vercel sandbox lifetime:
- `BORING_AGENT_VERCEL_SANDBOX_TIMEOUT_MS` controls new sandbox auto-stop timeout. Vercel currently rejects values above `2700000`.
- Dirty `vercel-sandbox` workspaces snapshot every 10 minutes; `BORING_AGENT_SNAPSHOT_KEEP` controls retained snapshots and defaults to `2`.

3. Run DB migrations (before app boot):

```bash
pnpm --filter full-app migrate
```

4. Start the app:

```bash
pnpm --filter full-app dev
```

Frontend: `http://localhost:5173`

## Build + Start

```bash
pnpm --filter full-app build
pnpm --filter full-app start
```

Production server listens on `PORT` (default `3000`).

## Smoke Test

```bash
pnpm --filter full-app e2e:smoke
```

The smoke test validates app boot, sign-in flow (`dev@local`), and `/workspace/:id` route load.

## Post-Deploy Smoke

Run against a deployed URL:

```bash
DEPLOY_URL=https://<your-app>.fly.dev \
pnpm --filter full-app smoke:post-deploy
```

Recommended env for reliable email verification + password reset polling:

```bash
RESEND_API_KEY=<resend-api-key>      # proves the real Resend send happened
AGENTMAIL_API_KEY=<agentmail-key>    # creates/uses a real @agentmail.to inbox and proves delivery
# Optional when reusing an inbox instead of creating one per run:
AGENTMAIL_INBOX_ID=<inbox-id>
AGENTMAIL_EMAIL=<inbox-address>
# Or bypass AgentMail and target a known verified recipient/domain:
SMOKE_EMAIL_DOMAIN=<resend-verified-domain>   # ignored when AGENTMAIL_API_KEY is set and SMOKE_EMAIL is unset
SMOKE_EMAIL=<recipient@example.com>            # explicit recipient override
```

Checks:
- `GET /health` returns `200` + `{ ok: true }` within 10s
- signup endpoint succeeds (`/api/auth/sign-up/email` or `/auth/sign-up/email`)
- verification link is found (signup response payload or Resend polling when `RESEND_API_KEY` is set)
- forgot-password sends a real reset email; when both `RESEND_API_KEY` and `AGENTMAIL_API_KEY` are set, smoke requires both Resend sent-mail visibility and AgentMail inbox receipt
- reset token is consumed, new password signs in, and old password is rejected
- `GET /api/v1/capabilities` returns `200` and includes `agent` key

This is also wired into GitHub Actions via `.github/workflows/post-deploy-smoke.yml` (workflow_dispatch or repository_dispatch).

## Docker

```bash
docker build -f apps/full-app/Dockerfile -t boring-full-app .
docker run --rm -p 3000:3000 --env-file apps/full-app/.env boring-full-app
```

## Vercel Walkthrough

`full-app` can run on Vercel as a thin Node/Fluid Compute orchestrator while agent commands and workspace files run inside Vercel Sandbox Firecracker microVMs.

1. Link the app from this directory:

```bash
cd apps/full-app
vercel link
```

2. Configure required production env:

```bash
vercel env add DATABASE_URL production
vercel env add BETTER_AUTH_SECRET production
vercel env add WORKSPACE_SETTINGS_ENCRYPTION_KEY production
vercel env add BETTER_AUTH_URL production # https://<your-app>.vercel.app
vercel env add MAIL_FROM production
vercel env add MAIL_TRANSPORT_URL production
vercel env add VERCEL_TEAM_ID production
vercel env add VERCEL_PROJECT_ID production
```

Set `BORING_AGENT_MODE=vercel-sandbox` if you want it explicit; the Vercel handler defaults to that mode. Production on Vercel should use Vercel OIDC automatically. For local Vercel emulation, use `vercel link && vercel env pull` or set `VERCEL_TOKEN`.

3. Run migrations against the production database before first traffic:

```bash
pnpm --filter full-app migrate
```

4. Deploy:

```bash
cd apps/full-app
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod
```

5. Verify:

```bash
curl https://<your-app>.vercel.app/health
DEPLOY_URL=https://<your-app>.vercel.app pnpm --filter full-app smoke:post-deploy
```

Notes:

- `maxDuration: 300` assumes a Vercel plan that supports 300 second Node functions. Lower it in `vercel.json` for smaller plan limits.
- The Vercel function does not execute untrusted code. It forwards agent filesystem and shell work to `vercel-sandbox` mode.
- Sandbox handles are persisted through core's Postgres workspace runtime store, not the function filesystem.
- The function uses `/tmp/boring-workspaces` only as ephemeral host scratch space; real workspace state belongs in Vercel Sandbox.

## Fly.io Walkthrough

Fly remains a Docker fallback for always-on deployments or local `bwrap` mode.

1. Launch app shell:

```bash
fly launch --no-deploy
```

2. Set required secrets:

```bash
fly secrets set \
  DATABASE_URL=... \
  BETTER_AUTH_SECRET=... \
  WORKSPACE_SETTINGS_ENCRYPTION_KEY=... \
  BETTER_AUTH_URL=https://<your-app>.fly.dev \
  MAIL_FROM=... \
  MAIL_TRANSPORT_URL=...
```

3. Deploy:

```bash
fly deploy
```

4. Verify:

```bash
curl https://<your-app>.fly.dev/health
```

See `packages/core/docs/CORE.md` for full deployment requirements and runtime topology.
