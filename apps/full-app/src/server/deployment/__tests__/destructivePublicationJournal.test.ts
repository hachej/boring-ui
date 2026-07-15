import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from '@hachej/boring-core/server'
import type { CoreConfig } from '@hachej/boring-core/shared'

import {
  createD1DestructivePublicationJournalStore,
  type D1DestructivePublicationIdentity,
} from '../destructivePublicationJournal.js'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2)}`
const HOST = `journal-${RUN}`
const digest = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}` as const
const identity = (id: string, overrides: Partial<D1DestructivePublicationIdentity> = {}): D1DestructivePublicationIdentity => ({
  operationId: `${RUN}-${id}`, hostId: HOST, expectedRevision: 'r0000000001', expectedDigest: digest('a'),
  targetRevision: 'r0000000002', targetDigest: digest('b'), removalBindingIds: ['alpha', 'zulu'], ...overrides,
})
const error = { code: 'D1_DESTRUCTIVE_PUBLICATION_JOURNAL_STORE_FAILED' }
const store = createD1DestructivePublicationJournalStore()
let sql: postgres.Sql

async function reserved<T>(operation: (connection: postgres.ReservedSql) => Promise<T>): Promise<T> {
  const connection = await sql.reserve()
  try { return await operation(connection) } finally { connection.release() }
}

beforeAll(async () => {
  await runMigrations({ databaseUrl: DATABASE_URL } as CoreConfig)
  sql = postgres(DATABASE_URL, { max: 4 })
})
afterAll(async () => { if (sql) await sql.end() })

describe('D1 destructive publication journal store', () => {
  it('migrates an immutable identity-sequenced event journal', async () => {
    const columns = await sql`
      SELECT column_name, is_identity, data_type FROM information_schema.columns
      WHERE table_name = 'd1_destructive_publication_events' ORDER BY ordinal_position
    `
    expect(columns.map((column) => column.column_name)).toEqual([
      'sequence', 'operation_id', 'state', 'host_id', 'expected_revision', 'expected_digest',
      'target_revision', 'target_digest', 'removal_binding_ids', 'recorded_at', 'source_revision', 'source_digest',
    ])
    expect(columns[0]).toMatchObject({ is_identity: 'YES', data_type: 'bigint' })
    expect(columns[9]).toMatchObject({ data_type: 'timestamp with time zone' })
    expect(Object.keys(store)).toEqual(['appendPrepared', 'appendTerminal', 'readOperation', 'readPending'])

    const value = identity('immutable')
    await reserved((connection) => store.appendPrepared(connection, value))
    await expect(sql`UPDATE d1_destructive_publication_events SET state = 'aborted' WHERE operation_id = ${value.operationId}`).rejects.toThrow(/immutable/)
    await expect(sql`DELETE FROM d1_destructive_publication_events WHERE operation_id = ${value.operationId}`).rejects.toThrow(/immutable/)
    await expect(sql`TRUNCATE d1_destructive_publication_events`).rejects.toThrow(/immutable/)
    await reserved((connection) => store.appendTerminal(connection, value, 'aborted'))
  })

  it('appends ordered events idempotently and reconstructs pending operations', async () => {
    const completed = identity('completed'); const pending = identity('pending', { targetRevision: 'r0000000003' })
    await reserved(async (connection) => {
      const prepared = await store.appendPrepared(connection, completed)
      expect(await store.appendPrepared(connection, completed)).toEqual(prepared)
      await store.appendPrepared(connection, pending)
      expect((await store.readPending(connection, HOST)).map((event) => event.operationId)).toEqual([
        completed.operationId, pending.operationId,
      ])
      const terminal = await store.appendTerminal(connection, completed, 'committed')
      expect(await store.appendTerminal(connection, completed, 'committed')).toEqual(terminal)
      expect(terminal.sequence).toBeGreaterThan(prepared.sequence)
      expect(terminal.recordedAt).toBeInstanceOf(Date)
      expect(await store.readOperation(connection, completed.operationId)).toEqual({ prepared, terminal })
      expect((await store.readPending(connection, HOST)).map((event) => event.operationId)).toEqual([pending.operationId])
    })
  })

  it('persists rollback source provenance through pending and committed events', async () => {
    const rollback = identity('rollback-source', {
      expectedRevision: 'r0000000002', expectedDigest: digest('b'),
      targetRevision: 'r0000000003', targetDigest: digest('a'),
      sourceRevision: 'r0000000001', sourceDigest: digest('a'),
    })
    await reserved(async (connection) => {
      const prepared = await store.appendPrepared(connection, rollback)
      expect(prepared).toMatchObject({ sourceRevision: 'r0000000001', sourceDigest: digest('a') })
      expect((await store.readPending(connection, HOST)).find((event) => event.operationId === rollback.operationId))
        .toMatchObject({ sourceRevision: 'r0000000001', sourceDigest: digest('a'), state: 'prepared' })
      const terminal = await store.appendTerminal(connection, rollback, 'committed')
      expect(terminal).toMatchObject({ sourceRevision: 'r0000000001', sourceDigest: digest('a'), state: 'committed' })
      expect(await store.readOperation(connection, rollback.operationId)).toEqual({ prepared, terminal })
    })
  })

  it('rejects changed repeated metadata and contradictory terminal state', async () => {
    const value = identity('consistency')
    await reserved(async (connection) => {
      await store.appendPrepared(connection, value)
      await expect(store.appendPrepared(connection, { ...value, targetDigest: digest('c') })).rejects.toMatchObject(error)
      await store.appendTerminal(connection, value, 'aborted')
      await expect(store.appendTerminal(connection, value, 'committed')).rejects.toMatchObject(error)
    })

    const corrupted = identity('contradictory-row')
    await reserved((connection) => store.appendPrepared(connection, corrupted))
    await sql`
      INSERT INTO d1_destructive_publication_events
        (operation_id, state, host_id, expected_revision, expected_digest, target_revision, target_digest, removal_binding_ids)
      VALUES (${corrupted.operationId}, 'committed', ${corrupted.hostId}, ${corrupted.expectedRevision}, ${corrupted.expectedDigest},
        ${corrupted.targetRevision}, ${digest('d')}, ${corrupted.removalBindingIds as string[]})
    `
    await reserved((connection) => expect(store.readOperation(connection, corrupted.operationId)).rejects.toMatchObject(error))
    await reserved((connection) => expect(store.readPending(connection, HOST)).rejects.toMatchObject(error))

    const orphan = identity('terminal-only', { hostId: `${HOST}-orphan` })
    await sql`
      INSERT INTO d1_destructive_publication_events
        (operation_id, state, host_id, expected_revision, expected_digest, target_revision, target_digest, removal_binding_ids)
      VALUES (${orphan.operationId}, 'aborted', ${orphan.hostId}, ${orphan.expectedRevision}, ${orphan.expectedDigest},
        ${orphan.targetRevision}, ${orphan.targetDigest}, ${orphan.removalBindingIds as string[]})
    `
    await reserved((connection) => expect(store.readPending(connection, orphan.hostId)).rejects.toMatchObject(error))
  })

  it('converges same-event races and fails exactly one contradictory writer', async () => {
    const samePrepare = identity('same-prepare')
    const prepared = await Promise.all([
      reserved((connection) => store.appendPrepared(connection, samePrepare)),
      reserved((connection) => store.appendPrepared(connection, samePrepare)),
    ])
    expect(prepared[1]).toEqual(prepared[0])

    const conflictingPrepare = identity('conflicting-prepare')
    const prepareRace = await Promise.allSettled([
      reserved((connection) => store.appendPrepared(connection, conflictingPrepare)),
      reserved((connection) => store.appendPrepared(connection, { ...conflictingPrepare, targetDigest: digest('c') })),
    ])
    expect(prepareRace.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(prepareRace.find((result) => result.status === 'rejected')).toMatchObject({ reason: error })

    const sameTerminal = identity('same-terminal')
    await reserved((connection) => store.appendPrepared(connection, sameTerminal))
    const terminals = await Promise.all([
      reserved((connection) => store.appendTerminal(connection, sameTerminal, 'committed')),
      reserved((connection) => store.appendTerminal(connection, sameTerminal, 'committed')),
    ])
    expect(terminals[1]).toEqual(terminals[0])

    const conflictingTerminal = identity('conflicting-terminal')
    await reserved((connection) => store.appendPrepared(connection, conflictingTerminal))
    const terminalRace = await Promise.allSettled([
      reserved((connection) => store.appendTerminal(connection, conflictingTerminal, 'committed')),
      reserved((connection) => store.appendTerminal(connection, conflictingTerminal, 'aborted')),
    ])
    expect(terminalRace.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(terminalRace.find((result) => result.status === 'rejected')).toMatchObject({ reason: error })
  })

  it('fails closed for invalid input and malformed stored rows', async () => {
    await reserved(async (connection) => {
      for (const value of [
        identity('empty', { removalBindingIds: [] }), identity('unsorted', { removalBindingIds: ['zulu', 'alpha'] }),
        identity('historical', { targetRevision: 'r0000000001' }),
      ]) await expect(store.appendPrepared(connection, value)).rejects.toMatchObject(error)
    })
    const malformed = identity('malformed')
    await sql`
      INSERT INTO d1_destructive_publication_events
        (operation_id, state, host_id, expected_revision, expected_digest, target_revision, target_digest, removal_binding_ids)
      VALUES (${malformed.operationId}, 'prepared', ${malformed.hostId}, ${malformed.expectedRevision}, ${malformed.expectedDigest},
        ${malformed.targetRevision}, ${malformed.targetDigest}, ${['zulu', 'alpha']})
    `
    await reserved((connection) => expect(store.readOperation(connection, malformed.operationId)).rejects.toMatchObject(error))
  })

  it('translates reserved-connection failure without leaking driver details', async () => {
    const applicationName = `d1-journal-${RUN}`
    const owned = postgres(DATABASE_URL, { max: 1, connection: { application_name: applicationName } })
    const connection = await owned.reserve()
    await connection`SELECT 1`
    const [backend] = await sql<{ pid: number }[]>`SELECT pid FROM pg_stat_activity WHERE application_name = ${applicationName}`
    await sql`SELECT pg_terminate_backend(${backend!.pid})`
    const caught = await store.readOperation(connection, identity('lost').operationId).catch((value) => value)
    expect(caught).toMatchObject(error)
    expect(JSON.stringify(caught)).not.toMatch(/CONNECTION_|ECONN|postgres:/)
    try { connection.release() } catch {}
    await owned.end({ timeout: 0 }).catch(() => {})
  })
})
