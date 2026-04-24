# Config

Status: **planned** — shapes are locked in the spec; loader is not yet implemented.

## Two sources, merged

1. **`boring.app.toml`** — static app identity + branding. Checked into the repo.
2. **Environment variables** — secrets + per-deployment overrides.

Merged, Zod-validated, frozen into `CoreConfig` at boot. The frontend never sees the raw config — it gets a redacted `RuntimeConfig` from `GET /api/v1/config`.

## `boring.app.toml`

```toml
[app]
# Unique app identifier, used as appId in workspaces and user_settings.
id = "my-app"

[frontend.branding]
name = "My App"
logo = "/logo.svg"       # Served from staticDir
favicon = "/favicon.ico"

[frontend.theme]
default = "system"       # "light" | "dark" | "system"

[features]
github_oauth = true
invites_enabled = true
```

## Environment variables

| Var | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes (prod) | Postgres connection string. |
| `BETTER_AUTH_SECRET` | yes | 32-byte hex. Used to sign session cookies. |
| `BETTER_AUTH_URL` | yes | Public URL of the deployment (used for OAuth callbacks). |
| `WORKSPACE_SETTINGS_ENCRYPTION_KEY` | yes (prod) | 32-byte hex. Used by pgcrypto to encrypt `workspace_settings.value`. Rotating invalidates existing encrypted values. |
| `GITHUB_CLIENT_ID` | if github_oauth | From your GitHub OAuth app. |
| `GITHUB_CLIENT_SECRET` | if github_oauth | From your GitHub OAuth app. |
| `PORT` | no | Fastify port (default 3000). |
| `HOST` | no | Fastify host (default 0.0.0.0). |
| `STATIC_DIR` | no | Directory served at `/`. Falls back to no static hosting. |
| `CORE_STORES` | no | `postgres` (default) or `local`. `local` = in-memory, test-only. |
| `LOG_LEVEL` | no | Fastify/pino log level (default `info`). |

Child apps add their own env vars — core ignores anything it doesn't know about.

## `CoreConfig` type (shared/types)

```ts
export interface CoreConfig {
  appId: string
  appName: string
  appLogo: string | null

  port: number
  host: string
  staticDir: string | null

  databaseUrl: string | null
  stores: 'postgres' | 'local'

  auth: {
    secret: string
    url: string
    github?: { clientId: string; clientSecret: string }
  }

  features: {
    githubOauth: boolean
    invitesEnabled: boolean
  }
}
```

## `RuntimeConfig` (frontend-safe subset)

Served at `GET /api/v1/config`. No secrets.

```ts
export interface RuntimeConfig {
  appId: string
  appName: string
  appLogo: string | null
  apiBase: string
  features: {
    githubOauth: boolean
    invitesEnabled: boolean
  }
}
```

`<ConfigProvider>` fetches this once on mount and blocks render until loaded. `useConfig()` returns it synchronously afterwards.

## Loader API

```ts
import { loadConfig, validateConfig, buildRuntimeConfigPayload } from '@boring/core/server'

const config = await loadConfig()                // reads TOML + env, validates
const runtimePayload = buildRuntimeConfigPayload(config)
```

Options:

```ts
loadConfig({
  tomlPath?: string             // default: ./boring.app.toml
  env?: Record<string, string>  // default: process.env
  allowMissingSecrets?: boolean // default: false (throws on missing)
})
```

## Secret redaction

Core registers a Fastify hook that strips matching keys from logs:

- `secret`, `token`, `clientSecret`, `password`, `authorization`, `cookie` (by substring match, case-insensitive).

Child apps can extend via `app.addRedactionPaths(['my.custom.secret'])`.

## Not in v1

- `.env.*` layered files (use dotenv-expand or similar in your tooling).
- Per-workspace config overrides (deferred; use `workspace_settings` for runtime-mutable values).
- Remote config service (Consul, etcd, etc.) — write your own loader and call `validateConfig()` on the result.
