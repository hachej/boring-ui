# full-app

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

The production reference app for boring-ui-v2. Wires together `@hachej/boring-core`, `@hachej/boring-agent`, and `@hachej/boring-workspace` into a deployable shell with Postgres, auth, workspaces, multi-user invites, email flows, and a full IDE workbench.

```bash
git clone https://github.com/hachej/boring-ui.git && cd boring-ui && pnpm install && pnpm --filter full-app dev
```

---

## TL;DR

**The Problem**: You know how boring-ui's individual packages work, but you need a real app — one you can deploy, that has user accounts, Postgres-backed workspaces, team invites with roles, email verification, password reset, and an agent workbench — all running together.

**The Solution**: `full-app` is the canonical production-shaped template. It's the proof that the three packages compose correctly. It ships with Vercel + Fly.io deployment guides, a Dockerfile, a post-deploy smoke test, and Playwright e2e suites.

### Why Use full-app?

| Feature | What It Does |
|---------|--------------|
| **Full auth stack** | Email/password + email verification + password reset + magic links (better-auth) |
| **Workspace management** | CRUD, member roles (owner/editor/viewer), invites with TTL, email notifications |
| **Agent workbench** | Chat, file tree, editor panels, command palette — all wired to the agent runtime |
| **Three deployment targets** | Vercel (Fluid Compute + Firecracker VMs), Fly.io (Docker), Docker (anywhere) |
| **Post-deploy smoke** | Validates signup → email verification → password reset → capabilities in production |
| **Plugin-ready** | Compose workspace plugins via `WorkspaceAgentFront` — ask-user, data-catalog, or your own |

---

## Quick Example

```bash
# Clone and install
git clone https://github.com/hachej/boring-ui.git
cd boring-ui && pnpm install

# Copy env example and fill in real values
cp apps/full-app/.env.example apps/full-app/.env
# Edit .env: DATABASE_URL, BETTER_AUTH_SECRET, MAIL_TRANSPORT_URL, etc.

# Run migrations
pnpm --filter full-app migrate

# Start the dev server
pnpm --filter full-app dev
```

Open `http://localhost:5173`. You get:
- Sign-in / sign-up pages with email flow
- Workspace creation and member invites
- A full agent workbench at `/workspace/:id`
- User profile at `/me`

---

## What's Inside

### Frontend (`src/front/`)

```tsx
import { CoreWorkspaceAgentFront } from '@hachej/boring-core/app/front'
import '@hachej/boring-core/app/front/styles.css'

createRoot(document.getElementById('root')!).render(
  <CoreWorkspaceAgentFront
    apiBaseUrl=""
    apiTimeout={10_000}
    persistenceEnabled
    chatParams={{ thinkingControl: true }}
  />,
)
```

`<CoreWorkspaceAgentFront>` is the one-stop front component from `@hachej/boring-core/app/front`. It bundles `<BoringApp>`, workspace routing, auth, and `<WorkspaceAgentFront>` into a single mount.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Frontend (Vite + React)         │
│                                                  │
│  /auth/*   /me   /workspace/:id                  │
│  signin → workbench → chat + panels + tree      │
│  <CoreWorkspaceAgentFront> mounts it all         │
└──────────────────────┬──────────────────────────┘
                       │ HTTP (cookie auth)
┌──────────────────────▼──────────────────────────┐
│               full-app (Fastify)                 │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │  @hachej/boring-core                     │   │
│  │  ├── better-auth (sessions, email)       │   │
│  │  ├── workspace CRUD + invites + roles    │   │
│  │  ├── capabilities aggregation            │   │
│  │  └── config loader (TOML + env + Zod)   │   │
│  └──────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────┐   │
│  │  @hachej/boring-agent                    │   │
│  │  ├── agent harness (pi-coding-agent)     │   │
│  │  ├── tool catalog (bash, read, write…)   │   │
│  │  └── chat session management             │   │
│  └──────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────┐   │
│  │  Helmets, CORS, rate limits, redaction   │   │
│  └──────────────────────────────────────────┘   │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│              Postgres (Drizzle ORM)              │
│  users · sessions · workspaces · members        │
│  invites · workspaces.runtime · user_settings    │
└──────────────────────────────────────────────────┘
```

---

## Installation

### Prerequisites

- **Node.js** ≥ 18
- **pnpm** ≥ 8
- **Postgres** (local or cloud — Neon, Supabase, Supavisor, etc.)

### From Source

```bash
git clone https://github.com/hachej/boring-ui.git
cd boring-ui && pnpm install
```

### Docker

```bash
docker build -f apps/full-app/Dockerfile -t boring-full-app .
docker run --rm -p 3000:3000 --env-file apps/full-app/.env boring-full-app
```

---

## Quick Start

### 1. Environment

```bash
cp apps/full-app/.env.example apps/full-app/.env
```

Required variables:
```bash
DATABASE_URL=postgres://...
BETTER_AUTH_SECRET=<64-char hex>
BETTER_AUTH_URL=http://localhost:3000
WORKSPACE_SETTINGS_ENCRYPTION_KEY=<32-byte hex>
MAIL_FROM=noreply@yourapp.dev
MAIL_TRANSPORT_URL=console://    # dev: logs to stdout
```

### 2. Migrate

```bash
pnpm --filter full-app migrate
```

### 3. Run

```bash
pnpm --filter full-app dev
```

Frontend: `http://localhost:5173`

### 4. Build + Start (production)

```bash
pnpm --filter full-app build
pnpm --filter full-app start
```

Production listens on `PORT` (default `3000`).

---

## Deployment

### Vercel (recommended for remote execution)

```bash
cd apps/full-app
vercel link
vercel env add DATABASE_URL production
vercel env add BETTER_AUTH_SECRET production
vercel env add BETTER_AUTH_URL production
vercel env add MAIL_TRANSPORT_URL production
vercel pull --yes --environment=production
vercel build --prod && vercel deploy --prebuilt --prod
```

**Key config:**
- `maxDuration: 300` (requires Vercel plan with 300s functions)
- `BORING_AGENT_MODE=vercel-sandbox` (default on Vercel — Firecracker microVMs)
- Sandbox handles persisted in Postgres runtime store, not `/tmp`

### Fly.io (recommended for local/bwrap mode)

```bash
fly launch --no-deploy
fly secrets set DATABASE_URL=... BETTER_AUTH_SECRET=... \
  BETTER_AUTH_URL=https://<app>.fly.dev MAIL_TRANSPORT_URL=...
fly deploy
```

**Key config:**
- Docker-based, always-on
- `BORING_AGENT_MODE=local` for bwrap sandboxing
- Full Postgres-backed workspace management

### Docker (anywhere)

```bash
docker build -f apps/full-app/Dockerfile -t boring-full-app .
docker run --rm -p 3000:3000 --env-file apps/full-app/.env boring-full-app
```

---

## Smoke Testing

### Local e2e

```bash
pnpm --filter full-app e2e:smoke
```

Validates:
- App boot
- Sign-in flow (`dev@local`)
- `/workspace/:id` route load

### Post-deploy smoke (against a live URL)

```bash
DEPLOY_URL=https://<your-app>.fly.dev \
pnpm --filter full-app smoke:post-deploy
```

**Enhanced with real mail verification:**
```bash
RESEND_API_KEY=<key> \
AGENTMAIL_API_KEY=<key> \
DEPLOY_URL=https://<your-app>.fly.dev \
pnpm --filter full-app smoke:post-deploy
```

| Check | What It Validates |
|-------|-------------------|
| `GET /health` | Server responds 200 within 10s |
| Sign-up | Creates user account |
| Email verification | Finds verification link in email |
| Forgot-password | Sends real reset email + consumes token + new password works |
| `GET /api/v1/capabilities` | Returns 200 with `agent` key |

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Postgres connection string |
| `BETTER_AUTH_SECRET` | Yes | Session signing key (64-char hex) |
| `BETTER_AUTH_URL` | Yes | Public app URL |
| `WORKSPACE_SETTINGS_ENCRYPTION_KEY` | Yes | Workspace settings encryption key |
| `MAIL_FROM` | Yes (prod) | Email sender address |
| `MAIL_TRANSPORT_URL` | Yes (prod) | `resend://key`, `smtp://...`, or `console://` |
| `PORT` | No | Server port (default 3000) |
| `BORING_AGENT_MODE` | No | `direct`, `local`, or `vercel-sandbox` |
| `ANTHROPIC_API_KEY` | Yes (prod) | Claude API key |
| `BORING_AGENT_DEFAULT_MODEL_PROVIDER` | No | Override default provider |
| `BORING_AGENT_DEFAULT_MODEL_ID` | No | Override default model |

---

## How full-app Compares

| Feature | full-app | Custom Express app | Next.js app |
|---------|----------|--------------------|-------------|
| Auth flows | ✅ email + reset + magic links | ❌ Build yourself | ⚠️ NextAuth (different UX) |
| Workspace management | ✅ CRUD + invites + roles | ❌ Build yourself | ❌ Build yourself |
| Agent integration | ✅ Pi harness + tool catalog | ❌ Manual | ❌ Manual |
| Multi-tenant safe | ✅ Workspace-scoped routes + guards | ❌ DIY | ❌ DIY |
| Deployment guides | ✅ Vercel + Fly.io + Docker | ⚠️ Whatever you choose | ✅ Vercel only |
| Post-deploy smoke | ✅ signup → email → reset → capabilities | ❌ DIY | ❌ DIY |

**When to use full-app:**
- You're building a multi-user agent app and want a working starting point
- You need to see how core + agent + workspace compose in the real world
- You want deployable templates (Vercel or Fly.io) with smoke tests

**When it might not fit:**
- You just want to try the agent quickly (use `npx @hachej/boring-ui-cli`)
- You only need the workbench (use `apps/workspace-playground`)
- You only need the agent (use `apps/agent-playground`)
- You want to build your own auth/workspace stack from scratch (import `@hachej/boring-core` subpaths directly)

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `database connection refused` | Postgres not running or wrong URL | Check `DATABASE_URL` and network access |
| `migration failed` | Schema mismatch or missing tables | Run `pnpm --filter full-app migrate` before first boot |
| `sign-up succeeds but no verification email` | Mail transport not configured | Set `MAIL_TRANSPORT_URL=console://` for dev logs |
| `workspace/:id` 403 | User not member of workspace | Create workspace first from `/me`, or seed a default |
| `agent chat 500` | Missing `ANTHROPIC_API_KEY` | Set the env var and restart |
| `vercel function timeout` | Long agent response hitting limit | Check `maxDuration` in `vercel.json` (plan must support it) |

---

## Limitations

- **Private app template** — Not a published npm package. Clone from the monorepo and adapt.
- **Opinionated stack** — Postgres + Drizzle + better-auth + Fastify. Swapping any layer requires code changes.
- **Vercel maxDuration** — Agent chat can timeout on lower-tier Vercel plans. The `maxDuration: 300` setting requires a plan that supports 5-minute functions.
- **No GitHub OAuth** — Deferred to v1.x. Email/password + magic links only.
- **No billing/Stripe** — Multi-tenant billing is future `@boring/cloud` territory.
- **Single language server** — No LSP integration. The editor (CodeMirror6) has syntax highlighting but no semantic features.

---

## FAQ

**Q: Do I need to run migrations every time I deploy?**  
A: Yes, run `pnpm --filter full-app migrate` before the first boot after a schema change. It's idempotent — safe to run on every deploy.

**Q: Can I use this without Postgres?**  
A: Not in production. For dev, you can set `CORE_STORES=local` in the core config to use in-memory stores, but state resets on restart.

**Q: What's the difference between `dev.ts` and `main.ts`?**  
A: `dev.ts` rebuilds all workspace packages before each run for HMR. `main.ts` is the production entrypoint that runs pre-built artifacts.

**Q: How do I add custom plugins to full-app?**  
A: The frontend uses `<CoreWorkspaceAgentFront>` which is a composed component. For custom plugins, import `WorkspaceAgentFront` from `@hachej/boring-workspace/app/front` and compose your own front mount with `plugins={[...]}`.

**Q: Can I deploy full-app to Render or Railway?**  
A: Yes — both support Docker + Postgres. Use the Dockerfile and set the required env vars. The app is 12-factor.

---

*About Contributions:* Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. I'd also have to worry about other "stakeholders," which seems unwise for tools I mostly make for myself for free. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings. I understand this isn't in sync with the prevailing open-source ethos that seeks community contributions, but it's the only way I can move at this velocity and keep my sanity.

---

## License

MIT
