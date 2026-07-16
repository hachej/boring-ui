import { AgentDefinitionValidationError, AgentDeploymentValidationError, type Sha256Digest } from '@hachej/boring-agent/shared'

import {
  assertAgentHostExactKeys,
  AgentHostError,
  AgentHostErrorCode,
  parseAgentHostPlan,
  strictAgentHostId,
  strictAgentHostRef,
  type AgentHostPlanV1,
} from './agentHostPlan.js'
import {
  canonicalizeAgentHostAuditRecord,
  canonicalizeAgentHostDesiredSnapshot,
  canonicalizeAgentHostObservation,
  digestAgentHostDesired,
  type AgentHostActiveEnvelopeV1,
  type AgentHostAuditRecordV1,
  type AgentHostDesiredSnapshotV1,
  type AgentHostObservationV1,
  type AgentHostPersistedPlanV1,
} from './agentHostRevisionCodec.js'
import { createAgentHostRuntimeInputsIdentity, type AgentHostRuntimeInputsAttestationV1, type AgentHostRuntimeInputsIdentityV1 } from './agentHostRuntimeInputs.js'
import {
  AgentHostActivePublishError,
  type AgentHostRevisionStore,
  type AgentHostStoredCandidateV1,
  type AgentHostStoredCompleteV1,
} from './hostRevisionStore.js'
import type { AgentHostFencedDestructivePublication } from './fencedDestructivePublication.js'
import type { AgentHostLoadedAgentArtifact } from './agentHostAgentArtifactSnapshot.js'

export interface AgentHostDesiredResolver {
  resolvePlan(plan: AgentHostPlanV1): Promise<AgentHostDesiredSnapshotV1>
  reproduce(target: AgentHostStoredCompleteV1): Promise<AgentHostDesiredSnapshotV1>
}
export interface AgentHostApplyEffects {
  loadAdmittedBindingIds(hostId: string, databaseRef: string): Promise<readonly string[]>
  loadAgentArtifacts(desired: AgentHostDesiredSnapshotV1): Promise<readonly AgentHostLoadedAgentArtifact[]>
  loadRevisionAgentArtifacts(target: AgentHostStoredCompleteV1): Promise<readonly AgentHostLoadedAgentArtifact[]>
  /** Must attest the actual provider versions consumed while materializing the expected identities. */
  materialize(candidate: AgentHostStoredCandidateV1, expected: readonly AgentHostRuntimeInputsIdentityV1[]): Promise<readonly AgentHostRuntimeInputsInspectionV1[]>
  preload(candidate: AgentHostStoredCandidateV1, runtimeInputs: readonly AgentHostRuntimeInputsIdentityV1[]): Promise<AgentHostObservationV1>
  verifyActive(active: AgentHostActiveEnvelopeV1): Promise<void>
}
export interface AgentHostRuntimeInputsInspectionV1 { readonly bindingId: string; readonly attestation: AgentHostRuntimeInputsAttestationV1 }
export interface AgentHostMutationGuard { assertHeld(hostId: string): void }
export interface AgentHostCommandOperator { readonly uid: number; readonly effectiveUser: string; readonly invocationId: string; readonly note?: string }
export interface AgentHostCommandEngineOptions {
  readonly store: AgentHostRevisionStore
  readonly resolver: AgentHostDesiredResolver
  readonly effects: AgentHostApplyEffects
  readonly inspectRuntimeInputs: (desired: AgentHostDesiredSnapshotV1) => Promise<readonly AgentHostRuntimeInputsInspectionV1[]>
  readonly mutationGuard: AgentHostMutationGuard
  readonly fencedPublication?: AgentHostFencedDestructivePublication
  readonly operator: AgentHostCommandOperator
  readonly clock: () => string
}

interface AgentHostPlanCommand {
  readonly kind: 'plan'
  readonly plan: unknown
  readonly confirmRemove?: readonly string[]
}
interface AgentHostApplyCommand extends Omit<AgentHostPlanCommand, 'kind'> { readonly kind: 'apply' }
interface AgentHostRollbackCommand {
  readonly kind: 'rollback'
  readonly hostId: string
  readonly expectedHostRevision: string | null
  readonly targetRevision: string
  readonly confirmRemove?: readonly string[]
}
export type AgentHostCommand = AgentHostPlanCommand | AgentHostApplyCommand | AgentHostRollbackCommand
export interface AgentHostCommandResult {
  readonly kind: 'PLAN' | 'APPLY' | 'ROLLBACK'
  readonly action: 'NOOP' | 'CREATE'
  readonly activeRevision: string | null
  readonly revisionId?: string
  readonly desiredStateDigest: Sha256Digest
  readonly removals: readonly string[]
}

const REVISION_RE = /^r\d{10}$/
const PLAN_KEYS = ['kind', 'plan', 'confirmRemove'] as const
const ROLLBACK_KEYS = ['kind', 'hostId', 'expectedHostRevision', 'targetRevision', 'confirmRemove'] as const

function invalid(field: string): never { throw new AgentHostError(AgentHostErrorCode.PLAN_INVALID, { field }) }
function revision(value: unknown, field: string): string {
  if (typeof value !== 'string' || !REVISION_RE.test(value)) invalid(field)
  return value
}
function expected(value: unknown): string | null { return value === null ? null : revision(value, 'expectedHostRevision') }
function confirmations(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze([])
  if (!Array.isArray(value)) invalid('confirmRemove')
  const refs = value.map((item, index) => strictAgentHostRef(item, `confirmRemove[${index}]`)).sort()
  return Object.freeze(refs)
}
function parse(raw: unknown): AgentHostCommand {
  if (typeof raw !== 'object' || raw === null || !('kind' in raw)) invalid('command')
  const kind = (raw as { kind?: unknown }).kind
  const value = raw as Record<string, unknown>
  if (kind === 'plan' || kind === 'apply') {
    assertAgentHostExactKeys(raw, PLAN_KEYS, 'command', ['confirmRemove'])
    return Object.freeze({ kind, plan: value.plan, confirmRemove: confirmations(value.confirmRemove) })
  }
  if (kind === 'rollback') {
    assertAgentHostExactKeys(raw, ROLLBACK_KEYS, 'command', ['confirmRemove'])
    return Object.freeze({ kind, hostId: strictAgentHostId(value.hostId, 'hostId'), expectedHostRevision: expected(value.expectedHostRevision), targetRevision: revision(value.targetRevision, 'targetRevision'), confirmRemove: confirmations(value.confirmRemove) })
  }
  invalid('kind')
}
function equal(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right) }
function persistedPlan(plan: AgentHostPlanV1): AgentHostPersistedPlanV1 {
  const { expectedHostRevision: _expected, ...persisted } = plan
  return persisted
}
function hostRuntime(plan: AgentHostPersistedPlanV1) {
  const { bindings: _bindings, ...host } = plan
  return host
}
function withoutLanding(binding: AgentHostDesiredSnapshotV1['plan']['bindings'][number]) {
  const { landing: _landing, ...identity } = binding
  return identity
}
function byBinding<T extends { readonly bindingId: string }>(values: readonly T[]): Map<string, T> {
  return new Map(values.map((value) => [value.bindingId, value]))
}
const ADAPTER_CODES = new Set<string>([AgentHostErrorCode.SECRET_UNAVAILABLE, AgentHostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, AgentHostErrorCode.COLLECTION_NOT_READY])
const FENCED_PUBLICATION_CODES = new Set<AgentHostErrorCode>([
  AgentHostErrorCode.REVISION_CONFLICT, AgentHostErrorCode.ROLLBACK_TARGET_INVALID, AgentHostErrorCode.BINDING_ADMITTED,
  AgentHostErrorCode.ADMISSION_RECORD_FAILED, AgentHostErrorCode.ROLLBACK_JOURNAL_FAILED,
])
function adapterError(error: unknown, field: string): AgentHostError {
  const code = error instanceof AgentHostError && ADAPTER_CODES.has(error.code) ? error.code : AgentHostErrorCode.COLLECTION_NOT_READY
  const safeField = code === AgentHostErrorCode.SECRET_UNAVAILABLE ? 'secret' : code === AgentHostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED ? 'runtimeInputs' : field
  return new AgentHostError(code, { field: safeField })
}

export function createAgentHostCommandEngine(options: AgentHostCommandEngineOptions) {
  if (!Number.isSafeInteger(options.operator.uid) || options.operator.uid < 0) invalid('operator.uid')
  strictAgentHostRef(options.operator.effectiveUser, 'operator.effectiveUser')
  strictAgentHostRef(options.operator.invocationId, 'operator.invocationId')
  if (options.operator.note !== undefined && (typeof options.operator.note !== 'string' || options.operator.note.length > 256 || /[\u0000-\u001f\u007f]/.test(options.operator.note))) invalid('operator.note')

  const loadActive = async (hostId: string) => {
    try {
      const active = await options.store.readActive(hostId)
      if (!active) return { active: null, complete: null }
      const complete = await options.store.readComplete(hostId, active.revisionId)
      if (!complete || complete.desiredStateDigest !== active.desiredStateDigest) throw new Error()
      return { active, complete }
    } catch {
      throw new AgentHostError(AgentHostErrorCode.PUBLICATION_FAILED, { field: 'active' })
    }
  }
  const assertCas = (actual: AgentHostActiveEnvelopeV1 | null, wanted: string | null) => {
    if ((actual?.revisionId ?? null) !== wanted) throw new AgentHostError(AgentHostErrorCode.REVISION_CONFLICT, { field: 'expectedHostRevision' })
  }
  const resolvePlan = async (plan: AgentHostPlanV1) => {
    try {
      const desired = await canonicalizeAgentHostDesiredSnapshot(await options.resolver.resolvePlan(plan))
      const { expectedHostRevision: _expected, ...persistedPlan } = plan
      if (!equal(desired.plan, persistedPlan)) invalid('desired.plan')
      return desired
    } catch (error) {
      if (error instanceof AgentHostError) throw error
      throw new AgentHostError(AgentHostErrorCode.PLAN_INVALID, { field: 'resolver' })
    }
  }
  const reproduce = async (target: AgentHostStoredCompleteV1, hostId: string) => {
    try {
      const desired = await canonicalizeAgentHostDesiredSnapshot(await options.resolver.reproduce(target))
      if (desired.plan.hostId !== hostId || await digestAgentHostDesired(desired) !== target.desiredStateDigest) {
        throw new AgentHostError(AgentHostErrorCode.ROLLBACK_TARGET_INVALID, { field: 'targetRevision' })
      }
      return desired
    } catch (error) {
      if (error instanceof AgentHostError) throw error
      throw new AgentHostError(AgentHostErrorCode.ROLLBACK_TARGET_INVALID, { field: 'targetRevision' })
    }
  }
  const preflightPlan = async (hostId: string, current: AgentHostStoredCompleteV1 | null, next: AgentHostPersistedPlanV1, confirmed: readonly string[], enforceConfirmation: boolean) => {
    const oldPlan = current ? byBinding(current.desired.plan.bindings) : new Map()
    const nextPlan = byBinding(next.bindings)
    const removals = Object.freeze([...oldPlan.keys()].filter((id) => !nextPlan.has(id)).sort())
    if (enforceConfirmation && (new Set(confirmed).size !== confirmed.length || !equal(removals, confirmed))) throw new AgentHostError(AgentHostErrorCode.DESTRUCTIVE_CONFIRMATION_REQUIRED, { field: 'confirmRemove' })
    let admitted: readonly string[]
    const databaseRef = current?.desired.plan.databaseRef ?? next.databaseRef
    try { admitted = await options.effects.loadAdmittedBindingIds(hostId, databaseRef) } catch {
      throw new AgentHostError(AgentHostErrorCode.PUBLICATION_FAILED, { field: 'admissions' })
    }
    const admittedSet = new Set(admitted.map((id, index) => strictAgentHostRef(id, `admissions[${index}]`)))
    if ([...admittedSet].some((id) => !oldPlan.has(id))) throw new AgentHostError(AgentHostErrorCode.BINDING_ADMITTED, { field: 'bindingId' })
    const admittedRemoval = removals.find((id) => admittedSet.has(id))
    if (admittedRemoval) throw new AgentHostError(AgentHostErrorCode.BINDING_ADMITTED, { field: 'bindingId' })
    if (!current) return removals
    if (!equal(hostRuntime(current.desired.plan), hostRuntime(next))) {
      throw new AgentHostError(AgentHostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, { field: 'hostRuntime' })
    }
    for (const [id, oldBinding] of oldPlan) {
      const nextBinding = nextPlan.get(id)
      if (!nextBinding) continue
      if (!equal(withoutLanding(oldBinding), withoutLanding(nextBinding))) {
        throw new AgentHostError(AgentHostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, { field: 'bindingId' })
      }
    }
    return removals
  }
  const validateResolved = (current: AgentHostStoredCompleteV1 | null, desired: AgentHostDesiredSnapshotV1) => {
    if (!current) return
    const oldPlan = byBinding(current.desired.plan.bindings)
    const oldResolved = byBinding(current.desired.resolvedBindings)
    const nextResolved = byBinding(desired.resolvedBindings)
    for (const id of oldPlan.keys()) {
      if (nextResolved.has(id) && !equal(oldResolved.get(id), nextResolved.get(id))) {
        throw new AgentHostError(AgentHostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, { field: 'bindingId' })
      }
    }
  }
  const canonicalizeRuntimeInputs = async (desired: AgentHostDesiredSnapshotV1, raw: readonly AgentHostRuntimeInputsInspectionV1[]) => {
    try {
      if (!Array.isArray(raw)) throw new Error()
      const identities = await Promise.all(raw.map(async (entry, index) => {
        assertAgentHostExactKeys(entry, ['bindingId', 'attestation'], `runtimeInputs[${index}]`)
        const bindingId = strictAgentHostRef(entry.bindingId, `runtimeInputs[${index}].bindingId`)
        const planned = desired.plan.bindings.find((binding) => binding.bindingId === bindingId)
        if (!planned) throw new Error()
        return createAgentHostRuntimeInputsIdentity(planned, entry.attestation as AgentHostRuntimeInputsAttestationV1)
      }))
      identities.sort((left, right) => left.bindingId < right.bindingId ? -1 : left.bindingId > right.bindingId ? 1 : 0)
      if (new Set(identities.map((identity) => identity.bindingId)).size !== identities.length ||
        !equal(identities.map((identity) => identity.bindingId), desired.plan.bindings.map((binding) => binding.bindingId))) throw new Error()
      return Object.freeze(identities)
    } catch { throw new AgentHostError(AgentHostErrorCode.COLLECTION_NOT_READY, { field: 'runtimeInputs' }) }
  }
  const inspectRuntimeInputs = async (desired: AgentHostDesiredSnapshotV1) => {
    try { return await canonicalizeRuntimeInputs(desired, await options.inspectRuntimeInputs(desired)) }
    catch (error) { throw adapterError(error, 'runtimeInputs') }
  }
  const validateRuntimeInputs = (current: AgentHostStoredCompleteV1 | null, identities: readonly AgentHostRuntimeInputsIdentityV1[]) => {
    if (!current) return
    const retained = new Set(current.desired.plan.bindings.map((binding) => binding.bindingId))
    const active = byBinding(current.observation.bindings)
    for (const identity of identities) {
      if (!retained.has(identity.bindingId)) continue
      const prior = active.get(identity.bindingId)?.runtimeInputs
      if (!prior || prior.digest !== identity.digest || !equal(prior, identity)) {
        throw new AgentHostError(AgentHostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, { field: 'runtimeInputs' })
      }
    }
  }
  const audit = (revisionId: string, desiredStateDigest: string, outcome: string, phase: string, completionDigest?: string): AgentHostAuditRecordV1 => canonicalizeAgentHostAuditRecord({
    schemaVersion: 1, domain: 'boring-agent-host-audit:v1', revisionId, desiredStateDigest,
    at: options.clock(), operator: options.operator, outcome, phase, ...(completionDigest ? { completionDigest } : {}),
  })
  const appendBestEffort = async (hostId: string, revisionId: string, desiredStateDigest: string, outcome: string, phase: string, completionDigest?: string) => {
    try { await options.store.appendAudit(hostId, audit(revisionId, desiredStateDigest, outcome, phase, completionDigest)) } catch {}
  }
  const requireFencedPublication = (): AgentHostFencedDestructivePublication => {
    if (!options.fencedPublication) throw new AgentHostError(AgentHostErrorCode.ROLLBACK_JOURNAL_FAILED, { field: 'rollbackJournal' })
    return options.fencedPublication
  }
  const recoverPublications = async (publication: AgentHostFencedDestructivePublication, hostId: string) => {
    try { await publication.recoverPending(hostId) } catch {
      throw new AgentHostError(AgentHostErrorCode.ROLLBACK_JOURNAL_FAILED, { field: 'rollbackJournal' })
    }
  }
  const recover = async (hostId: string, active: AgentHostActiveEnvelopeV1 | null, complete: AgentHostStoredCompleteV1 | null) => {
    if (!active || !complete) return
    let terminal: boolean
    try { terminal = await options.store.hasTerminalAudit(hostId, active) } catch { throw new AgentHostError(AgentHostErrorCode.PUBLICATION_FAILED, { field: 'audit' }) }
    if (!terminal) {
      try { await options.store.appendAudit(hostId, audit(active.revisionId, active.desiredStateDigest, 'RECOVERY_REQUIRED', 'RECOVERY', complete.completion.completionDigest)) } catch {
        throw new AgentHostError(AgentHostErrorCode.PUBLICATION_FAILED, { field: 'audit' })
      }
    }
  }
  const create = async (
    hostId: string,
    desired: AgentHostDesiredSnapshotV1,
    inspected: readonly AgentHostRuntimeInputsIdentityV1[],
    prior: AgentHostActiveEnvelopeV1 | null,
    removals: readonly string[],
    publication: AgentHostFencedDestructivePublication,
    agentArtifacts: readonly AgentHostLoadedAgentArtifact[],
    rollbackSource?: Readonly<{ revisionId: string; desiredStateDigest: Sha256Digest }>,
  ): Promise<AgentHostActiveEnvelopeV1> => {
    const desiredStateDigest = await digestAgentHostDesired(desired)
    let revisionId: string
    try { revisionId = await options.store.reserveRevisionId(hostId) } catch (error) {
      if (error instanceof AgentHostError) throw new AgentHostError(error.code, { field: error.details.field ?? 'candidate' })
      throw new AgentHostError(AgentHostErrorCode.COLLECTION_NOT_READY, { field: 'candidate' })
    }
    let candidate: AgentHostStoredCandidateV1
    try {
      candidate = await options.store.writeCandidate(hostId, revisionId, desired, agentArtifacts)
    } catch (error) {
      await appendBestEffort(hostId, revisionId, desiredStateDigest, 'FAILED', 'CANDIDATE')
      if (error instanceof AgentHostError) throw new AgentHostError(error.code, { field: error.details.field ?? 'candidate' })
      throw new AgentHostError(AgentHostErrorCode.COLLECTION_NOT_READY, { field: 'candidate' })
    }
    let materialized: readonly AgentHostRuntimeInputsIdentityV1[]
    try {
      materialized = await canonicalizeRuntimeInputs(desired, await options.effects.materialize(candidate, inspected))
      if (!equal(materialized, inspected)) throw new AgentHostError(AgentHostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, { field: 'runtimeInputs' })
    } catch (error) {
      await appendBestEffort(hostId, revisionId, desiredStateDigest, 'FAILED', 'MATERIALIZE')
      throw adapterError(error, 'materialize')
    }
    let observation: AgentHostObservationV1
    try {
      const refreshed = await inspectRuntimeInputs(desired)
      if (!equal(refreshed, materialized)) throw new AgentHostError(AgentHostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, { field: 'runtimeInputs' })
      observation = await canonicalizeAgentHostObservation(await options.effects.preload(candidate, materialized), desired)
      if (!equal(observation.bindings.map((binding) => binding.runtimeInputs), materialized)) {
        throw new AgentHostError(AgentHostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, { field: 'runtimeInputs' })
      }
      await options.store.writeObservation(hostId, revisionId, observation)
    } catch (error) {
      await appendBestEffort(hostId, revisionId, desiredStateDigest, 'FAILED', 'READINESS')
      throw adapterError(error, 'readiness')
    }
    let complete: AgentHostStoredCompleteV1
    try { complete = await options.store.writeComplete(hostId, revisionId) } catch {
      await appendBestEffort(hostId, revisionId, desiredStateDigest, 'FAILED', 'COMPLETION')
      throw new AgentHostError(AgentHostErrorCode.COLLECTION_NOT_READY, { field: 'completion' })
    }
    let active: AgentHostActiveEnvelopeV1
    if (removals.length > 0) {
      if (!prior) throw new AgentHostError(AgentHostErrorCode.ROLLBACK_JOURNAL_FAILED, { field: 'rollbackJournal' })
      try {
        await publication.publish({
          operationId: options.operator.invocationId, hostId,
          expectedRevision: prior.revisionId, expectedDigest: prior.desiredStateDigest,
          targetRevision: revisionId, targetDigest: complete.desiredStateDigest,
          ...(rollbackSource ? { sourceRevision: rollbackSource.revisionId, sourceDigest: rollbackSource.desiredStateDigest } : {}),
          removalBindingIds: removals,
        })
      } catch (error) {
        if (error instanceof AgentHostError && FENCED_PUBLICATION_CODES.has(error.code)) throw error
        throw new AgentHostError(AgentHostErrorCode.ROLLBACK_JOURNAL_FAILED, { field: 'rollbackJournal' })
      }
      active = Object.freeze({ schemaVersion: 1, revisionId, desiredStateDigest: complete.desiredStateDigest })
    } else try { active = await options.store.publishActive(hostId, revisionId) } catch (error) {
      let committed = error instanceof AgentHostActivePublishError && error.committed
      if (!(error instanceof AgentHostActivePublishError)) {
        try { committed = (await options.store.readActive(hostId))?.revisionId === revisionId } catch { committed = true }
      }
      await appendBestEffort(hostId, revisionId, desiredStateDigest, committed ? 'RECOVERY_REQUIRED' : 'FAILED', 'PUBLICATION', complete.completion.completionDigest)
      throw new AgentHostError(AgentHostErrorCode.PUBLICATION_FAILED, { field: 'active' })
    }
    try { await options.effects.verifyActive(active) } catch {
      await appendBestEffort(hostId, revisionId, desiredStateDigest, 'RECOVERY_REQUIRED', 'PUBLICATION', complete.completion.completionDigest)
      throw new AgentHostError(AgentHostErrorCode.PUBLICATION_FAILED, { field: 'active' })
    }
    try { await options.store.appendAudit(hostId, audit(revisionId, desiredStateDigest, 'COMPLETE', 'AUDIT', complete.completion.completionDigest)) } catch {
      await appendBestEffort(hostId, revisionId, desiredStateDigest, 'RECOVERY_REQUIRED', 'AUDIT', complete.completion.completionDigest)
      throw new AgentHostError(AgentHostErrorCode.PUBLICATION_FAILED, { field: 'audit' })
    }
    return active
  }
  const loadArtifacts = async (load: () => Promise<readonly AgentHostLoadedAgentArtifact[]>) => {
    try { return await load() } catch (error) {
      if (error instanceof AgentDefinitionValidationError || error instanceof AgentDeploymentValidationError) throw error
      throw new AgentHostError(AgentHostErrorCode.PUBLICATION_FAILED, { field: 'agentArtifacts' })
    }
  }

  return Object.freeze({
    async execute(raw: unknown): Promise<AgentHostCommandResult> {
      const command = parse(raw)
      let desired: AgentHostDesiredSnapshotV1
      let hostId: string
      let expectedHostRevision: string | null
      if (command.kind === 'rollback') {
        hostId = command.hostId; expectedHostRevision = command.expectedHostRevision
        try { options.mutationGuard.assertHeld(hostId) } catch { throw new AgentHostError(AgentHostErrorCode.REVISION_CONFLICT, { field: 'hostLock' }) }
        const publication = requireFencedPublication()
        await recoverPublications(publication, hostId)
        const state = await loadActive(hostId); assertCas(state.active, expectedHostRevision)
        let target: AgentHostStoredCompleteV1 | null
        try { target = await options.store.readComplete(hostId, command.targetRevision) } catch { target = null }
        if (!target) throw new AgentHostError(AgentHostErrorCode.ROLLBACK_TARGET_INVALID, { field: 'targetRevision' })
        const removals = await preflightPlan(hostId, state.complete, target.desired.plan, command.confirmRemove ?? [], true)
        desired = await reproduce(target, hostId)
        validateResolved(state.complete, desired)
        const inspected = await inspectRuntimeInputs(desired)
        validateRuntimeInputs(state.complete, inspected)
        const desiredStateDigest = await digestAgentHostDesired(desired)
        await recover(hostId, state.active, state.complete)
        if (desiredStateDigest === state.active?.desiredStateDigest) return Object.freeze({ kind: 'ROLLBACK', action: 'NOOP', activeRevision: state.active?.revisionId ?? null, desiredStateDigest, removals })
        const agentArtifacts = await loadArtifacts(() => options.effects.loadRevisionAgentArtifacts(target))
        const active = await create(hostId, desired, inspected, state.active, removals, publication, agentArtifacts,
          { revisionId: target.revisionId, desiredStateDigest: target.desiredStateDigest })
        return Object.freeze({ kind: 'ROLLBACK', action: 'CREATE', activeRevision: active.revisionId, revisionId: active.revisionId, desiredStateDigest, removals })
      }
      const parsedPlan = parseAgentHostPlan(command.plan)
      hostId = parsedPlan.hostId; expectedHostRevision = parsedPlan.expectedHostRevision
      let publication: AgentHostFencedDestructivePublication | undefined
      if (command.kind === 'apply') {
        try { options.mutationGuard.assertHeld(hostId) } catch { throw new AgentHostError(AgentHostErrorCode.REVISION_CONFLICT, { field: 'hostLock' }) }
        publication = requireFencedPublication()
        await recoverPublications(publication, hostId)
      }
      const state = await loadActive(hostId); assertCas(state.active, expectedHostRevision)
      const removals = await preflightPlan(hostId, state.complete, persistedPlan(parsedPlan), command.confirmRemove ?? [], command.kind === 'apply')
      desired = await resolvePlan(parsedPlan)
      validateResolved(state.complete, desired)
      const inspected = await inspectRuntimeInputs(desired)
      validateRuntimeInputs(state.complete, inspected)
      const desiredStateDigest = await digestAgentHostDesired(desired)
      if (command.kind === 'plan') return Object.freeze({ kind: 'PLAN', action: desiredStateDigest === state.active?.desiredStateDigest ? 'NOOP' : 'CREATE', activeRevision: state.active?.revisionId ?? null, desiredStateDigest, removals })
      await recover(hostId, state.active, state.complete)
      if (desiredStateDigest === state.active?.desiredStateDigest) return Object.freeze({ kind: 'APPLY', action: 'NOOP', activeRevision: state.active?.revisionId ?? null, desiredStateDigest, removals })
      const agentArtifacts = await loadArtifacts(() => options.effects.loadAgentArtifacts(desired))
      const active = await create(hostId, desired, inspected, state.active, removals, publication!, agentArtifacts)
      return Object.freeze({ kind: 'APPLY', action: 'CREATE', activeRevision: active.revisionId, revisionId: active.revisionId, desiredStateDigest, removals })
    },
  })
}
