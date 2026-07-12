import { randomUUID } from 'node:crypto'
import postgres from 'postgres'

export interface CoreTestDatabase {
  databaseUrl: string
  cleanup(): Promise<void>
}

const LOCAL_SOCKET_HOST = process.env.PGHOST?.startsWith('/') ? process.env.PGHOST : '/var/run/postgresql'
const LOCAL_SOCKET_ADMIN_DATABASE = process.env.PGADMIN_DATABASE ?? 'postgres'
const LOCAL_SOCKET_ADMIN_USER = process.env.PGUSER ?? process.env.USER ?? 'ubuntu'
const DEFAULT_TCP_ADMIN_DATABASE = 'boring_ui_test'
const DEFAULT_TCP_ADMIN_USER = 'ubuntu'
const DEFAULT_TCP_ADMIN_PASSWORD = 'test'
const DEFAULT_TCP_ADMIN_HOST = '127.0.0.1'
const DEFAULT_TCP_ADMIN_PORT = '5432'

interface AdminConnectionCandidate {
  label: string
  databaseHost: string
  databasePort: string
  connect(): Promise<postgres.Sql | undefined>
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function safeName(prefix: string): string {
  const stem = prefix.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'test'
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  return `boring_${stem}_${suffix}`.slice(0, 60)
}

function isCi(): boolean {
  return process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true'
}

function buildDatabaseUrl(options: {
  username: string
  password?: string
  host: string
  port?: string
  database: string
}): string {
  const auth = options.password === undefined
    ? encodeURIComponent(options.username)
    : `${encodeURIComponent(options.username)}:${encodeURIComponent(options.password)}`
  const port = options.port && options.port !== '5432' ? `:${options.port}` : ''
  return `postgresql://${auth}@${options.host}${port}/${encodeURIComponent(options.database)}`
}

async function canConnectUrl(databaseUrl: string): Promise<boolean> {
  const client = postgres(databaseUrl, { max: 1, connect_timeout: 2 })
  try {
    await client`SELECT 1`
    return true
  } catch {
    return false
  } finally {
    await client.end({ timeout: 1 }).catch(() => {})
  }
}

async function connectAdminConfig(config: postgres.Options<Record<string, postgres.PostgresType>>): Promise<postgres.Sql | undefined> {
  const client = postgres({
    ...config,
    max: 1,
    connect_timeout: 2,
  })
  try {
    await client`SELECT 1`
    return client
  } catch {
    await client.end({ timeout: 1 }).catch(() => {})
    return undefined
  }
}

async function connectAdminUrl(databaseUrl: string): Promise<postgres.Sql | undefined> {
  const client = postgres(databaseUrl, { max: 1, connect_timeout: 2 })
  try {
    await client`SELECT 1`
    return client
  } catch {
    await client.end({ timeout: 1 }).catch(() => {})
    return undefined
  }
}

function adminCandidates(): AdminConnectionCandidate[] {
  const candidates: AdminConnectionCandidate[] = []

  const envHost = process.env.PGHOST
  if (envHost && !envHost.startsWith('/')) {
    candidates.push({
      label: `PG* TCP env (${envHost}:${process.env.PGPORT ?? DEFAULT_TCP_ADMIN_PORT})`,
      databaseHost: envHost,
      databasePort: process.env.PGPORT ?? DEFAULT_TCP_ADMIN_PORT,
      connect: () => connectAdminConfig({
        host: envHost,
        port: Number(process.env.PGPORT ?? DEFAULT_TCP_ADMIN_PORT),
        database: process.env.PGDATABASE ?? DEFAULT_TCP_ADMIN_DATABASE,
        username: process.env.PGUSER ?? DEFAULT_TCP_ADMIN_USER,
        password: process.env.PGPASSWORD,
      }),
    })
  }

  // GitHub Actions CI provisions postgres:16 in .github/workflows/ci.yml with
  // ports: 5432:5432, but the job intentionally does not export DATABASE_URL.
  candidates.push({
    label: 'GitHub Actions postgres service default (127.0.0.1:5432)',
    databaseHost: DEFAULT_TCP_ADMIN_HOST,
    databasePort: DEFAULT_TCP_ADMIN_PORT,
    connect: () => connectAdminUrl(buildDatabaseUrl({
      username: DEFAULT_TCP_ADMIN_USER,
      password: DEFAULT_TCP_ADMIN_PASSWORD,
      host: DEFAULT_TCP_ADMIN_HOST,
      port: DEFAULT_TCP_ADMIN_PORT,
      database: DEFAULT_TCP_ADMIN_DATABASE,
    })),
  })

  candidates.push({
    label: `local postgres socket (${LOCAL_SOCKET_HOST})`,
    databaseHost: DEFAULT_TCP_ADMIN_HOST,
    databasePort: DEFAULT_TCP_ADMIN_PORT,
    connect: () => connectAdminConfig({
      host: LOCAL_SOCKET_HOST,
      database: LOCAL_SOCKET_ADMIN_DATABASE,
      username: LOCAL_SOCKET_ADMIN_USER,
    }),
  })

  return candidates
}

async function createIsolatedDatabase(prefix: string, admin: postgres.Sql, candidate: AdminConnectionCandidate): Promise<CoreTestDatabase | undefined> {
  const databaseName = safeName(prefix)
  const roleName = safeName(`${prefix}_role`)
  const password = randomUUID().replace(/-/g, '')
  let createdDatabase = false
  let createdRole = false

  try {
    await admin.unsafe(`CREATE ROLE ${quoteIdent(roleName)} LOGIN PASSWORD ${quoteLiteral(password)}`)
    createdRole = true
    await admin.unsafe(`CREATE DATABASE ${quoteIdent(databaseName)} OWNER ${quoteIdent(roleName)}`)
    createdDatabase = true

    const databaseUrl = buildDatabaseUrl({
      username: roleName,
      password,
      host: candidate.databaseHost,
      port: candidate.databasePort,
      database: databaseName,
    })
    return {
      databaseUrl,
      cleanup: async () => {
        const cleanup = await firstAvailableAdmin()
        if (!cleanup) return
        try {
          await cleanup`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${databaseName}`
          await cleanup.unsafe(`DROP DATABASE IF EXISTS ${quoteIdent(databaseName)}`)
          await cleanup.unsafe(`DROP ROLE IF EXISTS ${quoteIdent(roleName)}`)
        } finally {
          await cleanup.end({ timeout: 1 }).catch(() => {})
        }
      },
    }
  } catch {
    if (createdDatabase) await admin.unsafe(`DROP DATABASE IF EXISTS ${quoteIdent(databaseName)}`).catch(() => {})
    if (createdRole) await admin.unsafe(`DROP ROLE IF EXISTS ${quoteIdent(roleName)}`).catch(() => {})
    return undefined
  }
}

async function firstAvailableAdmin(): Promise<postgres.Sql | undefined> {
  for (const candidate of adminCandidates()) {
    const admin = await candidate.connect()
    if (admin) return admin
  }
  return undefined
}

export async function resolveCoreTestDatabase(prefix: string): Promise<CoreTestDatabase | undefined> {
  const configured = process.env.DATABASE_URL ?? process.env.CORE_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL
  if (configured && await canConnectUrl(configured)) {
    return { databaseUrl: configured, cleanup: async () => {} }
  }

  const attempted: string[] = configured ? ['configured database URL'] : []
  for (const candidate of adminCandidates()) {
    attempted.push(candidate.label)
    const admin = await candidate.connect()
    if (!admin) continue
    try {
      const database = await createIsolatedDatabase(prefix, admin, candidate)
      if (database) return database
    } finally {
      await admin.end({ timeout: 1 }).catch(() => {})
    }
  }

  if (isCi()) {
    throw new Error(`Required Postgres integration database unavailable; attempted ${attempted.join(', ')}`)
  }
  return undefined
}
