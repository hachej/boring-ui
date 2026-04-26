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

3. Run DB migrations (before app boot):

```bash
pnpm --dir packages/core drizzle:migrate
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

Recommended env for reliable email verification polling:

```bash
SMOKE_EMAIL_DOMAIN=<resend-verified-domain>   # or set SMOKE_EMAIL explicitly
RESEND_API_KEY=<resend-api-key>
```

Checks:
- `GET /health` returns `200` + `{ ok: true }` within 10s
- signup endpoint succeeds (`/api/auth/sign-up/email` or `/auth/sign-up/email`)
- verification link is found (signup response payload or Resend inbox polling when `RESEND_API_KEY` is set)
- `GET /api/v1/capabilities` returns `200` and includes `agent` key

This is also wired into GitHub Actions via `.github/workflows/post-deploy-smoke.yml` (workflow_dispatch or repository_dispatch).

## Docker

```bash
docker build -f apps/full-app/Dockerfile -t boring-full-app .
docker run --rm -p 3000:3000 --env-file apps/full-app/.env boring-full-app
```

## Fly.io Walkthrough

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
