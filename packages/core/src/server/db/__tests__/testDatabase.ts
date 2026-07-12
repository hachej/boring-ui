import { randomUUID } from 'node:crypto'
import postgres from 'postgres'

export interface CoreTestDatabase {
  databaseUrl: string
  cleanup(): Promise<void>
}

const LOCAL_SOCKET_HOST = process.env.PGHOST?.startsWith('/') ? process.env.PGHOST : '/var/run/postgresql'
const LOCAL_SOCKET_ADMIN_DATABASE = process.env.PGADMIN_DATABASE ?? 'postgres'
const LOCAL_SOCKET_ADMIN_USER = process.env.PGUSER ?? process.env.USER ?? 'ubuntu'

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

async function connectLocalSocketAdmin(): Promise<postgres.Sql | undefined> {
  const client = postgres({
    host: LOCAL_SOCKET_HOST,
    database: LOCAL_SOCKET_ADMIN_DATABASE,
    username: LOCAL_SOCKET_ADMIN_USER,
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

export async function resolveCoreTestDatabase(prefix: string): Promise<CoreTestDatabase | undefined> {
  const configured = process.env.DATABASE_URL
  if (configured && await canConnectUrl(configured)) {
    return { databaseUrl: configured, cleanup: async () => {} }
  }

  const admin = await connectLocalSocketAdmin()
  if (!admin) return undefined

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

    const databaseUrl = `postgresql://${encodeURIComponent(roleName)}:${encodeURIComponent(password)}@127.0.0.1:5432/${encodeURIComponent(databaseName)}`
    return {
      databaseUrl,
      cleanup: async () => {
        const cleanup = await connectLocalSocketAdmin()
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
  } finally {
    await admin.end({ timeout: 1 }).catch(() => {})
  }
}
