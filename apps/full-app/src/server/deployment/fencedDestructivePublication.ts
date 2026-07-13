import type postgres from 'postgres'

import type { D1AdmissionLedger } from './admissionLedger.js'
import {
  normalizeD1DestructivePublicationIdentity,
  type D1DestructivePublicationIdentity,
  type D1DestructivePublicationJournalStore,
} from './destructivePublicationJournal.js'
import { D1HostError, D1HostErrorCode } from './d1Plan.js'
import type { D1HostRevisionStore } from './hostRevisionStore.js'

export interface D1FencedDestructivePublication {
  /** The caller holds the D1 per-host OS mutation lock for this entire operation. */
  publish(identity: D1DestructivePublicationIdentity): Promise<void>
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
async function bounded(value: PromiseLike<unknown>): Promise<boolean> {
  const pending = Promise.resolve(value); let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([pending.then(() => true), new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), 5_000) })]) }
  finally { if (timer) clearTimeout(timer); void pending.catch(() => {}) }
}
async function transaction(sql: postgres.ReservedSql, operation: () => Promise<unknown>): Promise<void> {
  let open = false
  try {
    await sql`BEGIN`; open = true
    await operation()
    await sql`COMMIT`; open = false
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
          const [expected, target] = await Promise.all([
            input.revisionStore.readComplete(identity.hostId, identity.expectedRevision),
            input.revisionStore.readComplete(identity.hostId, identity.targetRevision),
          ])
          if (!expected || expected.revisionId !== identity.expectedRevision || expected.desiredStateDigest !== identity.expectedDigest
            || expected.completion.revisionId !== identity.expectedRevision || expected.completion.desiredStateDigest !== identity.expectedDigest
            || expected.desired.plan.hostId !== identity.hostId
            || expected.desired.plan.databaseRef !== input.admissionLedger.databaseRef) throw targetInvalid('expectedRevision')
          if (!target || target.revisionId !== identity.targetRevision || target.desiredStateDigest !== identity.targetDigest
            || target.completion.revisionId !== identity.targetRevision || target.completion.desiredStateDigest !== identity.targetDigest
            || target.desired.plan.hostId !== identity.hostId
            || target.desired.plan.databaseRef !== input.admissionLedger.databaseRef) throw targetInvalid('targetRevision')
          const targetIds = new Set(target.desired.plan.bindings.map((binding) => binding.bindingId))
          const removals = expected.desired.plan.bindings.map((binding) => binding.bindingId).filter((id) => !targetIds.has(id)).sort()
          if (removals.length !== identity.removalBindingIds.length
            || removals.some((id, index) => id !== identity.removalBindingIds[index])) throw targetInvalid('removalBindingIds')
          let rows: { bindingId: string }[]
          try {
            rows = await sql<{ bindingId: string }[]>`
              SELECT binding_id AS "bindingId" FROM d1_binding_admissions
              WHERE host_id = ${identity.hostId} AND binding_id = ANY(${identity.removalBindingIds as string[]})
              ORDER BY binding_id LIMIT 1
            `
          } catch { throw new D1HostError(D1HostErrorCode.ADMISSION_RECORD_FAILED, { field: 'admission' }) }
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
  return Object.freeze({ publish })
}
