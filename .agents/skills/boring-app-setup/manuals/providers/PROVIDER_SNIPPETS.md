# Boring App Setup — Provider Snippets

Copy-paste cookbook for the most common boring-ui shipping paths.

Deployment framing used in this bundle:

- **generic hosted baseline** → Vercel + managed Postgres + mail transport provider
- **our custom always-on setup** → Fly + managed Postgres + mail transport provider

Use placeholders first. Replace them only when the real provider values exist.

---

## 0. Dedicated sender identity

Optional but recommended for serious production apps:

- sender domain: e.g. `mail.example.com` or `example.com`
- sender address: e.g. `noreply@example.com`

Keep this separate from the transport choice.

Typical env shape:

```bash
MAIL_FROM=noreply@example.com
```

## 1. Generate secrets

```bash
openssl rand -hex 32   # BETTER_AUTH_SECRET
openssl rand -hex 32   # WORKSPACE_SETTINGS_ENCRYPTION_KEY
```

Example export block:

```bash
export BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
export WORKSPACE_SETTINGS_ENCRYPTION_KEY="$(openssl rand -hex 32)"
```

---

## 2. Local dev — Docker Postgres + console mail

### Start local Postgres

```bash
docker run --name boring-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_DB=boring_app \
  -p 5432:5432 \
  -d postgres:16
```

### Local `.env` block

```bash
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info
DATABASE_URL=postgres://postgres:postgres@localhost:5432/boring_app
BETTER_AUTH_SECRET=<paste 64-char hex>
BETTER_AUTH_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
WORKSPACE_SETTINGS_ENCRYPTION_KEY=<paste 64-char hex>
MAIL_FROM=noreply@local.test
MAIL_TRANSPORT_URL=console://
BORING_AGENT_MODE=local
```

Notes:

- `BORING_AGENT_MODE=local` is the Linux/bwrap path.
- On macOS/Windows dev, prefer `BORING_AGENT_MODE=direct`.

### Migrate + boot

```bash
pnpm --filter <slug> migrate
pnpm --filter <slug> dev
```

---

## 3. Generic hosted baseline — Vercel + managed Postgres + mail transport provider

This is the cleanest generic hosted path when you want `vercel-sandbox`.
The example below uses Neon + Resend, but the shape is broader than those exact providers.

### Local env template

```bash
DATABASE_URL=postgres://<neon-connection-string>
BETTER_AUTH_SECRET=<paste 64-char hex>
BETTER_AUTH_URL=https://<app-domain>
CORS_ORIGINS=https://<app-domain>
WORKSPACE_SETTINGS_ENCRYPTION_KEY=<paste 64-char hex>
MAIL_FROM=noreply@<mail-domain>
MAIL_TRANSPORT_URL=resend://<resend-api-key>
BORING_AGENT_MODE=vercel-sandbox
VERCEL_TEAM_ID=<team-id>
VERCEL_PROJECT_ID=<project-id>
# local/CI/non-auto-OIDC only — set one of these when needed:
VERCEL_OIDC_TOKEN=<oidc-token>
# or VERCEL_ACCESS_TOKEN=<token>
# or VERCEL_TOKEN=<token>
```

### Vercel project setup

Run from `apps/<slug>`:

```bash
vercel link
vercel env add DATABASE_URL production
vercel env add BETTER_AUTH_SECRET production
vercel env add BETTER_AUTH_URL production
vercel env add CORS_ORIGINS production
vercel env add WORKSPACE_SETTINGS_ENCRYPTION_KEY production
vercel env add MAIL_FROM production
vercel env add MAIL_TRANSPORT_URL production
vercel env add BORING_AGENT_MODE production
vercel env add VERCEL_TEAM_ID production
vercel env add VERCEL_PROJECT_ID production
vercel pull --yes --environment=production
vercel build --prod && vercel deploy --prebuilt --prod
```

### Domain attachment (optional if not already attached)

```bash
vercel domains add <app-domain>
```

### Important

- Deployed Vercel should use automatic OIDC.
- `VERCEL_TEAM_ID` is required and `VERCEL_PROJECT_ID` is recommended.
- One of `VERCEL_OIDC_TOKEN`, `VERCEL_ACCESS_TOKEN`, or `VERCEL_TOKEN` is for local emulation, CI, or non-auto-OIDC cases.
- For deployed `vercel-sandbox` apps, do not rely on local `.pi/extensions` runtime-plugin assumptions as your shipped architecture. Prefer packaged app/internal plugins.
- If the app depends on `package.json#boring.defaultPluginPackages` via core manifest
  plugin discovery, use the custom Vercel entry described in
  `../../playbooks/EXECUTION_PLAYBOOK.md` and `../app-shape/IMPLEMENTATION_SHAPE.md`
  instead of keeping the stock `src/server/vercel-entry.ts`.

---

## 4. Our custom always-on setup — Fly + managed Postgres + mail transport provider

This is our opinionated/custom always-on server path.
The example below uses Fly + managed Postgres + Resend.
If you intentionally want `BORING_AGENT_MODE=local`, this is the main reference path.
The current `apps/full-app` Docker reference uses `vercel-sandbox` even on Fly, so choose deliberately.

### Env block

```bash
DATABASE_URL=postgres://<managed-postgres-connection-string>
BETTER_AUTH_SECRET=<paste 64-char hex>
BETTER_AUTH_URL=https://<app>.fly.dev
CORS_ORIGINS=https://<app>.fly.dev
WORKSPACE_SETTINGS_ENCRYPTION_KEY=<paste 64-char hex>
MAIL_FROM=noreply@<mail-domain>
MAIL_TRANSPORT_URL=resend://<resend-api-key>
BORING_AGENT_MODE=local
```

### Fly app setup

Run from `apps/<slug>`:

```bash
fly launch --no-deploy
fly volumes create workspace_data --size 10
fly secrets set \
  DATABASE_URL="postgres://<managed-postgres-connection-string>" \
  BETTER_AUTH_SECRET="<paste 64-char hex>" \
  BETTER_AUTH_URL="https://<app>.fly.dev" \
  CORS_ORIGINS="https://<app>.fly.dev" \
  WORKSPACE_SETTINGS_ENCRYPTION_KEY="<paste 64-char hex>" \
  MAIL_FROM="noreply@<mail-domain>" \
  MAIL_TRANSPORT_URL="resend://<resend-api-key>" \
  BORING_AGENT_MODE="local" \
  BORING_AGENT_WORKSPACE_ROOT="/data/workspaces"
fly deploy
```

Also make sure `fly.toml` mounts persistent storage at `/data`.

### Custom domain on Fly

```bash
fly certs add <app-domain>
```

Then update secrets to:

```bash
fly secrets set \
  BETTER_AUTH_URL="https://<app-domain>" \
  CORS_ORIGINS="https://<app-domain>"
```

---

## 5. Our custom always-on setup — Fly + managed Postgres + SMTP provider

Use when the user already has SMTP credentials and intentionally wants the `local` runtime path.

### Env block

```bash
DATABASE_URL=postgres://<managed-postgres-connection-string>
BETTER_AUTH_SECRET=<paste 64-char hex>
BETTER_AUTH_URL=https://<app>.fly.dev
CORS_ORIGINS=https://<app>.fly.dev
WORKSPACE_SETTINGS_ENCRYPTION_KEY=<paste 64-char hex>
MAIL_FROM=noreply@<mail-domain>
MAIL_TRANSPORT_URL=smtps://<user>:<password>@<host>:465
BORING_AGENT_MODE=local
```

### Fly secrets

```bash
fly volumes create workspace_data --size 10
fly secrets set \
  DATABASE_URL="postgres://<managed-postgres-connection-string>" \
  BETTER_AUTH_SECRET="<paste 64-char hex>" \
  BETTER_AUTH_URL="https://<app>.fly.dev" \
  CORS_ORIGINS="https://<app>.fly.dev" \
  WORKSPACE_SETTINGS_ENCRYPTION_KEY="<paste 64-char hex>" \
  MAIL_FROM="noreply@<mail-domain>" \
  MAIL_TRANSPORT_URL="smtps://<user>:<password>@<host>:465" \
  BORING_AGENT_MODE="local" \
  BORING_AGENT_WORKSPACE_ROOT="/data/workspaces"
```

Also make sure `fly.toml` mounts persistent storage at `/data`.

---

## 6. Generic managed Postgres sanity checks

Once you have `DATABASE_URL`:

```bash
psql "$DATABASE_URL" -c 'select 1;'
```

If the app exists already and you want to run migrations locally:

```bash
DATABASE_URL="postgres://<connection-string>" pnpm --filter <slug> migrate
```

If the child app owns extra tables, extend/replace the stock migrate script so this command runs child-app migrations too, not just core migrations.

---

## 7. Resend starter snippets

### Env shape

```bash
MAIL_FROM=noreply@<mail-domain>
MAIL_TRANSPORT_URL=resend://<resend-api-key>
```

### Typical dev/prod split

Dev:

```bash
MAIL_FROM=noreply@local.test
MAIL_TRANSPORT_URL=console://
```

Prod:

```bash
MAIL_FROM=noreply@<mail-domain>
MAIL_TRANSPORT_URL=resend://<resend-api-key>
```

---

## 8. Finalize auth origin values from a domain

Given `APP_URL=https://app.example.com`, the core auth envs should usually be:

```bash
BETTER_AUTH_URL=https://app.example.com
CORS_ORIGINS=https://app.example.com
```

For local dev:

```bash
BETTER_AUTH_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
```

---

## 9. Post-deploy smoke

If the app cloned `full-app`, run:

```bash
DEPLOY_URL=https://<app-domain> pnpm --filter <slug> smoke:post-deploy
```

If the child app owns extra tables, also confirm the deploy/release path runs those app-owned migrations, not just the stock core migrate helper.

Quick HTTP sanity checks:

```bash
curl -i https://<app-domain>/health
curl -i https://<app-domain>/api/v1/capabilities
```

Auth-origin sanity check:

```bash
curl -i \
  -H "Origin: https://<app-domain>" \
  -H "Content-Type: application/json" \
  -X POST https://<app-domain>/auth/sign-in/email \
  --data '{"email":"nobody@example.com","password":"wrong-password"}'
```

The credentials can fail; the point is to catch origin/config breakage early.
