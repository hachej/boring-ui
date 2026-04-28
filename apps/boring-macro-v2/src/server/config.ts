/**
 * Macro-specific configuration. Reads ClickHouse connection info and app
 * flags from environment variables.
 */

export interface ClickHouseConfig {
  host: string
  port: number
  username: string
  password: string
  database: string
  secure: boolean
}

export interface MacroConfig {
  clickhouse: ClickHouseConfig | null
  authRedirectOnRoot: boolean
  /**
   * When true, loopback requests get a synthetic `pi-agent` user injected
   * by the macro routes so the local agent can call /api/macro endpoints
   * without a real auth session. Off in production.
   */
  devAutoSession: boolean
  /** Filesystem root for deck markdown files served by /api/macro/deck. */
  deckRoot: string
}

function envBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null) return fallback
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase())
}

interface CHEnv {
  hostUrl: string | null
  username: string | null
  password: string | null
  database: string | null
}

function readClickHouseEnv(): CHEnv {
  return {
    hostUrl: (process.env.BM_CH_HOST || '').trim() || null,
    username: (process.env.BM_CH_USER || '').trim() || null,
    password: (process.env.BM_CH_PASSWORD || '').trim() || null,
    database: (process.env.BM_CH_DATABASE || '').trim() || null,
  }
}

async function probeDatabase(
  hostUrl: string,
  username: string,
  password: string,
): Promise<string | null> {
  // Look for the database that owns the `series_catalog` table, then fall
  // back to known names. Cloud CH deployments typically don't expose this
  // info in the URL, so a single SELECT keeps the env minimal.
  try {
    const { createClient } = await import('@clickhouse/client')
    const client = createClient({ url: hostUrl, username, password, database: 'default' })
    try {
      const r = await client.query({
        query: "SELECT database FROM system.tables WHERE name = 'series_catalog' ORDER BY database LIMIT 1",
        format: 'JSONEachRow',
      })
      const rows = await r.json<{ database: string }>()
      const found = rows[0]?.database?.trim()
      if (found && !['system', 'information_schema'].includes(found.toLowerCase())) {
        return found
      }
    } finally {
      await client.close().catch(() => { /* ignore */ })
    }
  } catch {
    // CH client missing or connection failed — surface as null
  }
  return null
}

async function resolveClickHouse(env: CHEnv): Promise<ClickHouseConfig | null> {
  const { hostUrl, username, password } = env
  if (!hostUrl || !username || !password) return null

  let parsed: URL
  try {
    parsed = new URL(hostUrl)
  } catch {
    return null
  }

  const secure = parsed.protocol === 'https:'
  const port = parsed.port ? parseInt(parsed.port, 10) : (secure ? 8443 : 8123)

  let database = env.database
  if (!database) {
    database = await probeDatabase(hostUrl, username, password)
    if (!database) return null
  }

  return {
    host: parsed.hostname || 'localhost',
    port,
    username,
    password,
    database,
    secure,
  }
}

export async function loadMacroConfig(): Promise<MacroConfig> {
  const chEnv = readClickHouseEnv()
  const clickhouse = await resolveClickHouse(chEnv)

  // Surface a startup warning when CH config is partially set — the
  // routes will return 503 silently otherwise and the cause is hard to
  // spot. All-unset is a legitimate "no backend" mode and stays quiet.
  if (clickhouse === null) {
    const set = Object.entries(chEnv).filter(([, v]) => v !== null).map(([k]) => k)
    if (set.length > 0 && set.length < 3) {
      const required = ['hostUrl', 'username', 'password']
      const missing = required.filter((k) => !chEnv[k as keyof CHEnv])
      console.warn(
        `[macro] ClickHouse env is partial — set ${set.join(', ')} but missing ${missing.join(', ')}. Macro routes will return 503.`,
      )
    } else if (set.length >= 3) {
      console.warn(
        `[macro] ClickHouse host/user/pass set but no series_catalog database found (probe failed). Macro routes will return 503.`,
      )
    }
  }

  // devAutoSession defaults to ON unless NODE_ENV=production. The local
  // agent and the e2e suite both call /api/macro from loopback without a
  // session and expect the synthetic pi-agent user to land on the request.
  const devAutoSessionDefault = process.env.NODE_ENV !== 'production'

  return {
    clickhouse,
    authRedirectOnRoot: envBool(process.env.BM_AUTH_REDIRECT_ON_ROOT, false),
    devAutoSession: envBool(process.env.BM_DEV_AUTO_SESSION, devAutoSessionDefault),
    deckRoot: process.env.BM_DECK_ROOT?.trim() || `${process.cwd()}/deck`,
  }
}
