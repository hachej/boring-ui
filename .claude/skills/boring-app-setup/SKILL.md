---
name: boring-app-setup
description: Customize and deploy a child app built on @boring/core. Covers theme/branding/auth-page overrides, custom routes/panes, and end-to-end deployment to a PaaS (Neon + Resend + Fly/Render/Railway).
---

# /boring-app-setup — child app customization + deployment

> Use this skill when scaffolding a new app on top of `@boring/core` + `@boring/workspace` + `@boring/agent`, or when shipping an existing app to production.
>
> The skill assumes you have the three packages built (or installed via workspace deps). For the canonical package contracts read `packages/core/docs/CORE.md`.

---

## Quick path — "I just want to ship"

```bash
# 1. Install
pnpm add @boring/core @boring/workspace fastify react react-dom react-router-dom

# 2. Scaffold child app from the reference
cp -r apps/full-app apps/my-app
cd apps/my-app

# 3. Sign up for two services (free tiers OK)
#    - Neon: https://neon.tech → create project → copy DATABASE_URL
#    - Resend: https://resend.com → create API key → verify your sending domain

# 4. Generate secrets
echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" >> .env
echo "WORKSPACE_SETTINGS_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env

# 5. Edit boring.app.toml with your branding (see Part 1 below)

# 6. Migrate + run
pnpm drizzle-kit migrate --config node_modules/@boring/core/drizzle.config.ts
pnpm dev
```

That's it locally. For deployment, see Part 2.

---

## Part 1 — Customization

A child app customizes a `@boring/core` app at five layers, in order of cost-to-change:

| Layer | What | Where |
|---|---|---|
| 1. Tokens (CSS vars) | Brand colors, radii, fonts | `src/front/tokens.css` |
| 2. Branding | App name, logo, favicon | `boring.app.toml` |
| 3. Auth-page overrides | Custom sign-in/up/reset UI | `<BoringApp authPages={...}>` |
| 4. Routes | Add your own pages | `<BoringApp>` children |
| 5. Panes | Custom workspace panels | `@boring/workspace` PanelRegistry |

### 1.1 — Token overrides (the cheapest customization)

Core ships `@boring/core/theme.css` which defines shadcn token names (`--primary`, `--background`, `--ring`, `--radius`, …) bound to internal `--color-*` vars. **You override the shadcn names; never the `--color-*` internals.**

```css
/* src/front/tokens.css — drop ANY shadcn theme here */
:root {
  --primary: 220 90% 56%;          /* HSL — your brand blue */
  --primary-foreground: 0 0% 100%;
  --background: 0 0% 100%;
  --foreground: 222 47% 11%;
  --radius: 0.5rem;
}

[data-theme="dark"] {
  --primary: 220 90% 66%;
  --background: 222 47% 11%;
  --foreground: 0 0% 100%;
}
```

```tsx
// src/front/main.tsx
import '@boring/core/theme.css'   // base token definitions
import './tokens.css'              // YOUR overrides (loaded after, wins by source order)
```

Every shadcn primitive in `@boring/workspace/ui-shadcn` and core's auth pages picks up the new tokens automatically. **Never touch the `--color-*` vars directly** — those are internal.

### 1.2 — Branding via `boring.app.toml`

```toml
[app]
id = "acme-prod"                  # used in workspace_members.appId; pick something stable

[frontend.branding]
name = "Acme"
logo = "/logo.svg"                # served from STATIC_DIR
favicon = "/favicon.ico"

[frontend.theme]
default = "system"                # "light" | "dark" | "system"

[features]
github_oauth = false              # v1: keep false (deferred to v1.x)
invites_enabled = true
sendWelcomeEmail = true           # post-signup welcome email; turn off if you have onboarding
```

The branding is served at `GET /api/v1/config` and read by `<ConfigProvider>` on the frontend. `appName` shows in `<UserMenu>` headers, email subjects, and auth pages.

### 1.3 — Auth-page overrides

Core ships defaults for all 5 auth pages (`<SignInPage>`, `<SignUpPage>`, `<ForgotPasswordPage>`, `<ResetPasswordPage>`, `<VerifyEmailPage>`). Override individually:

```tsx
import { BoringApp } from '@boring/core/front'
import { MyBrandedSignIn } from './pages/MySignIn'

<BoringApp
  authPages={{
    signIn: MyBrandedSignIn,
    // omit a key → core's default still applies
  }}
>
  {/* your routes */}
</BoringApp>
```

Your override receives `{ onSubmit, error, isPending, inviteToken? }` via React context — render whatever UI you want, just call `onSubmit` with the form values. See `packages/core/docs/CORE.md` §Sign-in / sign-up / reset / verify pages.

### 1.4 — Custom routes

`<BoringApp>` mounts `<BrowserRouter>` and a default route map (`/auth/*`, `/me`). Pass additional `<Route>` children for your own pages:

```tsx
<BoringApp>
  <Route path="/" element={<Dashboard />} />
  <Route path="/billing" element={<BillingPage />} />
  <Route path="/workspace/:id" element={<WorkspaceRoute />} />
</BoringApp>
```

`<AuthGate>` (inside `BoringApp`) redirects unauthenticated users to `/auth/signin` for any non-public route — no extra wiring needed.

### 1.5 — Custom panes (workspace customization)

`@boring/workspace` ships an `IdeLayout` with built-in panes (FileTree, ChatPanel from agent, MarkdownEditor, CodeEditor). Add your own:

```tsx
import { WorkspaceProvider, IdeLayout } from '@boring/workspace'
import { useParams } from 'react-router-dom'
import { MyBillingPanel } from './panels/MyBillingPanel'

function WorkspaceRoute() {
  const { id } = useParams<{ id: string }>()
  return (
    <WorkspaceProvider
      workspaceId={id!}
      panels={[
        { id: 'billing', component: MyBillingPanel, placement: 'right', label: 'Billing' },
      ]}
    >
      <IdeLayout />
    </WorkspaceProvider>
  )
}
```

Your panel component receives the standard pane props (workspaceId, store hooks). See `packages/workspace/docs/plans/WORKSPACE_V2_PLAN.md` for the full pane registry contract.

### 1.6 — Capabilities contributor (advanced — feature flags for your app)

If your app has feature flags or capability gates that the frontend should respect, register a contributor at boot:

```ts
// src/server/main.ts
const app = await createCoreApp(config)

app.registerCapabilitiesContributor('myApp', (ctx) => ({
  myApp: {
    billingEnabled: process.env.STRIPE_KEY != null,
    plan: ctx.config.appId === 'acme-pro' ? 'pro' : 'free',
  },
}))
```

The frontend reads via `useCapabilities()`:

```tsx
const caps = useCapabilities()
if (caps.myApp?.billingEnabled) { ... }
```

---

## Part 2 — Deployment

Target shape: **long-running Docker container on a PaaS** (Fly.io / Render / Railway). See `packages/core/docs/CORE.md` §Deployment for the full spec; this section is the operational checklist.

### 2.1 — Pre-deploy checklist

**For boring-ui-v2 specifically: vault already has everything. No new accounts to create.** Skip generic Neon/Resend signup and go straight to §2.2.

For a brand-new app on top of `@boring/core`:

- [ ] Sign up for **Neon** (https://neon.tech) OR **Supabase** OR any managed Postgres → copy the **pooled** `DATABASE_URL`.
- [ ] Sign up for **Resend** (https://resend.com) → API Keys → create one. (Quick path: use Resend's `onboarding@resend.dev` sandbox sender for first deploy — no DNS setup needed; flip to a real domain later.)
- [ ] If using a real domain: verify it in Resend (DNS records). `MAIL_FROM` becomes `noreply@yourverifieddomain.com`.
- [ ] Generate two 32-byte secrets:
  ```bash
  openssl rand -hex 32   # → BETTER_AUTH_SECRET
  openssl rand -hex 32   # → WORKSPACE_SETTINGS_ENCRYPTION_KEY
  ```
  Store them in a password manager or vault. **They cannot be rotated without consequences** (encryption key rotation breaks decrypt for old workspace settings).
- [ ] Decide your deployed URL: `https://app.example.com`. Configure DNS later.

### 2.2 — Production env var checklist

**⚠️ These three are the most commonly missed — without them, browser signup fails with "Invalid origin" even though curl smoke tests pass (curl sends no Origin header):**

```
BETTER_AUTH_URL=https://your-app.fly.dev    # exact deployed URL, https, no trailing slash
CORS_ORIGINS=https://your-app.fly.dev       # same value; comma-separate if multiple
BETTER_AUTH_SECRET=<32-byte hex>            # sessions are invalid if this changes
```

For **boring-macro-v2 specifically**, source from vault:

```bash
fly secrets set \
  DATABASE_URL=$(vault kv get -field=database_url secret/agent/app/boring-macro/prod) \
  BETTER_AUTH_SECRET=$(vault kv get -field=session_secret secret/agent/app/boring-macro/prod) \
  WORKSPACE_SETTINGS_ENCRYPTION_KEY=$(vault kv get -field=settings_key secret/agent/app/boring-macro/prod) \
  BETTER_AUTH_URL=https://boring-macro.fly.dev \
  CORS_ORIGINS=https://boring-macro.fly.dev \
  --app boring-macro
```

For **a generic child app**:

```bash
DATABASE_URL=postgres://...                # your Postgres (Neon, Supabase, RDS, …)
BETTER_AUTH_SECRET=<32-byte hex>           # generated
BETTER_AUTH_URL=https://app.example.com    # your URL — must be https, no trailing slash
WORKSPACE_SETTINGS_ENCRYPTION_KEY=<32-byte hex>
CORS_ORIGINS=https://app.example.com       # exact match to browser Origin; no trailing slash
MAIL_FROM=onboarding@resend.dev            # sandbox; flip to your domain when verified
MAIL_TRANSPORT_URL=resend://re_xxxxxx
PORT=3000                                  # platform sets this automatically
NODE_ENV=production
LOG_LEVEL=info

# GitHub OAuth (optional — set GITHUB_OAUTH=true to enable the sign-in button):
# GITHUB_CLIENT_ID=<from github>
# GITHUB_CLIENT_SECRET=<from github>
# GITHUB_OAUTH=true
```

### 2.3a — First-deploy schema reset (boring-ui-v2 only)

The Neon DB at `secret/agent/app/boring-ui/prod.database_url` previously hosted v1. v2 has a different schema. **One-time** before first v2 deploy:

```bash
# Connect to the existing Neon DB and drop the v1 schema
DATABASE_URL=$(vault kv get -field=database_url secret/agent/app/boring-ui/prod) \
  psql "$DATABASE_URL" -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

# Then proceed with migrations (§2.3b)
```

⚠️ **Destructive**. Only run when v2 is replacing v1 in the same Neon project. The user has explicitly authorized this for v2's first deploy.

### 2.3b — Migrations: release-phase pattern

Migrations MUST run before the web service serves traffic. Two patterns:

**Pattern A — release_command (recommended, Fly.io):**

```toml
# fly.toml
[deploy]
release_command = "node dist/server/migrate.js"
```

`migrate.js` calls `runMigrations(config)` exported from `@boring/core/server` and exits. Fly runs this before swapping the live web instance.

**Pattern B — in-process at boot (Railway, simple setups):**

```ts
// src/server/main.ts
import { runMigrations, createCoreApp, loadConfig } from '@boring/core/server'

const config = await loadConfig()
await runMigrations(config)   // advisory-locked; safe across replicas
const app = await createCoreApp(config)
await app.listen({ port: config.port })
```

Pattern A is preferred for >1 replica; Pattern B is fine for single-replica.

### 2.4 — Reference Dockerfile

Core ships `packages/core/Dockerfile.reference`. Your child app can extend or copy:

```dockerfile
FROM node:20-slim AS base
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/ packages/
COPY apps/ apps/
RUN pnpm install --frozen-lockfile && pnpm -r build
EXPOSE 3000
CMD ["node", "apps/my-app/dist/server/main.js"]
```

### 2.5 — Platform-specific quickstarts

#### Fly.io

```bash
fly launch --no-deploy                   # generates fly.toml from your Dockerfile
fly secrets set DATABASE_URL=... BETTER_AUTH_SECRET=... WORKSPACE_SETTINGS_ENCRYPTION_KEY=... \
  BETTER_AUTH_URL=https://my-app.fly.dev MAIL_FROM=... MAIL_TRANSPORT_URL=resend://... \
  CORS_ORIGINS=https://my-app.fly.dev
fly deploy
fly logs                                 # verify boot
```

In `fly.toml`, set `release_command = "node dist/server/migrate.js"` for the migration pattern.

#### Render

1. New Web Service → connect GitHub repo.
2. Build command: `pnpm install && pnpm -r build`.
3. Start command: `node apps/my-app/dist/server/main.js`.
4. Env vars: paste from §2.2 above (one at a time in dashboard).
5. Add a "Pre-Deploy Command": `node apps/my-app/dist/server/migrate.js`.

#### Railway

1. New Project → Deploy from GitHub.
2. Variables: paste from §2.2.
3. Use Pattern B (in-process migrations) or add a separate "migrate" service running once before the web service.

### 2.6 — Health checks (PaaS liveness)

Configure your platform's health probe to hit `/health`:

- **Path**: `/health`
- **Interval**: 5 seconds
- **Timeout**: 3 seconds
- **Retries**: 3
- **Initial delay**: 30 seconds (lets migrations finish)

Returns `200 { ok: true }` when DB is reachable; `503 { error, code: 'db_unavailable' }` when not.

### 2.7 — Post-deploy smoke

After first deploy, run the smoke test script:

```bash
# from repo root — pass the deployed URL
APP_URL=https://boring-macro.fly.dev pnpm --filter @boring/macro run smoke
# or directly:
node scripts/smoke.mjs https://boring-macro.fly.dev
```

The script tests:
- `/health` → 200
- `/ready` → 200
- `/` → 200 (SPA shell)
- `POST /auth/sign-up/email` WITH `Origin: <url>` header → 200 (catches CORS misconfiguration that bare curl misses)
- `POST /auth/sign-in/email` WITH `Origin: <url>` header → 200
- `GET /auth/get-session` with session cookie → 200 with user object
- `GET /api/v1/agent/catalog` → 401 (auth guard active)

**⚠️ The Origin header is critical.** Browsers always send it; curl does not. A smoke test without it will pass even when real signups return "Invalid origin".

### 2.8 — Common deployment issues

| Symptom | Cause | Fix |
|---|---|---|
| "Invalid origin" on signup in browser (curl works fine) | `BETTER_AUTH_URL` or `CORS_ORIGINS` not set / wrong | Set both to the exact deployed URL (`https://app.fly.dev`, no trailing slash). Curl has no Origin header so it bypasses the check — always smoke test with `-H "Origin: https://app.fly.dev"` |
| 500 on signup, logs say `relation "users" does not exist` | DB missing auth tables — migrations never ran | `main.ts` must call `runCoreMigrationsFromEnv()` before `app.listen()`, or use Fly `release_command` |
| 503 from `/health` immediately after deploy | Migration didn't finish | Increase initial-delay to 60s; check release-phase logs |
| Verification emails not arriving | Domain not verified in Resend | Add DKIM/SPF DNS records; wait for verification |
| 401 on every request | `BETTER_AUTH_URL` ≠ deployed URL | Cookies are scoped by URL; must match exactly (incl. https://) |
| 500 on signup | Mail transport failure | Check Resend dashboard for the failed send; rotate API key if needed |
| CSP violations in browser console | Strict CSP blocked an inline script/style | Read core's CSP rules in CORE.md §M6; extend via `CoreConfig.helmet` |
| CORS failures | `CORS_ORIGINS` mismatch | Must match the browser's origin EXACTLY (no trailing slash, exact protocol) |
| GitHub OAuth: "Provider not found" | `GITHUB_OAUTH=true` not set | Set env var `GITHUB_OAUTH=true` alongside `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` |

### 2.9 — Backups + secrets rotation

- **DB backups**: Neon does daily snapshots free; for self-hosted Postgres, use `pg_dump` cron.
- **`BETTER_AUTH_SECRET` rotation**: invalidates all sessions (users sign in again). Acceptable for security incidents.
- **`WORKSPACE_SETTINGS_ENCRYPTION_KEY` rotation**: breaks decrypt for old workspace_settings rows. Per CORE.md §DB §Encrypted settings, decrypt failure returns `configured: false` (no throw). Operator must re-encrypt on rotation via a one-shot script.
- **OAuth client secrets** (when GitHub OAuth ships in v1.x): rotate via the OAuth app dashboard; users keep their sessions because secrets are server-only.

---

## When to NOT use this skill

- Building a new package inside the `boring-ui-v2` monorepo (use `/planning-workflow` + `/beads-workflow` instead).
- Modifying `@boring/core` itself (read CORE.md and follow the existing bead workflow).
- Deploying serverless / Lambda / edge — not supported in v1 (CORE.md §Deployment §Not in v1).

## References

| Topic | File |
|---|---|
| Canonical core spec | `packages/core/docs/CORE.md` |
| Workspace customization | `packages/workspace/docs/plans/WORKSPACE_V2_PLAN.md` |
| Agent customization | `packages/agent/docs/plans/agent-package-spec.md` |
| Repo conventions | `AGENTS.md` |
