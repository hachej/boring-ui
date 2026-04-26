# full-app

Reference app wiring for `@boring/core` + `@boring/agent` + `@boring/workspace`.

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
