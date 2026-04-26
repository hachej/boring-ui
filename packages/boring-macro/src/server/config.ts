/**
 * Macro-specific configuration — ported from boring-macro config.py.
 *
 * Reads ClickHouse connection info and app flags from environment variables.
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
  devAutoSession: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function envBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null) return fallback
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase())
}

// ---------------------------------------------------------------------------
// ClickHouse URL parsing
// ---------------------------------------------------------------------------

interface ParsedCHUrl {
  hostUrl: string | null
  username: string | null
  password: string | null
  database: string | null
  secure: boolean | null
}

function parseClickHouseUrl(raw: string | undefined): ParsedCHUrl {
  const empty: ParsedCHUrl = { hostUrl: null, username: null, password: null, database: null, secure: null }
  if (!raw) return empty
  const value = raw.trim()
  if (!value) return empty

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return empty
  }
  if (!parsed.hostname) return empty

  const scheme = (parsed.protocol || 'https:').replace(':', '').toLowerCase()
  const secure = scheme === 'https'
  const port = parsed.port ? parseInt(parsed.port, 10) : (secure ? 8443 : 8123)
  const hostUrl = `${scheme}://${parsed.hostname}:${port}`

  const username = parsed.username ? decodeURIComponent(parsed.username) : null
  const password = parsed.password ? decodeURIComponent(parsed.password) : null
  const database = parsed.pathname.replace(/^\//, '') || null

  return { hostUrl, username, password, database, secure }
}

// ---------------------------------------------------------------------------
// Database auto-discovery probe
// ---------------------------------------------------------------------------

async function probeClickHouseDatabase(
  hostUrl: string,
  username: string,
  password: string,
): Promise<string | null> {
  let parsed: URL
  try {
    parsed = new URL(hostUrl)
  } catch {
    return null
  }

  const host = parsed.hostname
  if (!host) return null
  const secure = parsed.protocol === 'https:'
  const port = parsed.port ? parseInt(parsed.port, 10) : (secure ? 8443 : 8123)

  try {
    const { createClient } = await import('@clickhouse/client')
    const client = createClient({
      url: `${secure ? 'https' : 'http'}://${host}:${port}`,
      username,
      password,
      database: 'default',
    })

    try {
      // 1. Look for a database containing series_catalog
      const seriesResult = await client.query({
        query: "SELECT database FROM system.tables WHERE name = 'series_catalog' ORDER BY database",
        format: 'JSONEachRow',
      })
      const seriesRows = await seriesResult.json<{ database: string }>()
      for (const row of seriesRows) {
        const dbName = (row.database || '').trim()
        if (dbName && !['system', 'information_schema'].includes(dbName.toLowerCase())) {
          await client.close()
          return dbName
        }
      }

      // 2. Fall back to known database names
      const dbResult = await client.query({
        query: 'SELECT name FROM system.databases ORDER BY name',
        format: 'JSONEachRow',
      })
      const dbRows = await dbResult.json<{ name: string }>()
      const databases = new Set(dbRows.map((r) => (r.name || '').trim()))
      for (const candidate of ['boring_macro', 'default']) {
        if (databases.has(candidate)) {
          await client.close()
          return candidate
        }
      }

      await client.close()
    } catch {
      try { await client.close() } catch { /* ignore */ }
    }
  } catch {
    // @clickhouse/client not available or connection failed
  }

  return null
}

// ---------------------------------------------------------------------------
// Resolve ClickHouse config from env vars
// ---------------------------------------------------------------------------

async function resolveClickHouse(): Promise<ClickHouseConfig | null> {
  let hostUrl = (process.env.BM_CH_HOST || '').trim() || null
  let username = (process.env.BM_CH_USER || '').trim() || null
  let password = (process.env.BM_CH_PASSWORD || '').trim() || null
  let database = (process.env.BM_CH_DATABASE || '').trim() || null

  // Optional convenience URL (lower precedence than explicit BM_CH_* vars)
  const url = parseClickHouseUrl(process.env.BM_CLICKHOUSE_URL)
  hostUrl = hostUrl || url.hostUrl
  username = username || url.username
  password = password || url.password
  database = database || url.database

  // Auto-discover database when host/user/pass are present but DB is not
  if (!database && hostUrl && username && password) {
    database = await probeClickHouseDatabase(hostUrl, username, password)
  }

  if (!hostUrl || !username || !password || !database) {
    return null
  }

  let parsed: URL
  try {
    parsed = new URL(hostUrl)
  } catch {
    return null
  }

  const chHost = parsed.hostname || 'localhost'
  const secure = parsed.protocol === 'https:'
  const chPort = parsed.port ? parseInt(parsed.port, 10) : (secure ? 8443 : 8123)

  return {
    host: chHost,
    port: chPort,
    username,
    password,
    database,
    secure,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function loadMacroConfig(): Promise<MacroConfig> {
  const clickhouse = await resolveClickHouse()
  const authRedirectOnRoot = envBool(process.env.BM_AUTH_REDIRECT_ON_ROOT, false)
  const devAutoSession = envBool(process.env.BM_DEV_AUTO_SESSION, false)

  return {
    clickhouse,
    authRedirectOnRoot,
    devAutoSession,
  }
}
