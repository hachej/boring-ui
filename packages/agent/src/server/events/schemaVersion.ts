import type { SqlStorage } from './sqlStorage'

export const BORING_EVENT_STREAM_SCHEMA_VERSION = 1

export class EventStreamSchemaVersionError extends Error {
  readonly code = 'INTERNAL_ERROR'

  constructor(readonly storedVersion: string, readonly supportedVersion = BORING_EVENT_STREAM_SCHEMA_VERSION) {
    super(`Unsupported event stream schema version "${storedVersion}" (expected "${supportedVersion}").`)
    this.name = 'EventStreamSchemaVersionError'
  }
}

export function assertSupportedEventStreamSchemaVersion(storedVersion: string): void {
  if (storedVersion === String(BORING_EVENT_STREAM_SCHEMA_VERSION)) return
  throw new EventStreamSchemaVersionError(storedVersion)
}

export function migrateEventStreamSqlSchema(sql: SqlStorage, ensureCurrentSchema: () => void): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS boring_event_stream_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  const stored = sql.exec(
    `SELECT value FROM boring_event_stream_meta WHERE key = 'schema_version'`,
  ).toArray()[0]?.value

  if (stored !== undefined && stored !== null) {
    assertSupportedEventStreamSchemaVersion(String(stored))
  } else {
    const existing = sql.exec(`
      SELECT name FROM sqlite_master
      WHERE type = 'table'
        AND name LIKE 'boring_event_stream%'
        AND name <> 'boring_event_stream_meta'
      LIMIT 1
    `).toArray()[0]
    if (existing) {
      throw new EventStreamSchemaVersionError('unversioned')
    }
  }

  ensureCurrentSchema()

  sql.exec(`
    INSERT INTO boring_event_stream_meta (key, value)
    VALUES ('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `, String(BORING_EVENT_STREAM_SCHEMA_VERSION))

  const persisted = sql.exec(
    `SELECT value FROM boring_event_stream_meta WHERE key = 'schema_version'`,
  ).toArray()[0]?.value
  assertSupportedEventStreamSchemaVersion(String(persisted))
}
