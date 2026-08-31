import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parseSessionStreamPath,
  sessionStreamPath,
  type SessionStreamIdentity,
} from '../../../shared/events'
import {
  EventStreamStoreError,
  SqliteEventStreamStore,
} from '../eventStreamStore'
import {
  BORING_EVENT_STREAM_SCHEMA_VERSION,
  EventStreamSchemaVersionError,
} from '../schemaVersion'
import { openDatabase, type OpenDatabaseResult } from '../sqlStorage'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATION_WORKER_PATH = join(__dirname, 'fixtures', 'concurrentMigrationWorker.ts')

interface SeedStream {
  readonly path: string | null
  readonly eventCount?: number
  readonly closed?: boolean
}

interface MigrationWorkerResult {
  readonly schemaVersion: string
  readonly paths: string[]
  readonly migrationTelemetryEvents: number
}

const openedDatabases: OpenDatabaseResult[] = []
const tempDirs: string[] = []

afterEach(() => {
  for (const opened of openedDatabases.splice(0)) opened.db.close()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('session stream identity', () => {
  it('round-trips opaque ids with strict percent encoding', () => {
    const identity = {
      workspaceScopeId: '["tenant / one", "é"]',
      sessionId: 'scripted-main/one!*',
    }
    const path = sessionStreamPath(identity)

    expect(path).toBe('sessions/%5B%22tenant%20%2F%20one%22%2C%20%22%C3%A9%22%5D/scripted-main%2Fone%21%2A')
    expect(parseSessionStreamPath(path)).toEqual(identity)
  })

  it.each([
    'sessions/workspace',
    'sessions/workspace/',
    'sessions//session',
    'sessions/workspace/session/extra',
    'sessions/%61/session',
    'sessions/%2f/session',
    'sessions/%GG/session',
    'other/workspace/session',
  ])('rejects non-canonical path %s without throwing', (path) => {
    expect(parseSessionStreamPath(path)).toBeNull()
  })

  it('rejects empty identity segments at construction', () => {
    expect(() => sessionStreamPath({ workspaceScopeId: '', sessionId: 'session' })).toThrow(/workspaceScopeId/)
    expect(() => sessionStreamPath({ workspaceScopeId: 'workspace', sessionId: '' })).toThrow(/sessionId/)
  })

  it('rejects ill-formed Unicode identity segments at construction', () => {
    expect(() => sessionStreamPath({ workspaceScopeId: 'scope', sessionId: '\uD800' })).toThrow(/well-formed Unicode/)
    expect(() => sessionStreamPath({ workspaceScopeId: '\uDC00', sessionId: 'session' })).toThrow(/well-formed Unicode/)
  })
})

describe('event stream schema v1 to v2 migration', () => {
  it('preflights, classifies every collision, validates, swaps, and is a second-open no-op', () => {
    const db = createV1Fixture([
      { path: legacyPath('sid/rekey', 'scope/[one]', '') },
      { path: legacyPath('collision', 'scope', '') },
      { path: legacyPath('collision', 'scope', 'alice') },
      { path: legacyPath('multi', 'scope', 'alice') },
      { path: legacyPath('multi', 'scope', 'bob') },
      { path: 'garbage/path' },
      { path: '__boring_event_stream_migration_v2__/1' },
      { path: legacyPath('\uD800', 'scope', '') },
      { path: null, eventCount: 0, closed: true },
      { path: 'sessions/["ambiguous","scope",""]' },
      { path: 'sessions/["\\u0061mbiguous","scope",""]' },
    ])
    const capture = vi.fn()

    new SqliteEventStreamStore(db.sql, db.runTransaction, { telemetry: { capture } })

    expect(readSchemaVersion(db)).toBe('2')
    expect(BORING_EVENT_STREAM_SCHEMA_VERSION).toBe(2)
    const paths = db.sql.exec('SELECT path FROM boring_event_streams ORDER BY path').toArray()
      .map((row) => String(row.path))
    expect(paths).toHaveLength(11)
    expect(paths.every((path) => parseSessionStreamPath(path) !== null || path.startsWith('quarantine/v1/'))).toBe(true)
    expect(paths).toContain(sessionStreamPath({ workspaceScopeId: 'scope/[one]', sessionId: 'sid/rekey' }))
    expect(paths).toContain(sessionStreamPath({ workspaceScopeId: 'scope', sessionId: 'collision' }))

    const manifest = db.sql.exec(`
      SELECT old_rowid, old_path, old_path_type, new_path, disposition, reason
      FROM boring_event_stream_migration_v2
      ORDER BY old_rowid
    `).toArray()
    expect(manifest).toHaveLength(11)
    expect(manifest.filter((row) => row.disposition === 'rekey')).toHaveLength(2)
    expect(manifest.filter((row) => row.disposition === 'quarantine')).toHaveLength(9)
    expect(manifest.map((row) => row.reason)).toEqual(expect.arrayContaining([
      'single-target',
      'empty-user-winner',
      'empty-user-collision-loser',
      'multi-user-only-collision',
      'garbage-path',
      'unencodable-identity',
      'non-text-path',
      'ambiguous-empty-user-collision',
    ]))
    expect(manifest.find((row) => row.old_path === null)).toMatchObject({
      old_path_type: 'null',
      disposition: 'quarantine',
      reason: 'non-text-path',
    })
    const nullParentTarget = String(manifest.find((row) => row.old_path === null)?.new_path)
    expect(db.sql.exec('SELECT next_offset, closed FROM boring_event_streams WHERE path = ?', nullParentTarget).toArray())
      .toEqual([{ next_offset: 0, closed: 1 }])
    expect(manifest.find((row) => row.reason === 'unencodable-identity')).toMatchObject({
      old_path: legacyPath('\uD800', 'scope', ''),
      disposition: 'quarantine',
    })

    const owners = db.sql.exec(`
      SELECT path, workspace_scope_id, session_id, agent_type_id, auth_subject_id,
             seat_id, thread_id, key_version
      FROM boring_event_stream_owners
      ORDER BY path
    `).toArray()
    expect(owners).toHaveLength(2)
    expect(owners).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: sessionStreamPath({ workspaceScopeId: 'scope/[one]', sessionId: 'sid/rekey' }),
        workspace_scope_id: 'scope/[one]',
        session_id: 'sid/rekey',
        agent_type_id: null,
        auth_subject_id: null,
        seat_id: null,
        thread_id: null,
        key_version: 1,
      }),
      expect.objectContaining({
        path: sessionStreamPath({ workspaceScopeId: 'scope', sessionId: 'collision' }),
        workspace_scope_id: 'scope',
        session_id: 'collision',
        agent_type_id: null,
        auth_subject_id: null,
        key_version: 1,
      }),
    ]))
    expect(db.sql.exec(`SELECT workspace_scope_id, session_id FROM boring_event_stream_owners INDEXED BY boring_event_stream_owners_scope_session_idx WHERE workspace_scope_id = 'scope'`).toArray())
      .toEqual([{ workspace_scope_id: 'scope', session_id: 'collision' }])

    const replayed = db.sql.exec(
      'SELECT seq, data FROM boring_event_stream_entries WHERE path = ? ORDER BY seq',
      sessionStreamPath({ workspaceScopeId: 'scope/[one]', sessionId: 'sid/rekey' }),
    ).toArray()
    expect(replayed.map((row) => JSON.parse(String(row.data)))).toEqual([
      expect.objectContaining({ v: 1, eventIndex: 0, sessionId: 'sid/rekey', chunk: expect.objectContaining({ seq: 0 }) }),
      expect.objectContaining({ v: 1, eventIndex: 1, sessionId: 'sid/rekey', chunk: expect.objectContaining({ seq: 1 }) }),
    ])

    for (const path of paths) {
      const rows = db.sql.exec('SELECT COUNT(*) AS count, MAX(seq) AS max_seq FROM boring_event_stream_entries WHERE path = ?', path).toArray()[0]
      if (path === nullParentTarget) {
        expect(rows).toMatchObject({ count: 0, max_seq: null })
        continue
      }
      expect(rows).toMatchObject({ count: 2, max_seq: 1 })
      expect(db.sql.exec('SELECT COUNT(*) AS count FROM boring_event_stream_keys WHERE path = ?', path).toArray()[0])
        .toMatchObject({ count: 1 })
    }

    const telemetry = capture.mock.calls.map(([event]) => event)
      .filter((event) => event.name === 'agent.event-stream.migration-v2-collision-class')
    expect(telemetry).toHaveLength(5)
    expect(telemetry.map((event) => event.properties)).toEqual(expect.arrayContaining([
      expect.objectContaining({ collisionClass: 'single-target', streamCount: 1 }),
      expect.objectContaining({ collisionClass: 'empty-user-wins', streamCount: 2 }),
      expect.objectContaining({ collisionClass: 'multi-user-only', streamCount: 2 }),
      expect.objectContaining({ collisionClass: 'ambiguous-empty-user-collision', streamCount: 2 }),
      expect.objectContaining({ collisionClass: 'garbage-path', streamCount: 4 }),
    ]))

    capture.mockClear()
    new SqliteEventStreamStore(db.sql, db.runTransaction, { telemetry: { capture } })
    expect(capture).not.toHaveBeenCalled()
    expect(readSchemaVersion(db)).toBe('2')
    const beforeOldBinaryRefusal = logicalDatabaseContent(db)
    expect(() => openWithOriginMainSchemaVersionLogic(db)).toThrow(EventStreamSchemaVersionError)
    expect(logicalDatabaseContent(db)).toEqual(beforeOldBinaryRefusal)
  })

  it('rolls back and leaves schema_version 1 when validation finds an unaccounted child row', () => {
    const oldPath = legacyPath('session', 'scope', '')
    const db = createV1Fixture([{ path: oldPath }])
    db.sql.exec(
      `INSERT INTO boring_event_stream_entries (path, seq, data) VALUES (?, 0, '{}')`,
      'orphan/path',
    )

    expect(() => new SqliteEventStreamStore(db.sql, db.runTransaction)).toThrow(/unaccounted/i)
    expect(readSchemaVersion(db)).toBe('1')
    expect(db.sql.exec('SELECT path FROM boring_event_streams').toArray()).toEqual([{ path: oldPath }])
    expect(db.sql.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'boring_event_stream_migration_v2'`).toArray()).toEqual([])
  })

  it('creates v2 owners atomically and lazily backfills migrated agent identity', async () => {
    const db = remember(openDatabase(':memory:'))
    const store = new SqliteEventStreamStore(db.sql, db.runTransaction)
    const identity: SessionStreamIdentity = { workspaceScopeId: 'scope/[x]', sessionId: 'scripted-main' }
    const path = sessionStreamPath(identity)

    await store.createSessionStream(identity, { agentTypeId: 'alpha', authSubjectId: 'subject-a' })
    expect(await store.readStreamOwner(path)).toMatchObject({
      path,
      ...identity,
      agentTypeId: 'alpha',
      authSubjectId: 'subject-a',
      seatId: null,
      threadId: null,
      keyVersion: 2,
    })

    db.sql.exec('UPDATE boring_event_stream_owners SET agent_type_id = NULL WHERE path = ?', path)
    const claims = await Promise.allSettled([
      store.createSessionStream(identity, { agentTypeId: 'alpha' }),
      store.createSessionStream(identity, { agentTypeId: 'beta' }),
    ])
    expect(claims.filter((claim) => claim.status === 'fulfilled')).toHaveLength(1)
    expect(claims.filter((claim) => claim.status === 'rejected')).toHaveLength(1)
    expect(await store.readStreamOwner(path)).toMatchObject({
      agentTypeId: 'alpha',
      authSubjectId: 'subject-a',
    })
  })

  it('requires an owned session stream handle at compile time and at runtime', async () => {
    const db = remember(openDatabase(':memory:'))
    const store = new SqliteEventStreamStore(db.sql, db.runTransaction)

    if (false) {
      // @ts-expect-error A durable agent append must use the handle returned by createSessionStream.
      await store.appendAgentEvent('session', { type: 'agent-start', seq: 0, turnId: 'turn' })
    }
    await expect((store.appendAgentEvent as unknown as (
      stream: unknown,
      chunk: { type: 'agent-start'; seq: number; turnId: string },
    ) => Promise<string>)('session', { type: 'agent-start', seq: 0, turnId: 'turn' }))
      .rejects.toBeInstanceOf(EventStreamStoreError)
  })

  it.each(['fresh', 'v1'] as const)('lets concurrent production opens initialize one shared %s file', async (fixtureKind) => {
    const dir = rememberDir(mkdtempSync(join(tmpdir(), 'boring-event-stream-migration-concurrency-')))
    const dbPath = join(dir, 'events.sqlite')
    if (fixtureKind === 'v1') {
      const setup = openDatabase(dbPath)
      seedV1Schema(setup, [{ path: legacyPath('session', 'scope', '') }])
      setup.db.close()
    }
    const sharedBuf = new SharedArrayBuffer(8)
    const sync = new Int32Array(sharedBuf)

    const workers = [
      runMigrationWorker(dbPath, sharedBuf),
      runMigrationWorker(dbPath, sharedBuf),
    ]
    await waitForWorkerReadiness(sync, 2)
    Atomics.store(sync, 1, 1)
    Atomics.notify(sync, 1)
    const results = await Promise.all(workers)

    expect(results.map((result) => result.schemaVersion)).toEqual(['2', '2'])
    const expectedPaths = fixtureKind === 'v1'
      ? [
          sessionStreamPath({ workspaceScopeId: 'scope', sessionId: 'session' }),
          sessionStreamPath({ workspaceScopeId: 'scope', sessionId: 'session' }),
        ]
      : []
    expect(results.flatMap((result) => result.paths)).toEqual(expectedPaths)
    expect(results.reduce((sum, result) => sum + result.migrationTelemetryEvents, 0)).toBe(fixtureKind === 'v1' ? 5 : 0)
  }, 20_000)
})

function createV1Fixture(streams: readonly SeedStream[]): OpenDatabaseResult {
  const dir = rememberDir(mkdtempSync(join(tmpdir(), 'boring-event-stream-v1-')))
  const opened = remember(openDatabase(join(dir, 'events.sqlite')))
  seedV1Schema(opened, streams)
  return opened
}

function seedV1Schema(opened: OpenDatabaseResult, streams: readonly SeedStream[]): void {
  // Provenance: this helper is the origin/main v1 writer shape captured with
  // `git show c78491294dba9392573f4f005a3184d9de646483:packages/agent/src/server/events/eventStreamStore.ts`
  // and the matching shared/events.ts on 2026-08-30. It creates the same three
  // tables, old JSON-tuple stream path,
  // AgentEvent envelope, idempotency payload, next_offset, and schema_version
  // that the pre-A1 SqliteEventStreamStore wrote; mutation-only rows are then
  // inserted through the same SQL storage adapter.
  opened.sql.exec(`CREATE TABLE boring_event_stream_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
  opened.sql.exec(`INSERT INTO boring_event_stream_meta (key, value) VALUES ('schema_version', '1')`)
  opened.sql.exec(`CREATE TABLE boring_event_streams (path TEXT PRIMARY KEY, next_offset INTEGER NOT NULL DEFAULT 0, closed INTEGER NOT NULL DEFAULT 0)`)
  opened.sql.exec(`CREATE TABLE boring_event_stream_entries (path TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (path, seq))`)
  opened.sql.exec(`CREATE TABLE boring_event_stream_keys (path TEXT NOT NULL, idempotency_key TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (path, idempotency_key), UNIQUE (path, seq))`)
  for (const stream of streams) {
    const eventCount = stream.eventCount ?? 2
    opened.sql.exec(
      'INSERT INTO boring_event_streams (path, next_offset, closed) VALUES (?, ?, ?)',
      stream.path,
      eventCount,
      stream.closed ? 1 : 0,
    )
    const sessionId = legacySessionId(stream.path) ?? 'fixture-session'
    for (let seq = 0; seq < eventCount; seq += 1) {
      const chunk = { type: 'agent-start', seq, turnId: `turn-${seq}` }
      opened.sql.exec(
        'INSERT INTO boring_event_stream_entries (path, seq, data) VALUES (?, ?, ?)',
        stream.path,
        seq,
        JSON.stringify({
          v: 1,
          eventIndex: seq,
          timestamp: 1_700_000_000_000 + seq,
          sessionId,
          chunk,
        }),
      )
    }
    if (eventCount > 0) {
      opened.sql.exec(
        'INSERT INTO boring_event_stream_keys (path, idempotency_key, seq, data) VALUES (?, ?, ?, ?)',
        stream.path,
        'last',
        eventCount - 1,
        JSON.stringify({ type: 'agent-start', seq: eventCount - 1, turnId: `turn-${eventCount - 1}` }),
      )
    }
  }
}

function legacySessionId(path: string | null): string | null {
  if (!path?.startsWith('sessions/[')) return null
  try {
    const parsed = JSON.parse(path.slice('sessions/'.length)) as unknown
    return Array.isArray(parsed) && typeof parsed[0] === 'string' ? parsed[0] : null
  } catch {
    return null
  }
}

function openWithOriginMainSchemaVersionLogic(opened: OpenDatabaseResult): void {
  // This ordering is intentionally frozen from origin/main schemaVersion.ts:
  // the existing meta table is observed, v2 is refused, and neither the old
  // DDL callback nor the old schema_version write can run.
  opened.sql.exec(`
    CREATE TABLE IF NOT EXISTS boring_event_stream_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)
  const stored = opened.sql.exec(
    `SELECT value FROM boring_event_stream_meta WHERE key = 'schema_version'`,
  ).toArray()[0]?.value
  if (String(stored) !== '1') throw new EventStreamSchemaVersionError(String(stored), 1)
  throw new Error('fixture expected the origin/main schema-version check to refuse v2')
}

function logicalDatabaseContent(opened: OpenDatabaseResult): unknown {
  return {
    schema: opened.sql.exec(`
      SELECT type, name, tbl_name, sql
      FROM sqlite_master
      WHERE name LIKE 'boring_event_stream%'
      ORDER BY type, name
    `).toArray(),
    meta: opened.sql.exec('SELECT key, value FROM boring_event_stream_meta ORDER BY key').toArray(),
    streams: opened.sql.exec('SELECT rowid, path, next_offset, closed FROM boring_event_streams ORDER BY rowid').toArray(),
    entries: opened.sql.exec('SELECT path, seq, data FROM boring_event_stream_entries ORDER BY path, seq').toArray(),
    keys: opened.sql.exec('SELECT path, idempotency_key, seq, data FROM boring_event_stream_keys ORDER BY path, idempotency_key').toArray(),
    owners: opened.sql.exec('SELECT * FROM boring_event_stream_owners ORDER BY path').toArray(),
    manifest: opened.sql.exec(`SELECT * FROM boring_event_stream_migration_v2 ORDER BY old_rowid`).toArray(),
  }
}

function legacyPath(sessionId: string, workspaceScopeId: string, userId: string): string {
  return `sessions/${JSON.stringify([sessionId, workspaceScopeId, userId])}`
}

function readSchemaVersion(opened: OpenDatabaseResult): string {
  return String(opened.sql.exec(`SELECT value FROM boring_event_stream_meta WHERE key = 'schema_version'`).toArray()[0]?.value)
}

function remember(opened: OpenDatabaseResult): OpenDatabaseResult {
  openedDatabases.push(opened)
  return opened
}

function rememberDir(dir: string): string {
  tempDirs.push(dir)
  return dir
}

function runMigrationWorker(dbPath: string, sharedBuf: SharedArrayBuffer): Promise<MigrationWorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(MIGRATION_WORKER_PATH, {
      workerData: { dbPath, sharedBuf },
      execArgv: ['--import', 'tsx'],
    })
    worker.once('message', (message: MigrationWorkerResult) => {
      resolve(message)
      void worker.terminate()
    })
    worker.once('error', reject)
  })
}

async function waitForWorkerReadiness(sync: Int32Array, expected: number): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Atomics.load(sync, 0) < expected) {
    if (Date.now() >= deadline) {
      throw new Error(`only ${Atomics.load(sync, 0)}/${expected} migration workers reached the pre-open barrier`)
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
