import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAgentAssetDigest, createAgentDeploymentDigest, type Sha256Digest } from '@hachej/boring-agent/shared'
import { createResolvedAgentDigest } from '@hachej/boring-agent/server'
import { runMigrations } from '@hachej/boring-core/server'
import type { CoreConfig } from '@hachej/boring-core/shared'

import { createD1AdmissionLedger, mintAttestedD1DatabaseConnection, type D1AdmissionLedger } from '../admissionLedger.js'
import type { D1ActiveCollection } from '../activeCollectionReader.js'
import { createD1DestructivePublicationJournalStore, type D1DestructivePublicationIdentity, type D1DestructivePublicationJournalStore } from '../destructivePublicationJournal.js'
import { D1HostErrorCode } from '../d1Plan.js'
import { canonicalizeD1Observation, createD1CompleteEnvelope, createD1DesiredSnapshot, deriveD1SecretRefsEnvelope, digestD1Desired, type D1DesiredSnapshotV1 } from '../d1RevisionCodec.js'
import { createD1RuntimeInputsIdentity } from '../d1RuntimeInputs.js'
import { createD1FencedDestructivePublication } from '../fencedDestructivePublication.js'
import { D1ActivePublishError, type D1HostRevisionStore, type D1StoredCompleteV1 } from '../hostRevisionStore.js'
import { canonicalizeWorkspaceCompositionSnapshot } from '../workspaceComposition.js'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2)}`
const digest = (value: string): Sha256Digest => `sha256:${value.repeat(64).slice(0, 64)}`
let admin: postgres.Sql; let serial = 0
const host = () => `fenced-${RUN}-${++serial}`
const deferred = () => { let resolve!: () => void; return { promise: new Promise<void>((done) => { resolve = done }), resolve } }

async function desired(hostId: string, bindingIds: readonly string[], databaseRef: string): Promise<D1DesiredSnapshotV1> {
  const planBindings = []; const resolvedBindings = []
  for (const bindingId of bindingIds) {
    const workspaceId = `workspace:${bindingId}`; const deploymentId = `deployment:${bindingId}`
    const snapshot = canonicalizeWorkspaceCompositionSnapshot({
      schemaVersion: 1, domain: 'boring-workspace-composition:v1', workspaceId, runtimeProfile: { ref: 'runsc-eu', id: 'runsc', version: '2026.07.12', contentDigest: digest('1'), isolationAttestationDigest: digest('2'), workspaceRootPolicyRef: 'workspace-roots', sessionRootPolicyRef: 'session-roots' },
      hostAppImageDigest: digest('a'), serverPlugins: [], defaultPluginPackages: [], staticSystemPromptDigest: digest('3'),
      inventories: { capabilities: [], tools: [], skills: null, mcpServers: null }, provisioning: [], filesystemBindings: [], policies: { externalPlugins: false, pluginAuthoring: false },
    })
    const compositionDigest = await createAgentAssetDigest(JSON.stringify(snapshot))
    const definition = { definitionId: `definition:${bindingId}`, version: '1.0.0', digest: digest('4'), instructionsRef: 'instructions.md' }
    const deploymentInput = { deploymentId, version: '2026.07.12', agentId: 'default', definition: { definitionId: definition.definitionId, version: definition.version, digest: definition.digest } }
    const deploymentDigest = await createAgentDeploymentDigest(deploymentInput)
    const resolvedDigest = await createResolvedAgentDigest({ workspaceId, defaultDeploymentId: deploymentId, workspaceCompositionDigest: compositionDigest, definitionDigest: definition.digest, deploymentDigest })
    planBindings.push({ bindingId, hostname: `${bindingId}.example.test`, workspaceId, defaultDeploymentId: deploymentId, bundleRef: 'bundle', deploymentRef: 'deployment', workspaceAllocationRef: `workspace-${bindingId}`, sessionAllocationRef: `session-${bindingId}`, ownerPrincipalRef: 'owner', landing: { title: bindingId, summary: 'Summary.' }, environmentRef: 'production', secretRefs: [`credential-${bindingId}`] })
    resolvedBindings.push({ schemaVersion: 1, bindingId, composition: { snapshot, digest: compositionDigest }, workspace: { workspaceId, defaultDeploymentId: deploymentId, compositionDigest }, deployment: { deploymentId, version: deploymentInput.version, agentId: 'default', digest: deploymentDigest }, definition, resolvedDigest })
  }
  return createD1DesiredSnapshot({ schemaVersion: 1, hostId, expectedHostRevision: null, hostAppImageDigest: digest('a'), runtimeProfileRef: 'runsc-eu', databaseRef, workspaceRootPolicyRef: 'workspace-roots', sessionRootPolicyRef: 'session-roots', bindings: planBindings }, resolvedBindings)
}
async function stored(hostId: string, revisionId: string, bindings: readonly string[], databaseRef = 'postgres-eu'): Promise<D1StoredCompleteV1> {
  const value = await desired(hostId, bindings, databaseRef)
  const observation = await canonicalizeD1Observation({
    schemaVersion: 1, domain: 'boring-d1-observed:v1', bindings: await Promise.all(value.resolvedBindings.map(async (binding) => {
      const planned = value.plan.bindings.find((entry) => entry.bindingId === binding.bindingId)!
      return { bindingId: binding.bindingId, ready: true, resolvedDigest: binding.resolvedDigest, runtimeInputs: await createD1RuntimeInputsIdentity(planned, {
        environment: { versionFingerprint: digest('5') }, workspaceAllocation: { versionFingerprint: digest('6') }, sessionAllocation: { versionFingerprint: digest('7') },
        secrets: planned.secretRefs.map((secretRef) => ({ secretRef, providerVersionFingerprint: digest('8') })), }) }
    })) }, value)
  const desiredStateDigest = await digestD1Desired(value)
  return Object.freeze({ revisionId, desired: value, desiredStateDigest, secretRefs: deriveD1SecretRefsEnvelope(value), observation, completion: await createD1CompleteEnvelope(revisionId, value, observation) })
}
class Revisions {
  readonly completes = new Map<string, D1StoredCompleteV1>(); events: string[] = []; publishCount = 0
  active: { schemaVersion: 1; revisionId: string; desiredStateDigest: `sha256:${string}` }
  onReadActive?: () => Promise<void>; onPublish?: () => Promise<'before' | 'after' | void>
  constructor(readonly hostId: string, completes: readonly D1StoredCompleteV1[]) {
    for (const complete of completes) this.completes.set(complete.revisionId, complete)
    this.active = { schemaVersion: 1, revisionId: 'r0000000001', desiredStateDigest: this.completes.get('r0000000001')!.desiredStateDigest }
  }
  store = {
    readActive: async () => { this.events.push('active'); await this.onReadActive?.(); return this.active },
    readComplete: async (_hostId: string, revisionId: string) => { this.events.push(`complete:${revisionId}`); return this.completes.get(revisionId) ?? null },
    publishActive: async (_hostId: string, revisionId: string) => {
      this.publishCount += 1
      const fault = await this.onPublish?.(); this.events.push('publish')
      if (fault === 'before') throw new D1ActivePublishError(false)
      const complete = this.completes.get(revisionId)!
      this.active = { schemaVersion: 1, revisionId, desiredStateDigest: complete.desiredStateDigest }
      if (fault === 'after') throw new D1ActivePublishError(true)
      return this.active
    },
  } as unknown as D1HostRevisionStore
}
function identity(revisions: Revisions, overrides: Partial<D1DestructivePublicationIdentity> = {}): D1DestructivePublicationIdentity {
  const expectedRevision = overrides.expectedRevision ?? 'r0000000001'; const targetRevision = overrides.targetRevision ?? 'r0000000002'
  return { operationId: `${RUN}-${++serial}`, hostId: revisions.hostId, expectedRevision,
    expectedDigest: revisions.completes.get(expectedRevision)!.desiredStateDigest, targetRevision,
    targetDigest: revisions.completes.get(targetRevision)!.desiredStateDigest, removalBindingIds: ['alpha', 'zulu'], ...overrides }
}
async function harness(onclose?: (connectionId: number) => void, max = 8) {
  const hostId = host(); const client = postgres(DATABASE_URL, { max, onclose })
  const ledger = createD1AdmissionLedger(mintAttestedD1DatabaseConnection('postgres-eu', client, { ownsClient: true }))
  const revisions = new Revisions(hostId, await Promise.all([stored(hostId, 'r0000000001', ['alpha', 'bravo', 'zulu']),
    stored(hostId, 'r0000000002', ['bravo']), stored(hostId, 'r0000000003', ['alpha'])])); const journal = createD1DestructivePublicationJournalStore()
  return { hostId, client, ledger, revisions, journal, close: () => ledger.close() }
}
const reader = (revisions: Revisions): { read(): Promise<D1ActiveCollection | null> } => ({
  async read() {
    const complete = revisions.completes.get(revisions.active.revisionId)
    if (!complete) return null
    return {
      active: revisions.active,
      desired: complete.desired,
      observation: complete.observation,
      completion: complete.completion,
    }
  },
})
const target = (hostId: string, bindingId: string) => ({ hostId, bindingId, workspaceId: `workspace:${bindingId}`, defaultDeploymentId: `deployment:${bindingId}` })
async function operation(journal: D1DestructivePublicationJournalStore, value: D1DestructivePublicationIdentity) {
  const sql = await admin.reserve(); try { return await journal.readOperation(sql, value.operationId) } finally { sql.release() }
}
async function prepare(journal: D1DestructivePublicationJournalStore, value: D1DestructivePublicationIdentity) {
  const sql = await admin.reserve(); try { await journal.appendPrepared(sql, value) } finally { sql.release() }
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
    const value = identity(h.revisions)
    await createD1FencedDestructivePublication({ admissionLedger: ledger, journalStore: journal, revisionStore: h.revisions.store }).publish(value)
    expect(events).toEqual([
      'locked', 'active', 'complete:r0000000001', 'complete:r0000000002', 'admission-clear', 'prepared',
      'publish:transaction=false', 'publish', 'terminal:committed', 'unlocking',
    ])
    expect((await operation(h.journal, value))?.terminal?.state).toBe('committed')
    expect(h.revisions.active.revisionId).toBe('r0000000002'); await h.close()
  })

  it('blocks an admitted removal before journal or pointer effects', async () => {
    const h = await harness(); await h.ledger.admit(reader(h.revisions), target(h.hostId, 'zulu')); const value = identity(h.revisions)
    await expect(createD1FencedDestructivePublication({ admissionLedger: h.ledger, journalStore: h.journal, revisionStore: h.revisions.store }).publish(value))
      .rejects.toMatchObject({ code: D1HostErrorCode.BINDING_ADMITTED, details: { bindingId: 'zulu' } })
    expect(await operation(h.journal, value)).toBeNull(); expect(h.revisions.active.revisionId).toBe('r0000000001'); await h.close()
  })

  it('never republishes an operation that already has a terminal event', async () => {
    const h = await harness(); const value = identity(h.revisions); const sql = await admin.reserve()
    try { await h.journal.appendPrepared(sql, value); await h.journal.appendTerminal(sql, value, 'aborted') } finally { sql.release() }
    await expect(createD1FencedDestructivePublication({ admissionLedger: h.ledger, journalStore: h.journal, revisionStore: h.revisions.store }).publish(value))
      .rejects.toMatchObject({ code: D1HostErrorCode.ROLLBACK_JOURNAL_FAILED })
    expect(h.revisions.active.revisionId).toBe('r0000000001'); expect((await operation(h.journal, value))?.terminal?.state).toBe('aborted'); await h.close()
  })

  it('makes first- and last-key first-admission races lose after removal publication', async () => {
    for (const bindingId of ['alpha', 'zulu']) {
      const h = await harness(); const entered = deferred(); const release = deferred()
      h.revisions.onReadActive = async () => { entered.resolve(); await release.promise }
      const value = identity(h.revisions); const publisher = createD1FencedDestructivePublication({ admissionLedger: h.ledger, journalStore: h.journal, revisionStore: h.revisions.store })
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
    const first = publisher.publish(identity(h.revisions)); await entered.promise
    const second = publisher.publish(identity(h.revisions, { targetRevision: 'r0000000003', removalBindingIds: ['bravo', 'zulu'] }))
    release.resolve(); await expect(first).resolves.toBeUndefined()
    await expect(second).rejects.toMatchObject({ code: D1HostErrorCode.REVISION_CONFLICT })
    expect(h.revisions.active.revisionId).toBe('r0000000002'); await h.close()
  })

  it('leaves no false terminal across prepare, publication, terminal, and connection failures', async () => {
    for (const fault of ['prepare', 'prepare-rollback', 'prepare-commit', 'publish-before', 'publish-after', 'terminal', 'connection'] as const) {
      const h = await harness(); const value = identity(h.revisions); let reserved: postgres.ReservedSql | undefined; let internalError: unknown
      const ledger = { ...h.ledger, withBindingFences: <T>(keys: Parameters<D1AdmissionLedger['withBindingFences']>[0], run: (sql: postgres.ReservedSql) => Promise<T>) =>
        h.ledger.withBindingFences(keys, async (sql) => {
          reserved = sql
          const invoke = async (connection: postgres.ReservedSql) => {
            try { return await run(connection) } catch (error) { internalError = error; throw error }
          }
          if (fault !== 'prepare-commit') return invoke(sql)
          const [backend] = await sql<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
          const interrupted = new Proxy(sql, { async apply(target, thisArg, args: [TemplateStringsArray, ...unknown[]]) {
            const result = await Reflect.apply(target, thisArg, args)
            if (args[0].join('').trim() === 'COMMIT') {
              await admin`SELECT pg_terminate_backend(${backend!.pid})`
              throw Object.assign(new Error('private prepare commit'), { code: 'CONNECTION_CLOSED' })
            }
            return result
          } }) as postgres.ReservedSql
          return invoke(interrupted)
        }) } as D1AdmissionLedger
      const journal = {
        ...h.journal,
        appendPrepared: fault === 'prepare' ? async () => { throw new Error('private prepare') }
          : fault === 'prepare-rollback' ? async (sql: postgres.ReservedSql) => {
            const [backend] = await sql<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
            await admin`SELECT pg_terminate_backend(${backend!.pid})`
            throw new Error('private prepare rollback')
          } : h.journal.appendPrepared,
        appendTerminal: fault === 'terminal' ? async () => { throw new Error('private terminal') } : h.journal.appendTerminal,
      } as D1DestructivePublicationJournalStore
      h.revisions.onPublish = async () => {
        if (fault === 'publish-before') return 'before'
        if (fault === 'publish-after') return 'after'
        if (fault === 'connection') {
          const [backend] = await reserved!<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
          h.revisions.active = { schemaVersion: 1, revisionId: 'r0000000002', desiredStateDigest: h.revisions.completes.get('r0000000002')!.desiredStateDigest }
          await admin`SELECT pg_terminate_backend(${backend!.pid})`
        }
      }
      const error = await createD1FencedDestructivePublication({ admissionLedger: ledger, journalStore: journal, revisionStore: h.revisions.store }).publish(value).catch((caught) => caught)
      expect(error).toMatchObject({ code: D1HostErrorCode.ROLLBACK_JOURNAL_FAILED, details: { field: 'rollbackJournal' } })
      expect(JSON.stringify(error)).not.toMatch(/private|postgres:|CONNECTION_/)
      if (fault === 'prepare-rollback' || fault === 'prepare-commit' || fault === 'connection') {
        expect(internalError).toMatchObject({ code: 'CONNECTION_CLOSED', message: 'D1_RESERVED_CONNECTION_LOST' })
      }
      const recorded = await operation(h.journal, value)
      expect(recorded?.prepared.state).toBe(fault === 'prepare' || fault === 'prepare-rollback' ? undefined : 'prepared')
      expect(recorded?.terminal).toBeUndefined()
      expect(h.revisions.active.revisionId).toBe(fault === 'publish-after' || fault === 'terminal' || fault === 'connection' ? 'r0000000002' : 'r0000000001')
      await h.close().catch(() => {})
    }
  }, 30_000)

  it('rejects artifact and database drift before prepare', async () => {
    for (const fault of ['expected-digest', 'target-digest', 'desired-content', 'observation-content', 'secret-refs', 'expected-completion-revision', 'target-completion-revision', 'missing-target', 'incomplete-target', 'incomplete-digest', 'expected-database-ref', 'target-database-ref'] as const) {
      const h = await harness(); let value = identity(h.revisions)
      if (fault === 'expected-digest') h.revisions.completes.set('r0000000001', { ...h.revisions.completes.get('r0000000001')!, desiredStateDigest: digest('d') })
      if (fault === 'target-digest') h.revisions.completes.set('r0000000002', { ...h.revisions.completes.get('r0000000002')!, desiredStateDigest: digest('d') })
      if (fault === 'desired-content') {
        const target = h.revisions.completes.get('r0000000002')!
        h.revisions.completes.set('r0000000002', { ...target, desired: { ...target.desired, plan: { ...target.desired.plan,
          bindings: target.desired.plan.bindings.map((binding) => ({ ...binding, landing: { ...binding.landing, title: `${binding.landing.title}-tampered` } })),
        } } })
      }
      if (fault === 'observation-content') {
        const target = h.revisions.completes.get('r0000000002')!
        h.revisions.completes.set('r0000000002', { ...target, observation: { ...target.observation,
          bindings: target.observation.bindings.map((binding) => ({ ...binding, ready: false })),
        } })
      }
      if (fault === 'secret-refs') {
        const target = h.revisions.completes.get('r0000000002')!
        h.revisions.completes.set('r0000000002', { ...target, secretRefs: { ...target.secretRefs,
          bindings: target.secretRefs.bindings.map((binding) => ({ ...binding, secretRefs: ['credential-tampered'] })),
        } })
      }
      if (fault === 'expected-completion-revision') {
        const expected = h.revisions.completes.get('r0000000001')!
        h.revisions.completes.set('r0000000001', { ...expected, completion: { ...expected.completion, revisionId: 'r0000000002' } })
      }
      if (fault === 'target-completion-revision') {
        const target = h.revisions.completes.get('r0000000002')!
        h.revisions.completes.set('r0000000002', { ...target, completion: { ...target.completion, revisionId: 'r0000000001' } })
      }
      if (fault === 'missing-target') h.revisions.completes.delete('r0000000002')
      if (fault === 'incomplete-target') {
        const target = h.revisions.completes.get('r0000000002')!
        h.revisions.completes.set('r0000000002', { ...target, completion: undefined } as unknown as D1StoredCompleteV1)
      }
      if (fault === 'incomplete-digest') {
        const target = h.revisions.completes.get('r0000000002')!
        h.revisions.completes.set('r0000000002', { ...target, completion: { ...target.completion, completionDigest: undefined } } as unknown as D1StoredCompleteV1)
      }
      if (fault === 'expected-database-ref') {
        const replacement = await stored(h.hostId, 'r0000000001', ['alpha', 'bravo', 'zulu'], 'postgres-other')
        h.revisions.completes.set('r0000000001', replacement); value = { ...value, expectedDigest: replacement.desiredStateDigest }
        h.revisions.active = { ...h.revisions.active, desiredStateDigest: replacement.desiredStateDigest }
      }
      if (fault === 'target-database-ref') {
        const replacement = await stored(h.hostId, 'r0000000002', ['bravo'], 'postgres-other')
        h.revisions.completes.set('r0000000002', replacement); value = { ...value, targetDigest: replacement.desiredStateDigest }
      }
      await expect(createD1FencedDestructivePublication({ admissionLedger: h.ledger, journalStore: h.journal, revisionStore: h.revisions.store }).publish(value)).rejects.toMatchObject({
        code: D1HostErrorCode.ROLLBACK_TARGET_INVALID,
      })
      expect(await operation(h.journal, value)).toBeNull(); expect(h.revisions.active.revisionId).toBe('r0000000001'); await h.close()
    }
    const h = await harness(); const value = identity(h.revisions)
    const revisionStore = { ...h.revisions.store, readComplete: async () => { throw new Error('private read failure') } } as D1HostRevisionStore
    const caught = await createD1FencedDestructivePublication({ admissionLedger: h.ledger, journalStore: h.journal, revisionStore }).publish(value).catch((error) => error)
    expect(caught).toMatchObject({ code: D1HostErrorCode.ROLLBACK_JOURNAL_FAILED }); expect(JSON.stringify(caught)).not.toMatch(/private/)
    expect(await operation(h.journal, value)).toBeNull(); await h.close()
  })

  it('recovers a committed prepare under exact fences with no SQL transaction open during publication', async () => {
    const h = await harness(); const value = identity(h.revisions); await prepare(h.journal, value)
    let reserved: postgres.ReservedSql | undefined; let transactionOpen = true
    const ledger = { ...h.ledger, withBindingFences: <T>(keys: Parameters<D1AdmissionLedger['withBindingFences']>[0], run: (sql: postgres.ReservedSql) => Promise<T>) =>
      h.ledger.withBindingFences(keys, async (sql) => { reserved = sql; return run(sql) }) } as D1AdmissionLedger
    h.revisions.onPublish = async () => {
      const [state] = await reserved!<{ assigned: boolean }[]>`SELECT txid_current_if_assigned() IS NOT NULL AS assigned`
      transactionOpen = state!.assigned
    }
    await createD1FencedDestructivePublication({ admissionLedger: ledger, journalStore: h.journal, revisionStore: h.revisions.store }).recoverPending(h.hostId)
    expect(transactionOpen).toBe(false); expect(h.revisions.active.revisionId).toBe('r0000000002')
    expect((await operation(h.journal, value))?.terminal?.state).toBe('committed'); await h.close()
  })

  it('preserves the client close callback, bounds a killed publisher, and lets recovery converge', async () => {
    let closeCount = 0; const h = await harness(() => { closeCount += 1 }, 2); const value = identity(h.revisions); let reserved: postgres.ReservedSql | undefined; let backendPid = 0
    const entered = deferred(); const release = deferred()
    const publishingLedger = { ...h.ledger,
      withBindingFences: <T>(keys: Parameters<D1AdmissionLedger['withBindingFences']>[0], run: (sql: postgres.ReservedSql) => Promise<T>) =>
        h.ledger.withBindingFences(keys, async (sql) => { reserved = sql; return run(sql) }),
    } as D1AdmissionLedger
    const recoveryLedger = createD1AdmissionLedger(mintAttestedD1DatabaseConnection('postgres-eu', postgres(DATABASE_URL), { ownsClient: true }))
    h.revisions.onPublish = async () => {
      const [backend] = await reserved!<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
      backendPid = backend!.pid; entered.resolve(); await release.promise
    }
    const publisher = createD1FencedDestructivePublication({ admissionLedger: publishingLedger, journalStore: h.journal, revisionStore: h.revisions.store }); const publishing = publisher.publish(value).catch((error) => error); await entered.promise
    const unrelated = await h.client.reserve(); const [other] = await unrelated<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`; await admin`SELECT pg_terminate_backend(${other!.pid})`; unrelated.release()
    await expect(reserved!`SELECT 1 AS healthy`).resolves.toHaveLength(1)
    let admissionError: unknown
    try {
      await admin`SELECT pg_terminate_backend(${backendPid})`
      admissionError = await recoveryLedger.admit(reader(h.revisions), target(h.hostId, 'alpha')).catch((error) => error)
    } finally { release.resolve() }
    const publishError = await publishing
    expect(publishError).toMatchObject({ code: D1HostErrorCode.ROLLBACK_JOURNAL_FAILED }); expect(admissionError).toMatchObject({ code: D1HostErrorCode.ADMISSION_RECORD_FAILED }); expect(closeCount).toBeGreaterThan(0)
    expect(await admin`SELECT 1 FROM d1_binding_admissions WHERE host_id = ${h.hostId} AND binding_id = 'alpha'`).toHaveLength(0)
    expect((await operation(h.journal, value))?.terminal).toBeUndefined()
    expect(h.revisions.active.revisionId).toBe(value.targetRevision)
    h.revisions.onPublish = undefined
    await createD1FencedDestructivePublication({ admissionLedger: recoveryLedger, journalStore: h.journal, revisionStore: h.revisions.store }).recoverPending(h.hostId)
    expect((await operation(h.journal, value))?.terminal?.state).toBe('committed')
    expect(h.revisions.publishCount).toBe(1)
    await recoveryLedger.close(); await h.close()
  }, 30_000)

  it('finalizes an already-published target without republishing', async () => {
    const h = await harness(); const value = identity(h.revisions); await prepare(h.journal, value)
    h.revisions.active = { schemaVersion: 1, revisionId: value.targetRevision, desiredStateDigest: value.targetDigest }
    await createD1FencedDestructivePublication({ admissionLedger: h.ledger, journalStore: h.journal, revisionStore: h.revisions.store }).recoverPending(h.hostId)
    expect(h.revisions.publishCount).toBe(0); expect((await operation(h.journal, value))?.terminal?.state).toBe('committed'); await h.close()
  })

  it('rejects admission behind a durable prepare and aborts recovery for an already-persisted admission', async () => {
    const h = await harness(); const value = identity(h.revisions); h.revisions.onPublish = async () => 'before'
    const publisher = createD1FencedDestructivePublication({ admissionLedger: h.ledger, journalStore: h.journal, revisionStore: h.revisions.store })
    await expect(publisher.publish(value)).rejects.toMatchObject({ code: D1HostErrorCode.ROLLBACK_JOURNAL_FAILED })
    h.revisions.onPublish = undefined
    await expect(h.ledger.admit(reader(h.revisions), target(h.hostId, 'alpha'))).rejects.toMatchObject({ code: D1HostErrorCode.ADMISSION_RECORD_FAILED })
    await admin`INSERT INTO d1_binding_admissions (host_id, binding_id, active_revision) VALUES (${h.hostId}, 'alpha', ${value.expectedRevision})`
    await publisher.recoverPending(h.hostId)
    expect(h.revisions.active.revisionId).toBe(value.expectedRevision)
    expect((await operation(h.journal, value))?.terminal?.state).toBe('aborted'); await h.close()
  })

  it('processes stale discovery in journal sequence, skips new terminals, and requests sorted operation fences', async () => {
    const h = await harness(); const first = identity(h.revisions); const second = identity(h.revisions, {
      targetRevision: 'r0000000003', removalBindingIds: ['bravo', 'zulu'],
    })
    await prepare(h.journal, first); await prepare(h.journal, second)
    const calls: string[][] = []; const readOrder: string[] = []
    const ledger = { ...h.ledger, withBindingFences: <T>(keys: Parameters<D1AdmissionLedger['withBindingFences']>[0], run: (sql: postgres.ReservedSql) => Promise<T>) => {
      calls.push(keys.map((key) => key.bindingId)); return h.ledger.withBindingFences(keys, run)
    } } as D1AdmissionLedger
    const journal = { ...h.journal,
      readPending: async (sql: postgres.ReservedSql, hostId: string) => {
        const pending = await h.journal.readPending(sql, hostId)
        const other = await admin.reserve()
        try { await h.journal.appendTerminal(other, first, 'aborted'); await h.journal.appendTerminal(other, second, 'aborted') } finally { other.release() }
        return pending
      },
      readOperation: async (sql: postgres.ReservedSql, operationId: string) => { readOrder.push(operationId); return h.journal.readOperation(sql, operationId) },
    }
    await createD1FencedDestructivePublication({ admissionLedger: ledger, journalStore: journal, revisionStore: h.revisions.store }).recoverPending(h.hostId)
    expect(readOrder).toEqual([first.operationId, second.operationId])
    expect(calls.slice(1)).toEqual([['alpha', 'zulu'], ['bravo', 'zulu']]); expect(h.revisions.publishCount).toBe(0); await h.close()
  })

  it('fails closed for artifact, history, and active-pointer drift without fabricating a terminal', async () => {
    for (const fault of ['wrapper', 'wrapper-incomplete', 'embedded', 'digest', 'foreign-host', 'foreign-database', 'missing', 'incomplete', 'bindings', 'third-pointer', 'history'] as const) {
      const h = await harness(); const value = identity(h.revisions); await prepare(h.journal, value)
      const expected = h.revisions.completes.get(value.expectedRevision)!; const targetRevision = h.revisions.completes.get(value.targetRevision)!
      if (fault === 'wrapper') h.revisions.completes.set(value.targetRevision, { ...targetRevision, revisionId: value.expectedRevision })
      if (fault === 'wrapper-incomplete') h.revisions.completes.set(value.targetRevision, { ...targetRevision, observation: undefined } as unknown as D1StoredCompleteV1)
      if (fault === 'embedded') h.revisions.completes.set(value.targetRevision, { ...targetRevision, completion: { ...targetRevision.completion, status: 'BROKEN' } } as unknown as D1StoredCompleteV1)
      if (fault === 'digest') h.revisions.completes.set(value.expectedRevision, { ...expected, completion: { ...expected.completion, desiredStateDigest: digest('d') } })
      if (fault === 'foreign-host') h.revisions.completes.set(value.expectedRevision, await stored(`${h.hostId}-foreign`, value.expectedRevision, ['alpha', 'bravo', 'zulu']))
      if (fault === 'foreign-database') h.revisions.completes.set(value.targetRevision, await stored(h.hostId, value.targetRevision, ['bravo'], 'postgres-other'))
      if (fault === 'missing') h.revisions.completes.delete(value.expectedRevision)
      if (fault === 'incomplete') h.revisions.completes.set(value.targetRevision, {
        ...targetRevision, completion: { ...targetRevision.completion, completionDigest: undefined },
      } as unknown as D1StoredCompleteV1)
      if (fault === 'bindings') h.revisions.completes.set(value.targetRevision, {
        ...targetRevision, desired: { ...targetRevision.desired, plan: { ...targetRevision.desired.plan, bindings: undefined } },
      } as unknown as D1StoredCompleteV1)
      if (fault === 'third-pointer') h.revisions.active = { schemaVersion: 1, revisionId: 'r0000000003', desiredStateDigest: h.revisions.completes.get('r0000000003')!.desiredStateDigest }
      const journal = fault === 'history' ? { ...h.journal, readOperation: async () => null } : h.journal
      const caught = await createD1FencedDestructivePublication({ admissionLedger: h.ledger, journalStore: journal, revisionStore: h.revisions.store }).recoverPending(h.hostId).catch((error) => error)
      expect(caught).toMatchObject({ code: D1HostErrorCode.ROLLBACK_JOURNAL_FAILED })
      expect(JSON.stringify(caught)).not.toMatch(/postgres:|private|CONNECTION_/)
      expect((await operation(h.journal, value))?.terminal).toBeUndefined(); await h.close()
    }
  })

  it('keeps publication and terminal ambiguity retryable until recovery converges', async () => {
    for (const fault of ['publication-before', 'publication-after', 'terminal', 'lost-terminal-response'] as const) {
      const h = await harness(); const value = identity(h.revisions); await prepare(h.journal, value); let failed = true
      if (fault.startsWith('publication')) h.revisions.onPublish = async () => fault === 'publication-before' ? 'before' : 'after'
      const journal = fault === 'terminal' ? { ...h.journal, appendTerminal: async () => { throw new Error('private terminal') } }
        : h.journal
      const ledger = fault === 'lost-terminal-response' ? { ...h.ledger,
        withBindingFences: <T>(keys: Parameters<D1AdmissionLedger['withBindingFences']>[0], run: (sql: postgres.ReservedSql) => Promise<T>) => h.ledger.withBindingFences(keys, (sql) => run(new Proxy(sql, {
          async apply(target, thisArg, args: [TemplateStringsArray, ...unknown[]]) {
            const result = await Reflect.apply(target, thisArg, args)
            if (failed && args[0].join('').trim() === 'COMMIT') { failed = false; throw Object.assign(new Error('private response'), { code: 'CONNECTION_CLOSED' }) }
            return result
          },
        }) as postgres.ReservedSql)),
      } as D1AdmissionLedger : h.ledger
      const recovering = createD1FencedDestructivePublication({ admissionLedger: ledger, journalStore: journal, revisionStore: h.revisions.store })
      await expect(recovering.recoverPending(h.hostId)).rejects.toMatchObject({ code: D1HostErrorCode.ROLLBACK_JOURNAL_FAILED })
      h.revisions.onPublish = undefined
      const retryLedger = fault === 'lost-terminal-response'
        ? createD1AdmissionLedger(mintAttestedD1DatabaseConnection('postgres-eu', postgres(DATABASE_URL), { ownsClient: true })) : h.ledger
      await createD1FencedDestructivePublication({ admissionLedger: retryLedger, journalStore: h.journal, revisionStore: h.revisions.store }).recoverPending(h.hostId)
      expect((await operation(h.journal, value))?.terminal?.state).toBe('committed'); expect(h.revisions.active.revisionId).toBe(value.targetRevision)
      if (retryLedger !== h.ledger) await retryLedger.close(); await h.close().catch(() => {})
    }
  })

  it('makes first- and last-key admissions lose against recovered removal fences', async () => {
    for (const bindingId of ['alpha', 'zulu']) {
      const h = await harness(); const value = identity(h.revisions); await prepare(h.journal, value)
      const entered = deferred(); const release = deferred(); h.revisions.onReadActive = async () => { entered.resolve(); await release.promise }
      const recovering = createD1FencedDestructivePublication({ admissionLedger: h.ledger, journalStore: h.journal, revisionStore: h.revisions.store }).recoverPending(h.hostId)
      await entered.promise; const admission = h.ledger.admit(reader(h.revisions), target(h.hostId, bindingId)); await Promise.resolve(); release.resolve()
      await recovering; await expect(admission).rejects.toMatchObject({ code: D1HostErrorCode.ADMISSION_RECORD_FAILED })
      expect((await operation(h.journal, value))?.terminal?.state).toBe('committed'); await h.close()
    }
  })
})
