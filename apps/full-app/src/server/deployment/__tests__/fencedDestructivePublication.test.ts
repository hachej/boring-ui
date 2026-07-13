import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from '@hachej/boring-core/server'
import type { CoreConfig } from '@hachej/boring-core/shared'

import { createD1AdmissionLedger, mintAttestedD1DatabaseConnection, type D1AdmissionLedger } from '../admissionLedger.js'
import type { D1ActiveCollection } from '../activeCollectionReader.js'
import {
  createD1DestructivePublicationJournalStore,
  type D1DestructivePublicationIdentity,
  type D1DestructivePublicationJournalStore,
} from '../destructivePublicationJournal.js'
import { D1HostErrorCode } from '../d1Plan.js'
import { createD1FencedDestructivePublication } from '../fencedDestructivePublication.js'
import { D1ActivePublishError, type D1HostRevisionStore, type D1StoredCompleteV1 } from '../hostRevisionStore.js'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2)}`
const digest = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}` as const
let admin: postgres.Sql; let serial = 0
const host = () => `fenced-${RUN}-${++serial}`
const deferred = () => { let resolve!: () => void; return { promise: new Promise<void>((done) => { resolve = done }), resolve } }

function stored(hostId: string, revisionId: string, desiredStateDigest: `sha256:${string}`, bindings: readonly string[], databaseRef = 'postgres-eu') {
  return {
    revisionId, desiredStateDigest,
    completion: { revisionId, desiredStateDigest },
    desired: { plan: { hostId, databaseRef, bindings: bindings.map((bindingId) => ({ bindingId })) } },
  } as unknown as D1StoredCompleteV1
}
class Revisions {
  readonly completes = new Map<string, D1StoredCompleteV1>(); events: string[] = []
  active: { schemaVersion: 1; revisionId: string; desiredStateDigest: `sha256:${string}` }
  onReadActive?: () => Promise<void>; onPublish?: () => Promise<'before' | 'after' | void>
  constructor(readonly hostId: string) {
    this.active = { schemaVersion: 1, revisionId: 'r0000000001', desiredStateDigest: digest('a') }
    this.completes.set('r0000000001', stored(hostId, 'r0000000001', digest('a'), ['alpha', 'bravo', 'zulu']))
    this.completes.set('r0000000002', stored(hostId, 'r0000000002', digest('b'), ['bravo']))
    this.completes.set('r0000000003', stored(hostId, 'r0000000003', digest('c'), ['alpha']))
  }
  store = {
    readActive: async () => { this.events.push('active'); await this.onReadActive?.(); return this.active },
    readComplete: async (_hostId: string, revisionId: string) => { this.events.push(`complete:${revisionId}`); return this.completes.get(revisionId) ?? null },
    publishActive: async (_hostId: string, revisionId: string) => {
      const fault = await this.onPublish?.(); this.events.push('publish')
      if (fault === 'before') throw new D1ActivePublishError(false)
      const complete = this.completes.get(revisionId)!
      this.active = { schemaVersion: 1, revisionId, desiredStateDigest: complete.desiredStateDigest }
      if (fault === 'after') throw new D1ActivePublishError(true)
      return this.active
    },
  } as unknown as D1HostRevisionStore
}
function identity(hostId: string, overrides: Partial<D1DestructivePublicationIdentity> = {}): D1DestructivePublicationIdentity {
  return { operationId: `${RUN}-${++serial}`, hostId, expectedRevision: 'r0000000001', expectedDigest: digest('a'),
    targetRevision: 'r0000000002', targetDigest: digest('b'), removalBindingIds: ['alpha', 'zulu'], ...overrides }
}
async function harness() {
  const hostId = host(); const client = postgres(DATABASE_URL, { max: 8 })
  const ledger = createD1AdmissionLedger(mintAttestedD1DatabaseConnection('postgres-eu', client, { ownsClient: true }))
  const revisions = new Revisions(hostId); const journal = createD1DestructivePublicationJournalStore()
  return { hostId, ledger, revisions, journal, close: () => ledger.close() }
}
const reader = (revisions: Revisions): { read(): Promise<D1ActiveCollection | null> } => ({
  async read() {
    const complete = revisions.completes.get(revisions.active.revisionId)
    if (!complete) return null
    const bindings = complete.desired.plan.bindings.map((binding) => ({
      bindingId: binding.bindingId, workspaceId: `workspace:${binding.bindingId}`, defaultDeploymentId: `deployment:${binding.bindingId}`,
    }))
    return { active: revisions.active, desired: { plan: { ...complete.desired.plan, bindings },
      resolvedBindings: bindings.map((binding) => ({ bindingId: binding.bindingId, workspace: binding })) } } as D1ActiveCollection
  },
})
const target = (hostId: string, bindingId: string) => ({ hostId, bindingId, workspaceId: `workspace:${bindingId}`, defaultDeploymentId: `deployment:${bindingId}` })
async function operation(journal: D1DestructivePublicationJournalStore, value: D1DestructivePublicationIdentity) {
  const sql = await admin.reserve(); try { return await journal.readOperation(sql, value.operationId) } finally { sql.release() }
}

beforeAll(async () => { await runMigrations({ databaseUrl: DATABASE_URL } as CoreConfig); admin = postgres(DATABASE_URL, { max: 8 }) })
afterAll(async () => {
  if (!admin) return
  await admin`DELETE FROM d1_binding_admissions WHERE host_id LIKE ${`fenced-${RUN}-%`}`
  await admin.end()
})

describe('D1 fenced destructive publication', () => {
  it('orders fenced checks, committed prepare, transaction-free publication, committed terminal, then unlock', async () => {
    const h = await harness(); const events: string[] = []; let reserved: postgres.ReservedSql | undefined
    h.revisions.events = events
    const ledger = { ...h.ledger, withBindingFences: async <T>(keys: Parameters<D1AdmissionLedger['withBindingFences']>[0], run: (sql: postgres.ReservedSql) => Promise<T>) =>
      h.ledger.withBindingFences(keys, async (sql) => {
        events.push('locked'); reserved = sql
        const observed = new Proxy(sql, { apply(target, thisArg, args: [TemplateStringsArray, ...unknown[]]) {
          if (args[0].join('').includes('d1_binding_admissions')) events.push('admission-clear')
          return Reflect.apply(target, thisArg, args)
        } }) as postgres.ReservedSql
        try { return await run(observed) } finally { events.push('unlocking') }
      }) } as D1AdmissionLedger
    const journal = {
      ...h.journal,
      appendPrepared: async (sql: postgres.ReservedSql, value: D1DestructivePublicationIdentity) => { const result = await h.journal.appendPrepared(sql, value); events.push('prepared'); return result },
      appendTerminal: async (sql: postgres.ReservedSql, value: D1DestructivePublicationIdentity, state: 'committed' | 'aborted') => { const result = await h.journal.appendTerminal(sql, value, state); events.push(`terminal:${state}`); return result },
    }
    h.revisions.onPublish = async () => {
      const [state] = await reserved!<{ assigned: boolean }[]>`SELECT txid_current_if_assigned() IS NOT NULL AS assigned`
      events.push(`publish:transaction=${state!.assigned}`)
    }
    const value = identity(h.hostId)
    await createD1FencedDestructivePublication({ admissionLedger: ledger, journalStore: journal, revisionStore: h.revisions.store }).publish(value)
    expect(events).toEqual([
      'locked', 'active', 'complete:r0000000001', 'complete:r0000000002', 'admission-clear', 'prepared',
      'publish:transaction=false', 'publish', 'terminal:committed', 'unlocking',
    ])
    expect((await operation(h.journal, value))?.terminal?.state).toBe('committed')
    expect(h.revisions.active.revisionId).toBe('r0000000002'); await h.close()
  })

  it('blocks an admitted removal before journal or pointer effects', async () => {
    const h = await harness(); await h.ledger.admit(reader(h.revisions), target(h.hostId, 'zulu')); const value = identity(h.hostId)
    await expect(createD1FencedDestructivePublication({ admissionLedger: h.ledger, journalStore: h.journal, revisionStore: h.revisions.store }).publish(value))
      .rejects.toMatchObject({ code: D1HostErrorCode.BINDING_ADMITTED, details: { bindingId: 'zulu' } })
    expect(await operation(h.journal, value)).toBeNull(); expect(h.revisions.active.revisionId).toBe('r0000000001'); await h.close()
  })

  it('never republishes an operation that already has a terminal event', async () => {
    const h = await harness(); const value = identity(h.hostId); const sql = await admin.reserve()
    try { await h.journal.appendPrepared(sql, value); await h.journal.appendTerminal(sql, value, 'aborted') } finally { sql.release() }
    await expect(createD1FencedDestructivePublication({ admissionLedger: h.ledger, journalStore: h.journal, revisionStore: h.revisions.store }).publish(value))
      .rejects.toMatchObject({ code: D1HostErrorCode.ROLLBACK_JOURNAL_FAILED })
    expect(h.revisions.active.revisionId).toBe('r0000000001'); expect((await operation(h.journal, value))?.terminal?.state).toBe('aborted'); await h.close()
  })

  it('makes first- and last-key first-admission races lose after removal publication', async () => {
    for (const bindingId of ['alpha', 'zulu']) {
      const h = await harness(); const entered = deferred(); const release = deferred()
      h.revisions.onReadActive = async () => { entered.resolve(); await release.promise }
      const value = identity(h.hostId); const publisher = createD1FencedDestructivePublication({ admissionLedger: h.ledger, journalStore: h.journal, revisionStore: h.revisions.store })
      const published = publisher.publish(value); await entered.promise
      const admitted = h.ledger.admit(reader(h.revisions), target(h.hostId, bindingId)); await Promise.resolve(); release.resolve()
      await published
      await expect(admitted).rejects.toMatchObject({ code: D1HostErrorCode.ADMISSION_RECORD_FAILED })
      expect(await h.ledger.listBindingIds(h.hostId, 'postgres-eu')).not.toContain(bindingId); await h.close()
    }
  })

  it('serializes overlapping removal sets without deadlock or stale-pointer publication', async () => {
    const h = await harness(); const entered = deferred(); const release = deferred(); let reads = 0
    h.revisions.onReadActive = async () => { if (++reads === 1) { entered.resolve(); await release.promise } }
    const publisher = createD1FencedDestructivePublication({ admissionLedger: h.ledger, journalStore: h.journal, revisionStore: h.revisions.store })
    const first = publisher.publish(identity(h.hostId)); await entered.promise
    const second = publisher.publish(identity(h.hostId, { targetRevision: 'r0000000003', targetDigest: digest('c'), removalBindingIds: ['bravo', 'zulu'] }))
    release.resolve(); await expect(first).resolves.toBeUndefined()
    await expect(second).rejects.toMatchObject({ code: D1HostErrorCode.REVISION_CONFLICT })
    expect(h.revisions.active.revisionId).toBe('r0000000002'); await h.close()
  })

  it('leaves no false terminal across prepare, publication, terminal, and connection failures', async () => {
    for (const fault of ['prepare', 'prepare-commit', 'publish-before', 'publish-after', 'terminal', 'connection'] as const) {
      const h = await harness(); const value = identity(h.hostId); let reserved: postgres.ReservedSql | undefined
      const ledger = { ...h.ledger, withBindingFences: <T>(keys: Parameters<D1AdmissionLedger['withBindingFences']>[0], run: (sql: postgres.ReservedSql) => Promise<T>) =>
        h.ledger.withBindingFences(keys, async (sql) => {
          reserved = sql
          if (fault !== 'prepare-commit') return run(sql)
          const [backend] = await sql<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
          const interrupted = new Proxy(sql, { async apply(target, thisArg, args: [TemplateStringsArray, ...unknown[]]) {
            const result = await Reflect.apply(target, thisArg, args)
            if (args[0].join('').trim() === 'COMMIT') {
              await admin`SELECT pg_terminate_backend(${backend!.pid})`
              throw Object.assign(new Error('private prepare commit'), { code: 'CONNECTION_CLOSED' })
            }
            return result
          } }) as postgres.ReservedSql
          return run(interrupted)
        }) } as D1AdmissionLedger
      const journal = {
        ...h.journal,
        appendPrepared: fault === 'prepare' ? async () => { throw new Error('private prepare') } : h.journal.appendPrepared,
        appendTerminal: fault === 'terminal' ? async () => { throw new Error('private terminal') } : h.journal.appendTerminal,
      } as D1DestructivePublicationJournalStore
      h.revisions.onPublish = async () => {
        if (fault === 'publish-before') return 'before'
        if (fault === 'publish-after') return 'after'
        if (fault === 'connection') {
          const [backend] = await reserved!<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
          h.revisions.active = { schemaVersion: 1, revisionId: 'r0000000002', desiredStateDigest: digest('b') }
          await admin`SELECT pg_terminate_backend(${backend!.pid})`
        }
      }
      const error = await createD1FencedDestructivePublication({ admissionLedger: ledger, journalStore: journal, revisionStore: h.revisions.store }).publish(value).catch((caught) => caught)
      expect(error).toMatchObject({ code: D1HostErrorCode.ROLLBACK_JOURNAL_FAILED, details: { field: 'rollbackJournal' } })
      expect(JSON.stringify(error)).not.toMatch(/private|postgres:|CONNECTION_/)
      const recorded = await operation(h.journal, value)
      expect(recorded?.prepared.state).toBe(fault === 'prepare' ? undefined : 'prepared')
      expect(recorded?.terminal).toBeUndefined()
      expect(h.revisions.active.revisionId).toBe(fault === 'publish-after' || fault === 'terminal' || fault === 'connection' ? 'r0000000002' : 'r0000000001')
      await h.close().catch(() => {})
    }
  }, 30_000)

  it('rejects artifact and database drift before prepare', async () => {
    for (const fault of ['expected-digest', 'target-digest', 'expected-completion-revision', 'target-completion-revision', 'missing-target', 'incomplete-target', 'expected-database-ref', 'target-database-ref'] as const) {
      const h = await harness(); const value = identity(h.hostId)
      if (fault === 'expected-digest') h.revisions.completes.set('r0000000001', stored(h.hostId, 'r0000000001', digest('d'), ['alpha', 'bravo', 'zulu']))
      if (fault === 'target-digest') h.revisions.completes.set('r0000000002', stored(h.hostId, 'r0000000002', digest('d'), ['bravo']))
      if (fault === 'expected-completion-revision') {
        const expected = h.revisions.completes.get('r0000000001')!
        h.revisions.completes.set('r0000000001', { ...expected, completion: { ...expected.completion, revisionId: 'r0000000002' } })
      }
      if (fault === 'target-completion-revision') {
        const target = h.revisions.completes.get('r0000000002')!
        h.revisions.completes.set('r0000000002', { ...target, completion: { ...target.completion, revisionId: 'r0000000001' } })
      }
      if (fault === 'missing-target' || fault === 'incomplete-target') h.revisions.completes.delete('r0000000002')
      if (fault === 'expected-database-ref') h.revisions.completes.set('r0000000001', stored(h.hostId, 'r0000000001', digest('a'), ['alpha', 'bravo', 'zulu'], 'postgres-other'))
      if (fault === 'target-database-ref') h.revisions.completes.set('r0000000002', stored(h.hostId, 'r0000000002', digest('b'), ['bravo'], 'postgres-other'))
      await expect(createD1FencedDestructivePublication({ admissionLedger: h.ledger, journalStore: h.journal, revisionStore: h.revisions.store }).publish(value)).rejects.toMatchObject({
        code: D1HostErrorCode.ROLLBACK_TARGET_INVALID,
      })
      expect(await operation(h.journal, value)).toBeNull(); expect(h.revisions.active.revisionId).toBe('r0000000001'); await h.close()
    }
  })
})
