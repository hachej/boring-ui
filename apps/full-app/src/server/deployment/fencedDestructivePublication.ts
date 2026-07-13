import type postgres from 'postgres'
import { isD1ReservedConnectionLost, type D1AdmissionLedger } from './admissionLedger.js'
import {
  normalizeD1DestructivePublicationIdentity,
  type D1DestructivePublicationIdentity,
  type D1DestructivePublicationJournalStore,
} from './destructivePublicationJournal.js'
import { D1HostError, D1HostErrorCode } from './d1Plan.js'
import {
  canonicalizeD1CompleteEnvelope,
  canonicalizeD1DesiredSnapshot,
  canonicalizeD1Observation,
  canonicalizeD1SecretRefsEnvelope,
  digestD1Desired,
} from './d1RevisionCodec.js'
import type { D1HostRevisionStore } from './hostRevisionStore.js'

export interface D1FencedDestructivePublication {
  /** The caller holds the D1 per-host OS mutation lock for this entire operation. */
  publish(identity: D1DestructivePublicationIdentity): Promise<void>
  /** The caller holds the D1 per-host OS mutation lock before discovery starts. */
  recoverPending(hostId: string): Promise<void>
}

const preserved = new Set<D1HostErrorCode>([
  D1HostErrorCode.REVISION_CONFLICT,
  D1HostErrorCode.ROLLBACK_TARGET_INVALID,
  D1HostErrorCode.BINDING_ADMITTED,
  D1HostErrorCode.ROLLBACK_JOURNAL_FAILED,
])
function failed(field = 'rollbackJournal'): D1HostError {
  return new D1HostError(D1HostErrorCode.ROLLBACK_JOURNAL_FAILED, { field })
}
function targetInvalid(field: string): D1HostError {
  return new D1HostError(D1HostErrorCode.ROLLBACK_TARGET_INVALID, { field })
}
function connectionLost(error: unknown): boolean {
  const code = error instanceof Error ? (error as Error & { code?: unknown }).code : undefined
  return code === 'CONNECTION_CLOSED' || code === 'CONNECTION_DESTROYED' || code === 'CONNECTION_ENDED' || code === 'ECONNRESET' || code === 'EPIPE'
}
function internalConnectionLost(): Error {
  return Object.assign(new Error('D1_RESERVED_CONNECTION_LOST'), { code: 'CONNECTION_CLOSED' })
}
function sameIdentity(left: D1DestructivePublicationIdentity, right: D1DestructivePublicationIdentity): boolean {
  return left.operationId === right.operationId && left.hostId === right.hostId
    && left.expectedRevision === right.expectedRevision && left.expectedDigest === right.expectedDigest
    && left.targetRevision === right.targetRevision && left.targetDigest === right.targetDigest
    && left.removalBindingIds.length === right.removalBindingIds.length
    && left.removalBindingIds.every((value, index) => value === right.removalBindingIds[index])
}
async function bounded(value: PromiseLike<unknown>): Promise<boolean> {
  const pending = Promise.resolve(value); let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([pending.then(() => true), new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), 5_000) })]) }
  finally { if (timer) clearTimeout(timer); void pending.catch(() => {}) }
}
async function transaction(sql: postgres.ReservedSql, operation: () => Promise<unknown>): Promise<void> {
  let open = false
  try {
    if (isD1ReservedConnectionLost(sql) || !await bounded(sql`BEGIN`)) throw internalConnectionLost()
    open = true
    await operation()
    if (isD1ReservedConnectionLost(sql) || !await bounded(sql`COMMIT`)) throw internalConnectionLost()
    open = false
  } catch (error) {
    if (connectionLost(error)) throw internalConnectionLost()
    if (open) try { if (!await bounded(sql`ROLLBACK`)) throw internalConnectionLost() } catch { throw internalConnectionLost() }
    throw failed()
  }
}

export function createD1FencedDestructivePublication(input: {
  readonly admissionLedger: D1AdmissionLedger
  readonly journalStore: D1DestructivePublicationJournalStore
  readonly revisionStore: D1HostRevisionStore
}): D1FencedDestructivePublication {
  const validateArtifacts = async (identity: D1DestructivePublicationIdentity, invalid: (field: string) => D1HostError) => {
    const [expected, target] = await Promise.all([
      input.revisionStore.readComplete(identity.hostId, identity.expectedRevision),
      input.revisionStore.readComplete(identity.hostId, identity.targetRevision),
    ])
    const exactComplete = async (value: typeof expected, revision: string, digest: string): Promise<boolean> => {
      if (!value || Object.keys(value).sort().join(',') !== 'completion,desired,desiredStateDigest,observation,revisionId,secretRefs'
        || !value.observation || typeof value.observation !== 'object' || !value.secretRefs || typeof value.secretRefs !== 'object'
        || !value.completion) return false
      try {
        const desired = await canonicalizeD1DesiredSnapshot(value.desired)
        const secretRefs = canonicalizeD1SecretRefsEnvelope(value.secretRefs, desired)
        const observation = await canonicalizeD1Observation(value.observation, desired)
        const completion = await canonicalizeD1CompleteEnvelope(value.completion, desired, observation)
        return value.revisionId === revision
          && value.desiredStateDigest === digest
          && await digestD1Desired(desired) === digest
          && completion.revisionId === revision
          && completion.desiredStateDigest === digest
          && desired.plan.hostId === identity.hostId
          && desired.plan.databaseRef === input.admissionLedger.databaseRef
          && JSON.stringify(desired) === JSON.stringify(value.desired)
          && JSON.stringify(secretRefs) === JSON.stringify(value.secretRefs)
          && JSON.stringify(observation) === JSON.stringify(value.observation)
          && JSON.stringify(completion) === JSON.stringify(value.completion)
      } catch { return false }
    }
    if (!await exactComplete(expected, identity.expectedRevision, identity.expectedDigest)) throw invalid('expectedRevision')
    if (!await exactComplete(target, identity.targetRevision, identity.targetDigest)) throw invalid('targetRevision')
    const bindingIds = (value: typeof expected): readonly string[] | null => {
      if (!value) return null
      return value.desired.plan.bindings.map((binding) => binding.bindingId)
    }
    const expectedIds = bindingIds(expected); const targetBindingIds = bindingIds(target)
    if (!expectedIds || !targetBindingIds) throw invalid('bindings')
    const targetIds = new Set(targetBindingIds)
    const removals = expectedIds.filter((id) => !targetIds.has(id))
    if (removals.length !== identity.removalBindingIds.length
      || removals.some((id, index) => id !== identity.removalBindingIds[index])) throw invalid('removalBindingIds')
  }
  const readAdmissions = async (sql: postgres.ReservedSql, identity: D1DestructivePublicationIdentity) => {
    try {
      return await sql<{ bindingId: string }[]>`
        SELECT binding_id AS "bindingId" FROM d1_binding_admissions
        WHERE host_id = ${identity.hostId} AND binding_id = ANY(${identity.removalBindingIds as string[]})
        ORDER BY binding_id LIMIT 1
      `
    } catch { throw new D1HostError(D1HostErrorCode.ADMISSION_RECORD_FAILED, { field: 'admission' }) }
  }
  const publish = async (raw: D1DestructivePublicationIdentity): Promise<void> => {
    let identity: D1DestructivePublicationIdentity
    let journalStarted = false
    try { identity = normalizeD1DestructivePublicationIdentity(raw) } catch { throw targetInvalid('publicationIdentity') }
    try {
      await input.admissionLedger.withBindingFences(
        identity.removalBindingIds.map((bindingId) => ({ hostId: identity.hostId, bindingId })),
        async (sql) => {
          let active
          try { active = await input.revisionStore.readActive(identity.hostId) } catch {
            throw new D1HostError(D1HostErrorCode.REVISION_CONFLICT, { field: 'expectedHostRevision' })
          }
          if (!active || active.revisionId !== identity.expectedRevision || active.desiredStateDigest !== identity.expectedDigest) {
            throw new D1HostError(D1HostErrorCode.REVISION_CONFLICT, { field: 'expectedHostRevision' })
          }
          await validateArtifacts(identity, targetInvalid)
          const rows = await readAdmissions(sql, identity)
          if (rows[0]) throw new D1HostError(D1HostErrorCode.BINDING_ADMITTED, { bindingId: rows[0].bindingId })
          journalStarted = true
          await transaction(sql, async () => {
            if ((await input.journalStore.readOperation(sql, identity.operationId))?.terminal) throw failed()
            await input.journalStore.appendPrepared(sql, identity)
          })
          try { await input.revisionStore.publishActive(identity.hostId, identity.targetRevision) } catch { throw failed() }
          await transaction(sql, () => input.journalStore.appendTerminal(sql, identity, 'committed'))
        },
      )
    } catch (error) {
      if (journalStarted && error instanceof D1HostError && error.code === D1HostErrorCode.ADMISSION_RECORD_FAILED) throw failed()
      if (error instanceof D1HostError && (preserved.has(error.code) || error.code === D1HostErrorCode.ADMISSION_RECORD_FAILED)) throw error
      throw failed()
    }
  }
  const recoverPending = async (hostId: string): Promise<void> => {
    try {
      // Discovery needs a reserved handle but no operation lock; the OS host lock serializes callers.
      const pending = await input.admissionLedger.withBindingFences(
        [{ hostId, bindingId: 'd1-publication-recovery' }],
        (sql) => input.journalStore.readPending(sql, hostId),
      )
      for (const discovered of [...pending].sort((left, right) => left.sequence < right.sequence ? -1 : left.sequence > right.sequence ? 1 : 0)) {
        await input.admissionLedger.withBindingFences(
          discovered.removalBindingIds.map((bindingId) => ({ hostId: discovered.hostId, bindingId })),
          async (sql) => {
            const operation = await input.journalStore.readOperation(sql, discovered.operationId)
            if (operation?.terminal) return
            if (!operation || !sameIdentity(operation.prepared, discovered)) throw failed()
            const identity = operation.prepared
            await validateArtifacts(identity, () => failed())
            const active = await input.revisionStore.readActive(identity.hostId).catch(() => { throw failed() })
            if (active?.revisionId === identity.targetRevision && active.desiredStateDigest === identity.targetDigest) {
              await transaction(sql, () => input.journalStore.appendTerminal(sql, identity, 'committed'))
              return
            }
            if (active?.revisionId !== identity.expectedRevision || active.desiredStateDigest !== identity.expectedDigest) throw failed()
            if ((await readAdmissions(sql, identity))[0]) {
              await transaction(sql, () => input.journalStore.appendTerminal(sql, identity, 'aborted'))
              return
            }
            await input.revisionStore.publishActive(identity.hostId, identity.targetRevision).catch(() => { throw failed() })
            await transaction(sql, () => input.journalStore.appendTerminal(sql, identity, 'committed'))
          },
        )
      }
    } catch { throw failed() }
  }
  return Object.freeze({ publish, recoverPending })
}
