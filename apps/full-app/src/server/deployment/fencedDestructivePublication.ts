import type postgres from 'postgres'
import { isAgentHostReservedConnectionLost, type AgentHostAdmissionLedger } from './admissionLedger.js'
import {
  normalizeAgentHostDestructivePublicationIdentity,
  type AgentHostDestructivePublicationIdentity,
  type AgentHostDestructivePublicationJournalStore,
} from './destructivePublicationJournal.js'
import { AgentHostError, AgentHostErrorCode } from './agentHostPlan.js'
import type { AgentHostRootPublicationClient } from './agentHostPublicationControl.js'
import {
  canonicalizeAgentHostCompleteEnvelope,
  canonicalizeAgentHostDesiredSnapshot,
  canonicalizeAgentHostObservation,
  canonicalizeAgentHostSecretRefsEnvelope,
  digestAgentHostDesired,
} from './agentHostRevisionCodec.js'
import type { AgentHostRevisionStore } from './hostRevisionStore.js'

export interface AgentHostFencedDestructivePublication {
  /** The caller holds the AgentHost per-host OS mutation lock for this entire operation. */
  publish(identity: AgentHostDestructivePublicationIdentity): Promise<void>
  /** The caller holds the AgentHost per-host OS mutation lock before discovery starts. */
  recoverPending(hostId: string): Promise<void>
}

const preserved = new Set<AgentHostErrorCode>([
  AgentHostErrorCode.REVISION_CONFLICT,
  AgentHostErrorCode.ROLLBACK_TARGET_INVALID,
  AgentHostErrorCode.BINDING_ADMITTED,
  AgentHostErrorCode.ROLLBACK_JOURNAL_FAILED,
])
function failed(field = 'rollbackJournal'): AgentHostError {
  return new AgentHostError(AgentHostErrorCode.ROLLBACK_JOURNAL_FAILED, { field })
}
function targetInvalid(field: string): AgentHostError {
  return new AgentHostError(AgentHostErrorCode.ROLLBACK_TARGET_INVALID, { field })
}
function connectionLost(error: unknown): boolean {
  const code = error instanceof Error ? (error as Error & { code?: unknown }).code : undefined
  return code === 'CONNECTION_CLOSED' || code === 'CONNECTION_DESTROYED' || code === 'CONNECTION_ENDED' || code === 'ECONNRESET' || code === 'EPIPE'
}
function internalConnectionLost(): Error {
  return Object.assign(new Error('AGENT_HOST_RESERVED_CONNECTION_LOST'), { code: 'CONNECTION_CLOSED' })
}
function sameIdentity(left: AgentHostDestructivePublicationIdentity, right: AgentHostDestructivePublicationIdentity): boolean {
  return left.operationId === right.operationId && left.hostId === right.hostId
    && left.expectedRevision === right.expectedRevision && left.expectedDigest === right.expectedDigest
    && left.targetRevision === right.targetRevision && left.targetDigest === right.targetDigest
    && (left.sourceRevision ?? null) === (right.sourceRevision ?? null) && (left.sourceDigest ?? null) === (right.sourceDigest ?? null)
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
    if (isAgentHostReservedConnectionLost(sql) || !await bounded(sql`BEGIN`)) throw internalConnectionLost()
    open = true
    await operation()
    if (isAgentHostReservedConnectionLost(sql) || !await bounded(sql`COMMIT`)) throw internalConnectionLost()
    open = false
  } catch (error) {
    if (connectionLost(error)) throw internalConnectionLost()
    if (open) try { if (!await bounded(sql`ROLLBACK`)) throw internalConnectionLost() } catch { throw internalConnectionLost() }
    throw failed()
  }
}

export function createAgentHostFencedDestructivePublication(input: {
  readonly admissionLedger: AgentHostAdmissionLedger
  readonly journalStore: AgentHostDestructivePublicationJournalStore
  readonly revisionStore: AgentHostRevisionStore
  readonly publicationControl?: Pick<AgentHostRootPublicationClient, 'status' | 'commit' | 'discard' | 'recover'>
}): AgentHostFencedDestructivePublication {
  const validateArtifacts = async (identity: AgentHostDestructivePublicationIdentity, invalid: (field: string) => AgentHostError) => {
    const [expected, target] = await Promise.all([
      input.revisionStore.readComplete(identity.hostId, identity.expectedRevision),
      input.revisionStore.readComplete(identity.hostId, identity.targetRevision),
    ])
    const exactComplete = async (value: typeof expected, revision: string, digest: string): Promise<boolean> => {
      if (!value || Object.keys(value).sort().join(',') !== 'completion,desired,desiredStateDigest,observation,revisionId,secretRefs'
        || !value.observation || typeof value.observation !== 'object' || !value.secretRefs || typeof value.secretRefs !== 'object'
        || !value.completion) return false
      try {
        const desired = await canonicalizeAgentHostDesiredSnapshot(value.desired)
        const secretRefs = canonicalizeAgentHostSecretRefsEnvelope(value.secretRefs, desired)
        const observation = await canonicalizeAgentHostObservation(value.observation, desired)
        const completion = await canonicalizeAgentHostCompleteEnvelope(value.completion, desired, observation)
        return value.revisionId === revision
          && value.desiredStateDigest === digest
          && await digestAgentHostDesired(desired) === digest
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
  const readAdmissions = async (sql: postgres.ReservedSql, identity: AgentHostDestructivePublicationIdentity) => {
    try {
      return await sql<{ bindingId: string }[]>`
        SELECT binding_id AS "bindingId" FROM agent_host_binding_admissions
        WHERE host_id = ${identity.hostId} AND binding_id = ANY(${identity.removalBindingIds as string[]})
        ORDER BY binding_id LIMIT 1
      `
    } catch { throw new AgentHostError(AgentHostErrorCode.ADMISSION_RECORD_FAILED, { field: 'admission' }) }
  }
  const requirePrepared = async (identity: AgentHostDestructivePublicationIdentity) => {
    const status = await input.publicationControl?.status()
    if (status && (status.durableRevision !== identity.expectedRevision || status.servedRevision !== identity.expectedRevision
      || status.pendingOperation !== identity.operationId)) throw failed()
  }
  const publish = async (raw: AgentHostDestructivePublicationIdentity): Promise<void> => {
    let identity: AgentHostDestructivePublicationIdentity
    let journalStarted = false
    try { identity = normalizeAgentHostDestructivePublicationIdentity(raw) } catch { throw targetInvalid('publicationIdentity') }
    try {
      await input.admissionLedger.withBindingFences(
        identity.removalBindingIds.map((bindingId) => ({ hostId: identity.hostId, bindingId })),
        async (sql) => {
          let active
          try { active = await input.revisionStore.readActive(identity.hostId) } catch {
            throw new AgentHostError(AgentHostErrorCode.REVISION_CONFLICT, { field: 'expectedHostRevision' })
          }
          if (!active || active.revisionId !== identity.expectedRevision || active.desiredStateDigest !== identity.expectedDigest) {
            throw new AgentHostError(AgentHostErrorCode.REVISION_CONFLICT, { field: 'expectedHostRevision' })
          }
          await validateArtifacts(identity, targetInvalid)
          const rows = await readAdmissions(sql, identity)
          if (rows[0]) throw new AgentHostError(AgentHostErrorCode.BINDING_ADMITTED, { bindingId: rows[0].bindingId })
          journalStarted = true
          await transaction(sql, async () => {
            if ((await input.journalStore.readOperation(sql, identity.operationId))?.terminal) throw failed()
            await input.journalStore.appendPrepared(sql, identity)
          })
          await requirePrepared(identity)
          let targetActive
          try { targetActive = await input.revisionStore.publishActive(identity.hostId, identity.targetRevision) } catch { throw failed() }
          try { await input.publicationControl?.commit(identity.operationId, targetActive) } catch { throw failed() }
          await transaction(sql, () => input.journalStore.appendTerminal(sql, identity, 'committed'))
        },
      )
    } catch (error) {
      if (journalStarted && error instanceof AgentHostError && error.code === AgentHostErrorCode.ADMISSION_RECORD_FAILED) throw failed()
      if (error instanceof AgentHostError && (preserved.has(error.code) || error.code === AgentHostErrorCode.ADMISSION_RECORD_FAILED)) throw error
      throw failed()
    }
  }
  const recoverPending = async (hostId: string): Promise<void> => {
    try {
      // Discovery needs a reserved handle but no operation lock; the OS host lock serializes callers.
      const pending = await input.admissionLedger.withBindingFences(
        [{ hostId, bindingId: 'agent-host-publication-recovery' }],
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
              const status = await input.publicationControl?.status()
              if (status && (status.durableRevision !== identity.targetRevision || status.pendingOperation !== identity.operationId)) throw failed()
              if (status?.servedRevision === identity.expectedRevision) await input.publicationControl!.commit(identity.operationId, active)
              else if (status && status.servedRevision !== identity.targetRevision) throw failed()
              await transaction(sql, () => input.journalStore.appendTerminal(sql, identity, 'committed'))
              return
            }
            if (active?.revisionId !== identity.expectedRevision || active.desiredStateDigest !== identity.expectedDigest) throw failed()
            if ((await readAdmissions(sql, identity))[0]) {
              await input.publicationControl?.discard(identity.operationId)
              await transaction(sql, () => input.journalStore.appendTerminal(sql, identity, 'aborted'))
              return
            }
            await requirePrepared(identity)
            const target = await input.revisionStore.publishActive(identity.hostId, identity.targetRevision).catch(() => { throw failed() })
            try { await input.publicationControl?.commit(identity.operationId, target) } catch { throw failed() }
            await transaction(sql, () => input.journalStore.appendTerminal(sql, identity, 'committed'))
          },
        )
      }
      await input.publicationControl?.recover()
    } catch { throw failed() }
  }
  return Object.freeze({ publish, recoverPending })
}
