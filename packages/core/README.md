# @hachej/boring-core

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm](https://img.shields.io/npm/v/@hachej/boring-core.svg)](https://www.npmjs.com/package/@hachej/boring-core)

</div>

The foundation package for boring-ui apps: Postgres/Drizzle database schema, email/password auth (better-auth), config loader, Fastify HTTP app factory, and React frontend shell. Every child app imports core first.

```bash
curl -fsSL https://raw.githubusercontent.com/hachej/boring-ui/main/scripts/install-core.sh | bash
```

---

## TL;DR

**The Problem**: Building a multi-user agent-powered app means re-implementing auth, sessions, workspaces, invites, email flows, and an app shell every single time. These are the same across every deployment.

**The Solution**: `@hachej/boring-core` provides a complete app skeleton — Postgres DB, better-auth with email verification + password reset + magic links, workspace membership with roles, email transport (Resend/SMTP/console), and a `<BoringApp>` React shell with auth pages. You bring the domain logic.

### Why Use @hachej/boring-core?

| Feature | What It Does |
|---------|--------------|
| **Full auth suite** | Email/password + email verification + password reset + magic links (better-auth) |
| **Workspace management** | Create, update, delete workspaces; member roles (owner/editor/viewer); invites |
| **Fastify app factory** | Pre-wired with helmet, CORS, rate limiting, secret redaction, graceful shutdown |
| **Drizzle + Postgres** | Ready-to-run schema for users, workspaces, members, invites, settings |
| **Email transport** | Resend (default), SMTP, or console — pluggable via URL scheme |
| **<BoringApp> shell** | Client-rendered React shell with auth gate, theme toggle, workspace switcher |
| **Config loader** | TOML + env vars merged, Zod-validated, redacted for frontend |

---

## Quick Example

```ts
// Server — 4 lines to a full app
import { createCoreApp, loadConfig } from "@hachej/boring-core/server"

const config = await loadConfig()
const app = await createCoreApp(config)  // Fastify + DB + auth + routes

await app.listen({ port: 3000 })
```

```tsx
// Frontend — mount auth gate + workspace routing
<BoringApp>
  <Route path="/workspace/:id" element={<WorkspaceRoute />} />
  <Route path="/settings" element={<Settings />} />
</BoringApp>
```

```tsx
// In your components — typed auth + workspace access
const user = useUser()
const workspace = useCurrentWorkspace()
const role = useWorkspaceRole()  // 'owner' | 'editor' | 'viewer'
```

---

## Design Philosophy

1. **Core owns persistence and identity** — DB tables, auth, sessions, workspaces, invites. Everything else injects stores via interfaces.
2. **One config source** — `boring.app.toml` + environment variables merged, Zod-validated at boot. No scattered config.
3. **Email flows are real, not stubs** — password reset, email verification, magic links, workspace invites — all shipped with React Email templates.
4. **Swap seams, not rewrites** — `AuthProvider`, `UserStore`, `WorkspaceStore` are interfaces. The default impl is Postgres; swap via `createCoreApp({ authProvider })`.
5. **Fail closed on auth** — config fetch failure throws a `ConfigFetchError` with retries. Users see "Cannot reach server" not a blank page.

---

## Installation

```bash
# pnpm
pnpm add @hachej/boring-core @hachej/boring-workspace

# npm
npm install @hachej/boring-core @hachej/boring-workspace

# from source
git clone https://github.com/hachej/boring-ui.git
cd boring-ui && pnpm install
pnpm --filter @hachej/boring-core build
```

### Dependencies

Postgres is required for production. For dev, set `CORE_STORES=local` and core runs in-memory (state resets on restart).

---

## Quick Start

### 1. Set Environment

```bash
# .env
DATABASE_URL=postgres://user:pass@localhost:5432/myapp
BETTER_AUTH_SECRET=<32-byte random hex>
BETTER_AUTH_URL=http://localhost:3000
WORKSPACE_SETTINGS_ENCRYPTION_KEY=<32-byte hex>
MAIL_FROM=noreply@myapp.dev
MAIL_TRANSPORT_URL=resend://re_xxxxxxxxxxxxxxxx
```

### 2. Create Config File

```toml
# boring.app.toml
[app]
id = "my-app"

[frontend.branding]
name = "My App"
logo = "/logo.svg"

[features]
invites_enabled = true
invite_ttl_days = 7
```

### 3. Run Migrations

```bash
pnpm drizzle-kit generate --config node_modules/@hachej/boring-core/drizzle.config.ts
pnpm drizzle-kit migrate --config node_modules/@hachej/boring-core/drizzle.config.ts
```

### 4. Server Entry

```ts
import { createCoreApp, loadConfig } from "@hachej/boring-core/server"

const config = await loadConfig()
const app = await createCoreApp(config)

// add child-app routes
app.get("/api/v1/my-thing", async () => ({ ok: true }))

await app.listen({ port: config.port })
```

### 5. Frontend Entry

```tsx
import { createRoot } from "react-dom/client"
import { BoringApp } from "@hachej/boring-core/front"
import { Route } from "react-router-dom"
import "@boring/core/theme.css"

createRoot(document.getElementById("root")!).render(
  <BoringApp>
    <Route path="/" element={<Dashboard />} />
  </BoringApp>,
)
```

---

## Package Surfaces

| Import | Environment | What You Get |
|--------|-------------|--------------|
| `@hachej/boring-core/server` | Node | `createCoreApp`, `loadConfig`, auth, stores, routes |
| `@hachej/boring-core/server/db` | Node | Drizzle schema, migrations, store interfaces |
| `@hachej/boring-core/front` | Browser | `<BoringApp>`, hooks, auth pages, components |
| `@hachej/boring-core/shared` | Any | `User`, `Workspace`, `HttpError`, `ErrorCode` types |
| `@hachej/boring-core/theme.css` | Browser | CSS theme tokens for the frontend shell |
| `@hachej/boring-core/app/front` | Browser | App composition helpers (`WorkspaceAgentFront`, etc.) |
| `@hachej/boring-core/app/server` | Node | App composition helpers (`createWorkspaceAgentApp`) |

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes (prod) | Postgres connection string |
| `BETTER_AUTH_SECRET` | Yes | 32-byte hex — signs session cookies |
| `BETTER_AUTH_URL` | Yes | Public URL for OAuth callbacks |
| `WORKSPACE_SETTINGS_ENCRYPTION_KEY` | Yes (prod) | 32-byte hex — encrypts workspace settings |
| `MAIL_FROM` | Yes (prod) | Sender address for auth emails |
| `MAIL_TRANSPORT_URL` | Yes (prod) | `resend://key`, `smtp://host`, or `console://` |
| `CORE_STORES` | No | `postgres` (default) or `local` (in-memory dev) |
| `CORS_ORIGINS` | Yes (prod) | Comma-separated allowlist |
| `SEND_WELCOME_EMAIL` | No | Default `true` — suppress with `false` |
| `SESSION_TTL_SECONDS` | No | Default 2,592,000 (30 days) |

---

## Architecture

```
┌──────────────────────┐
│   Browser Client     │
│  /auth/* + /me +     │
│  /workspaces/*       │
└──────────┬───────────┘
           │ HTTP (typed, cookie auth)
┌──────────▼───────────┐
│   Fastify App        │
│  ├── authHook (req.user)
│  ├── helmet + CORS   │
│  ├── rate limits     │
│  ├── secret redaction│
│  └── graceful shutdown
└──────────┬───────────┘
           │
┌──────────▼───────────┐
│  better-auth          │
│  (sessions, email,    │
│   password reset)     │
└──────────┬───────────┘
           │
┌──────────▼───────────┐
│   Drizzle + Postgres │
│  users, sessions,     │
│  workspaces, members, │
│  invites, settings    │
└──────────────────────┘
```

### Error Handling Contract

All errors flow through a single `setErrorHandler`:

| Condition | Status | Code |
|-----------|--------|------|
| No/expired session | 401 | `unauthorized` |
| Insufficient role | 403 | `forbidden` / `not_member` |
| Zod validation fail | 400 | `validation_failed` |
| Rate limited | 429 | `rate_limited` + `Retry-After` |
| DB ping fails | 503 | `db_unavailable` |
| Everything else | 500 | `internal_error` |

Every response includes `{ error, code, message, requestId }`. Client-side `apiFetch` parses this into `HttpError` instances.

---

## How @hachej/boring-core Compares

| Feature | @hachej/boring-core | Supabase + custom | Firebase | Roll your own |
|---------|---------------------|-------------------|----------|---------------|
| Auth flows | ✅ email + reset + magic link | ✅ OAuth only | ✅ OAuth/phone | Weeks to build |
| Workspaces + invites | ✅ owner/editor/viewer roles | ❌ Custom tables | ❌ Custom rules | ~1 week |
| Email templates | ✅ 5 React Email templates | ❌ You write them | ❌ SendGrid setup | ~3 days |
| App shell | ✅ `<BoringApp>` + hooks | ❌ DIY | ❌ DIY | ~1 week |
| Rate limiting | ✅ pre-wired routes | ❌ Edge functions | ⚠️ Cloud rules | ~2 days |
| Config validation | ✅ TOML + env + Zod | ❌ dotenv only | ⚠️ Remote config | Custom |

**When to use @hachej/boring-core:**
- Building a multi-user app around an AI agent
- You need auth + workspaces + invites in days, not weeks
- You're deploying to Fly.io, Render, Railway, or any Postgres-capable host

**When it might not fit:**
- You need server-side rendering (client-rendered only)
- You want SQLite (Postgres-only with Drizzle)
- You need Google/Apple/Discord OAuth (planned for v1.x)
- You need billing/Stripe integration (future `@boring/cloud` package)

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `ConfigValidationError` at boot | Missing required env var | Check `.env` has all required vars |
| `config_fetch_failed` in browser | API server not reachable | Verify `BETTER_AUTH_URL` matches |
| `mail_disabled` warning at boot | `MAIL_FROM` not set | Set `MAIL_TRANSPORT_URL=console://` for dev |
| `unauthorized` on `/api/v1/me` | No session cookie | Check `BETTER_AUTH_URL` and `CORS_ORIGINS` |
| `db_unavailable` on `/health` | Postgres can't connect | Verify `DATABASE_URL` and network access |

---

## Limitations

- **Postgres only** — No SQLite/libsql support in v1.
- **Client-rendered only** — `<BoringApp>` mounts client-side. No SSR.
- **GitHub OAuth deferred** — Planned for v1.x, bundled with agent's GitHub App install.
- **No billing** — Stripe integration planned for `@boring/cloud` package.
- **In-memory stores are dev-only** — `CORE_STORES=local` resets on restart. Not for production.
- **Partial swap seams** — `AuthProvider` is swappable, but the React auth surfaces (`useSession`, sign-in pages) are better-auth-shaped.

---

## FAQ

**Q: Can I use this without Postgres?**  
A: In dev, yes — set `CORE_STORES=local`. State is in-memory and resets on restart. For production, Postgres is required.

**Q: How do I add Google/Discord OAuth?**  
A: better-auth supports these out of the box. Add the provider config to `createAuth()` in the core source. Official v1.x support planned.

**Q: Can I swap better-auth for Clerk/Neon?**  
A: The `AuthProvider` interface is designed as a swap seam. You'll need to re-implement the React auth surfaces (`SignInPage`, `useSession`, etc.) and preserve the `users.id` continuity invariant.

**Q: How do email templates work?**  
A: Five React Email components (`VerifyEmail`, `ResetPassword`, `MagicLink`, `WorkspaceInvite`, `Welcome`) rendered via `@react-email/render`. CSS is inlined. Swap them by providing your own mail transport.

**Q: What's the difference between `@hachej/boring-core/server` and `@hachej/boring-core/server/db`?**  
A: `server` includes the full Fastify app, routes, auth, and stores. `server/db` is the Drizzle schema + connection + store interfaces only — useful for migration tooling and type-only imports.

---

*About Contributions:* Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. I'd also have to worry about other "stakeholders," which seems unwise for tools I mostly make for myself for free. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings. I understand this isn't in sync with the prevailing open-source ethos that seeks community contributions, but it's the only way I can move at this velocity and keep my sanity.

---

## License

MIT
