import {
  quarantineV1EventStreamPath,
  SESSION_STREAM_PREFIX,
  sessionStreamPath,
  type SessionStreamIdentity,
} from '../../shared/events'
import { safeCapture, type TelemetrySink } from '../../shared/telemetry'
import type { RunTransaction, SqlStorage } from './sqlStorage'

export const BORING_EVENT_STREAM_SCHEMA_VERSION = 2
const MIGRATION_BUSY_TIMEOUT_MS = 5_000
const MIGRATION_TABLE = 'boring_event_stream_migration_v2'

type CollisionClass = 'single-target' | 'empty-user-wins' | 'multi-user-only' | 'garbage-path'

interface MigrationOptions {
  readonly runTransaction: RunTransaction
  readonly ensureCurrentSchema: () => void
  readonly telemetry?: TelemetrySink
}

interface LegacySessionIdentity extends SessionStreamIdentity {
  readonly authSubjectId: string
}

interface ManifestRow {
  readonly oldPath: string
  readonly newPath: string
  readonly stagingPath: string
  readonly disposition: 'rekey' | 'quarantine'
  readonly reason: string
  readonly identity?: LegacySessionIdentity
}

export class EventStreamSchemaVersionError extends Error {
  readonly code = 'INTERNAL_ERROR'

  constructor(readonly storedVersion: string, readonly supportedVersion = BORING_EVENT_STREAM_SCHEMA_VERSION) {
    super(`Unsupported event stream schema version "${storedVersion}" (expected "${supportedVersion}").`)
    this.name = 'EventStreamSchemaVersionError'
  }
}

export class EventStreamSchemaMigrationError extends Error {
  readonly code = 'INTERNAL_ERROR'

  constructor(message: string) {
    super(`Event stream schema migration validation failed: ${message}`)
    this.name = 'EventStreamSchemaMigrationError'
  }
}

export function assertSupportedEventStreamSchemaVersion(
  storedVersion: string,
  supportedVersion = BORING_EVENT_STREAM_SCHEMA_VERSION,
): void {
  if (storedVersion === String(supportedVersion)) return
  throw new EventStreamSchemaVersionError(storedVersion, supportedVersion)
}

export function migrateEventStreamSqlSchema(sql: SqlStorage, options: MigrationOptions): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS boring_event_stream_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  const priorBusyTimeout = Number(sql.exec('PRAGMA busy_timeout').toArray()[0]?.timeout ?? 0)
  sql.exec(`PRAGMA busy_timeout=${MIGRATION_BUSY_TIMEOUT_MS}`)
  let collisionCounts: Record<CollisionClass, number> | undefined
  try {
    collisionCounts = options.runTransaction(() => {
      const stored = readStoredVersion(sql)
      if (stored === String(BORING_EVENT_STREAM_SCHEMA_VERSION)) {
        options.ensureCurrentSchema()
        assertPersistedVersion(sql)
        return undefined
      }

      if (stored === undefined) {
        const existing = sql.exec(`
          SELECT name FROM sqlite_master
          WHERE type = 'table'
            AND name LIKE 'boring_event_stream%'
            AND name <> 'boring_event_stream_meta'
          LIMIT 1
        `).toArray()[0]
        if (existing) throw new EventStreamSchemaVersionError('unversioned')
        options.ensureCurrentSchema()
        writeStoredVersion(sql, BORING_EVENT_STREAM_SCHEMA_VERSION)
        assertPersistedVersion(sql)
        return undefined
      }

      if (stored !== '1') throw new EventStreamSchemaVersionError(stored)
      options.ensureCurrentSchema()
      const counts = migrateV1ToV2(sql)
      writeStoredVersion(sql, BORING_EVENT_STREAM_SCHEMA_VERSION)
      assertPersistedVersion(sql)
      return counts
    }, 'immediate')
  } finally {
    sql.exec(`PRAGMA busy_timeout=${Math.max(0, priorBusyTimeout)}`)
  }

  if (!collisionCounts || !options.telemetry) return
  for (const collisionClass of [
    'single-target',
    'empty-user-wins',
    'multi-user-only',
    'garbage-path',
  ] as const) {
    safeCapture(options.telemetry, {
      name: 'agent.event-stream.migration-v2-collision-class',
      properties: {
        collisionClass,
        streamCount: collisionCounts[collisionClass],
      },
    })
  }
}

function migrateV1ToV2(sql: SqlStorage): Record<CollisionClass, number> {
  sql.exec(`DROP TABLE IF EXISTS ${MIGRATION_TABLE}`)
  sql.exec(`
    CREATE TABLE ${MIGRATION_TABLE} (
      old_path TEXT PRIMARY KEY,
      new_path TEXT NOT NULL,
      staging_path TEXT NOT NULL UNIQUE,
      disposition TEXT NOT NULL,
      reason TEXT NOT NULL,
      workspace_scope_id TEXT,
      session_id TEXT,
      auth_subject_id TEXT,
      entry_count INTEGER NOT NULL,
      entry_max_seq INTEGER,
      key_count INTEGER NOT NULL,
      key_max_seq INTEGER
    )
  `)

  const oldPaths = sql.exec('SELECT path FROM boring_event_streams ORDER BY path').toArray()
    .map((row) => String(row.path))
  const stagingPrefix = selectUnusedStagingPrefix(oldPaths)
  const counts: Record<CollisionClass, number> = {
    'single-target': 0,
    'empty-user-wins': 0,
    'multi-user-only': 0,
    'garbage-path': 0,
  }
  const validGroups = new Map<string, Array<{ oldPath: string; identity: LegacySessionIdentity }>>()
  const manifest: ManifestRow[] = []

  for (const oldPath of oldPaths) {
    const identity = parseLegacyV1Identity(oldPath)
    if (!identity) {
      counts['garbage-path'] += 1
      manifest.push(quarantineManifestRow(oldPath, stagingPrefix, manifest.length, 'garbage-path'))
      continue
    }
    const newPath = sessionStreamPath(identity)
    const group = validGroups.get(newPath) ?? []
    group.push({ oldPath, identity })
    validGroups.set(newPath, group)
  }

  for (const [newPath, group] of validGroups) {
    if (group.length === 1) {
      const only = group[0]
      if (!only) throw new EventStreamSchemaMigrationError('single-target group was empty')
      counts['single-target'] += 1
      manifest.push(rekeyManifestRow(only.oldPath, newPath, stagingPrefix, manifest.length, only.identity, 'single-target'))
      continue
    }
    const emptyUsers = group.filter((candidate) => candidate.identity.authSubjectId === '')
    if (emptyUsers.length === 1) {
      counts['empty-user-wins'] += group.length
      const winner = emptyUsers[0]
      if (!winner) throw new EventStreamSchemaMigrationError('empty-user winner was missing')
      manifest.push(rekeyManifestRow(winner.oldPath, newPath, stagingPrefix, manifest.length, winner.identity, 'empty-user-winner'))
      for (const candidate of group) {
        if (candidate === winner) continue
        manifest.push(quarantineManifestRow(candidate.oldPath, stagingPrefix, manifest.length, 'empty-user-collision-loser'))
      }
      continue
    }
    if (emptyUsers.length === 0) {
      counts['multi-user-only'] += group.length
      for (const candidate of group) {
        manifest.push(quarantineManifestRow(candidate.oldPath, stagingPrefix, manifest.length, 'multi-user-only-collision'))
      }
      continue
    }
    counts['garbage-path'] += group.length
    for (const candidate of group) {
      manifest.push(quarantineManifestRow(candidate.oldPath, stagingPrefix, manifest.length, 'ambiguous-empty-user-collision'))
    }
  }

  for (const row of manifest) insertManifestRow(sql, row)
  validatePreflight(sql, oldPaths.length)
  swapPaths(sql)
  insertMigratedOwners(sql)
  validateSwap(sql)
  return counts
}

function parseLegacyV1Identity(path: string): LegacySessionIdentity | null {
  if (!path.startsWith(SESSION_STREAM_PREFIX)) return null
  const encoded = path.slice(SESSION_STREAM_PREFIX.length)
  if (!encoded.startsWith('[') || !encoded.endsWith(']')) return null
  try {
    const parsed = JSON.parse(encoded) as unknown
    if (
      !Array.isArray(parsed)
      || parsed.length !== 3
      || parsed.some((value) => typeof value !== 'string')
    ) return null
    const [sessionId, workspaceScopeId, authSubjectId] = parsed as [string, string, string]
    if (sessionId.length === 0 || workspaceScopeId.length === 0) return null
    return { workspaceScopeId, sessionId, authSubjectId }
  } catch {
    return null
  }
}

function quarantineManifestRow(oldPath: string, stagingPrefix: string, index: number, reason: string): ManifestRow {
  return {
    oldPath,
    newPath: quarantineV1EventStreamPath(oldPath),
    stagingPath: stagingPath(stagingPrefix, index),
    disposition: 'quarantine',
    reason,
  }
}

function rekeyManifestRow(
  oldPath: string,
  newPath: string,
  stagingPrefix: string,
  index: number,
  identity: LegacySessionIdentity,
  reason: string,
): ManifestRow {
  return {
    oldPath,
    newPath,
    stagingPath: stagingPath(stagingPrefix, index),
    disposition: 'rekey',
    reason,
    identity,
  }
}

function selectUnusedStagingPrefix(oldPaths: readonly string[]): string {
  for (let suffix = 0; ; suffix += 1) {
    const candidate = suffix === 0
      ? '__boring_event_stream_migration_v2__'
      : `__boring_event_stream_migration_v2_${suffix}__`
    if (!oldPaths.some((path) => path === candidate || path.startsWith(`${candidate}/`))) return candidate
  }
}

function stagingPath(prefix: string, index: number): string {
  return `${prefix}/${index}`
}

function insertManifestRow(sql: SqlStorage, row: ManifestRow): void {
  const entries = sql.exec(
    'SELECT COUNT(*) AS count, MAX(seq) AS max_seq FROM boring_event_stream_entries WHERE path = ?',
    row.oldPath,
  ).toArray()[0]
  const keys = sql.exec(
    'SELECT COUNT(*) AS count, MAX(seq) AS max_seq FROM boring_event_stream_keys WHERE path = ?',
    row.oldPath,
  ).toArray()[0]
  sql.exec(`
    INSERT INTO ${MIGRATION_TABLE} (
      old_path, new_path, staging_path, disposition, reason,
      workspace_scope_id, session_id, auth_subject_id,
      entry_count, entry_max_seq, key_count, key_max_seq
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  row.oldPath,
  row.newPath,
  row.stagingPath,
  row.disposition,
  row.reason,
  row.identity?.workspaceScopeId ?? null,
  row.identity?.sessionId ?? null,
  row.identity?.authSubjectId || null,
  Number(entries?.count ?? 0),
  entries?.max_seq ?? null,
  Number(keys?.count ?? 0),
  keys?.max_seq ?? null)
}

function validatePreflight(sql: SqlStorage, expectedStreamCount: number): void {
  const manifestCount = scalarNumber(sql, `SELECT COUNT(*) AS value FROM ${MIGRATION_TABLE}`)
  if (manifestCount !== expectedStreamCount) {
    throw new EventStreamSchemaMigrationError(`manifest accounts for ${manifestCount}/${expectedStreamCount} streams`)
  }
  const duplicateTarget = sql.exec(`
    SELECT new_path FROM ${MIGRATION_TABLE}
    GROUP BY new_path HAVING COUNT(*) > 1 LIMIT 1
  `).toArray()[0]
  if (duplicateTarget) throw new EventStreamSchemaMigrationError(`target path is not unique: ${String(duplicateTarget.new_path)}`)
  const stagingCollision = sql.exec(`
    SELECT staging_path FROM ${MIGRATION_TABLE}
    WHERE staging_path IN (
      SELECT old_path FROM ${MIGRATION_TABLE}
      UNION ALL
      SELECT new_path FROM ${MIGRATION_TABLE}
    )
    LIMIT 1
  `).toArray()[0]
  if (stagingCollision) {
    throw new EventStreamSchemaMigrationError(`staging path is not disjoint: ${String(stagingCollision.staging_path)}`)
  }

  for (const childTable of ['boring_event_stream_entries', 'boring_event_stream_keys']) {
    const unaccounted = sql.exec(`
      SELECT child.path FROM ${childTable} child
      LEFT JOIN ${MIGRATION_TABLE} manifest ON manifest.old_path = child.path
      WHERE manifest.old_path IS NULL
      LIMIT 1
    `).toArray()[0]
    if (unaccounted) throw new EventStreamSchemaMigrationError(`unaccounted ${childTable} path ${String(unaccounted.path)}`)
  }

  const mismatched = sql.exec(`
    SELECT manifest.old_path
    FROM ${MIGRATION_TABLE} manifest
    LEFT JOIN (
      SELECT path, COUNT(*) AS entry_count, MAX(seq) AS entry_max_seq
      FROM boring_event_stream_entries GROUP BY path
    ) entries ON entries.path = manifest.old_path
    LEFT JOIN (
      SELECT path, COUNT(*) AS key_count, MAX(seq) AS key_max_seq
      FROM boring_event_stream_keys GROUP BY path
    ) keys ON keys.path = manifest.old_path
    WHERE manifest.entry_count <> COALESCE(entries.entry_count, 0)
       OR NOT (manifest.entry_max_seq IS entries.entry_max_seq)
       OR manifest.key_count <> COALESCE(keys.key_count, 0)
       OR NOT (manifest.key_max_seq IS keys.key_max_seq)
    LIMIT 1
  `).toArray()[0]
  if (mismatched) throw new EventStreamSchemaMigrationError(`preflight counts changed for ${String(mismatched.old_path)}`)
}

function swapPaths(sql: SqlStorage): void {
  for (const table of ['boring_event_stream_entries', 'boring_event_stream_keys', 'boring_event_streams']) {
    sql.exec(`
      UPDATE ${table}
      SET path = (SELECT staging_path FROM ${MIGRATION_TABLE} WHERE old_path = ${table}.path)
    `)
    sql.exec(`
      UPDATE ${table}
      SET path = (SELECT new_path FROM ${MIGRATION_TABLE} WHERE staging_path = ${table}.path)
    `)
  }
}

function insertMigratedOwners(sql: SqlStorage): void {
  sql.exec(`
    INSERT INTO boring_event_stream_owners (
      path, workspace_scope_id, session_id, agent_type_id, auth_subject_id,
      seat_id, thread_id, key_version, created_at
    )
    SELECT new_path, workspace_scope_id, session_id, NULL, auth_subject_id,
           NULL, NULL, 1, ?
    FROM ${MIGRATION_TABLE}
    WHERE disposition = 'rekey'
  `, Date.now())
}

function validateSwap(sql: SqlStorage): void {
  for (const childTable of ['boring_event_stream_entries', 'boring_event_stream_keys']) {
    const unaccounted = sql.exec(`
      SELECT child.path FROM ${childTable} child
      LEFT JOIN ${MIGRATION_TABLE} manifest ON manifest.new_path = child.path
      WHERE manifest.new_path IS NULL
      LIMIT 1
    `).toArray()[0]
    if (unaccounted) throw new EventStreamSchemaMigrationError(`unaccounted swapped ${childTable} path ${String(unaccounted.path)}`)
  }
  const mismatched = sql.exec(`
    SELECT manifest.new_path
    FROM ${MIGRATION_TABLE} manifest
    LEFT JOIN (
      SELECT path, COUNT(*) AS entry_count, MAX(seq) AS entry_max_seq
      FROM boring_event_stream_entries GROUP BY path
    ) entries ON entries.path = manifest.new_path
    LEFT JOIN (
      SELECT path, COUNT(*) AS key_count, MAX(seq) AS key_max_seq
      FROM boring_event_stream_keys GROUP BY path
    ) keys ON keys.path = manifest.new_path
    WHERE manifest.entry_count <> COALESCE(entries.entry_count, 0)
       OR NOT (manifest.entry_max_seq IS entries.entry_max_seq)
       OR manifest.key_count <> COALESCE(keys.key_count, 0)
       OR NOT (manifest.key_max_seq IS keys.key_max_seq)
    LIMIT 1
  `).toArray()[0]
  if (mismatched) throw new EventStreamSchemaMigrationError(`swapped counts changed for ${String(mismatched.new_path)}`)

  const missingOwner = sql.exec(`
    SELECT manifest.new_path FROM ${MIGRATION_TABLE} manifest
    LEFT JOIN boring_event_stream_owners owner ON owner.path = manifest.new_path
    WHERE manifest.disposition = 'rekey' AND owner.path IS NULL
    LIMIT 1
  `).toArray()[0]
  if (missingOwner) throw new EventStreamSchemaMigrationError(`owner missing for ${String(missingOwner.new_path)}`)
}

function scalarNumber(sql: SqlStorage, query: string): number {
  return Number(sql.exec(query).toArray()[0]?.value ?? 0)
}

function readStoredVersion(sql: SqlStorage): string | undefined {
  const stored = sql.exec(
    `SELECT value FROM boring_event_stream_meta WHERE key = 'schema_version'`,
  ).toArray()[0]?.value
  return stored === undefined || stored === null ? undefined : String(stored)
}

function writeStoredVersion(sql: SqlStorage, version: number): void {
  sql.exec(`
    INSERT INTO boring_event_stream_meta (key, value)
    VALUES ('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `, String(version))
}

function assertPersistedVersion(sql: SqlStorage): void {
  assertSupportedEventStreamSchemaVersion(String(readStoredVersion(sql)))
}
