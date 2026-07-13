import type { Sha256Digest } from '@hachej/boring-agent/shared'

import {
  assertD1ExactKeys,
  D1HostError,
  D1HostErrorCode,
  parseD1HostPlan,
  strictD1HostId,
  strictD1Ref,
  type D1HostPlanV1,
} from './d1Plan.js'
import {
  canonicalizeD1AuditRecord,
  canonicalizeD1DesiredSnapshot,
  canonicalizeD1Observation,
  digestD1Desired,
  type D1ActiveEnvelopeV1,
  type D1AuditRecordV1,
  type D1DesiredSnapshotV1,
  type D1ObservationV1,
  type D1PersistedPlanV1,
} from './d1RevisionCodec.js'
import { createD1RuntimeInputsIdentity, type D1RuntimeInputsAttestationV1, type D1RuntimeInputsIdentityV1 } from './d1RuntimeInputs.js'
import {
  D1ActivePublishError,
  type D1HostRevisionStore,
  type D1StoredCandidateV1,
  type D1StoredCompleteV1,
} from './hostRevisionStore.js'
import type { D1FencedDestructivePublication } from './fencedDestructivePublication.js'

export interface D1DesiredResolver {
  resolvePlan(plan: D1HostPlanV1): Promise<D1DesiredSnapshotV1>
  reproduce(target: D1StoredCompleteV1): Promise<D1DesiredSnapshotV1>
}
export interface D1ApplyEffects {
  loadAdmittedBindingIds(hostId: string, databaseRef: string): Promise<readonly string[]>
  /** Must attest the actual provider versions consumed while materializing the expected identities. */
  materialize(candidate: D1StoredCandidateV1, expected: readonly D1RuntimeInputsIdentityV1[]): Promise<readonly D1RuntimeInputsInspectionV1[]>
  preload(candidate: D1StoredCandidateV1, runtimeInputs: readonly D1RuntimeInputsIdentityV1[]): Promise<D1ObservationV1>
  verifyActive(active: D1ActiveEnvelopeV1): Promise<void>
}
export interface D1RuntimeInputsInspectionV1 { readonly bindingId: string; readonly attestation: D1RuntimeInputsAttestationV1 }
export interface D1MutationGuard { assertHeld(hostId: string): void }
export interface D1CommandOperator { readonly uid: number; readonly effectiveUser: string; readonly invocationId: string; readonly note?: string }
export interface D1CommandEngineOptions {
  readonly store: D1HostRevisionStore
  readonly resolver: D1DesiredResolver
  readonly effects: D1ApplyEffects
  readonly inspectRuntimeInputs: (desired: D1DesiredSnapshotV1) => Promise<readonly D1RuntimeInputsInspectionV1[]>
  readonly mutationGuard: D1MutationGuard
  readonly fencedPublication?: D1FencedDestructivePublication
  readonly operator: D1CommandOperator
  readonly clock: () => string
}

interface D1PlanCommand {
  readonly kind: 'plan'
  readonly plan: unknown
  readonly confirmRemove?: readonly string[]
}
interface D1ApplyCommand extends Omit<D1PlanCommand, 'kind'> { readonly kind: 'apply' }
interface D1RollbackCommand {
  readonly kind: 'rollback'
  readonly hostId: string
  readonly expectedHostRevision: string | null
  readonly targetRevision: string
  readonly confirmRemove?: readonly string[]
}
export type D1Command = D1PlanCommand | D1ApplyCommand | D1RollbackCommand
export interface D1CommandResult {
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

function invalid(field: string): never { throw new D1HostError(D1HostErrorCode.PLAN_INVALID, { field }) }
function revision(value: unknown, field: string): string {
  if (typeof value !== 'string' || !REVISION_RE.test(value)) invalid(field)
  return value
}
function expected(value: unknown): string | null { return value === null ? null : revision(value, 'expectedHostRevision') }
function confirmations(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze([])
  if (!Array.isArray(value)) invalid('confirmRemove')
  const refs = value.map((item, index) => strictD1Ref(item, `confirmRemove[${index}]`)).sort()
  return Object.freeze(refs)
}
function parse(raw: unknown): D1Command {
  if (typeof raw !== 'object' || raw === null || !('kind' in raw)) invalid('command')
  const kind = (raw as { kind?: unknown }).kind
  const value = raw as Record<string, unknown>
  if (kind === 'plan' || kind === 'apply') {
    assertD1ExactKeys(raw, PLAN_KEYS, 'command', ['confirmRemove'])
    return Object.freeze({ kind, plan: value.plan, confirmRemove: confirmations(value.confirmRemove) })
  }
  if (kind === 'rollback') {
    assertD1ExactKeys(raw, ROLLBACK_KEYS, 'command', ['confirmRemove'])
    return Object.freeze({ kind, hostId: strictD1HostId(value.hostId, 'hostId'), expectedHostRevision: expected(value.expectedHostRevision), targetRevision: revision(value.targetRevision, 'targetRevision'), confirmRemove: confirmations(value.confirmRemove) })
  }
  invalid('kind')
}
function equal(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right) }
function persistedPlan(plan: D1HostPlanV1): D1PersistedPlanV1 {
  const { expectedHostRevision: _expected, ...persisted } = plan
  return persisted
}
function hostRuntime(plan: D1PersistedPlanV1) {
  const { bindings: _bindings, ...host } = plan
  return host
}
function withoutLanding(binding: D1DesiredSnapshotV1['plan']['bindings'][number]) {
  const { landing: _landing, ...identity } = binding
  return identity
}
function byBinding<T extends { readonly bindingId: string }>(values: readonly T[]): Map<string, T> {
  return new Map(values.map((value) => [value.bindingId, value]))
}
const ADAPTER_CODES = new Set<string>([D1HostErrorCode.SECRET_UNAVAILABLE, D1HostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, D1HostErrorCode.COLLECTION_NOT_READY])
const FENCED_PUBLICATION_CODES = new Set<D1HostErrorCode>([
  D1HostErrorCode.REVISION_CONFLICT, D1HostErrorCode.ROLLBACK_TARGET_INVALID, D1HostErrorCode.BINDING_ADMITTED,
  D1HostErrorCode.ADMISSION_RECORD_FAILED, D1HostErrorCode.ROLLBACK_JOURNAL_FAILED,
])
function adapterError(error: unknown, field: string): D1HostError {
  const code = error instanceof D1HostError && ADAPTER_CODES.has(error.code) ? error.code : D1HostErrorCode.COLLECTION_NOT_READY
  const safeField = code === D1HostErrorCode.SECRET_UNAVAILABLE ? 'secret' : code === D1HostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED ? 'runtimeInputs' : field
  return new D1HostError(code, { field: safeField })
}

export function createD1CommandEngine(options: D1CommandEngineOptions) {
  if (!Number.isSafeInteger(options.operator.uid) || options.operator.uid < 0) invalid('operator.uid')
  strictD1Ref(options.operator.effectiveUser, 'operator.effectiveUser')
  strictD1Ref(options.operator.invocationId, 'operator.invocationId')
  if (options.operator.note !== undefined && (typeof options.operator.note !== 'string' || options.operator.note.length > 256 || /[\u0000-\u001f\u007f]/.test(options.operator.note))) invalid('operator.note')

  const loadActive = async (hostId: string) => {
    try {
      const active = await options.store.readActive(hostId)
      if (!active) return { active: null, complete: null }
      const complete = await options.store.readComplete(hostId, active.revisionId)
      if (!complete || complete.desiredStateDigest !== active.desiredStateDigest) throw new Error()
      return { active, complete }
    } catch {
      throw new D1HostError(D1HostErrorCode.PUBLICATION_FAILED, { field: 'active' })
    }
  }
  const assertCas = (actual: D1ActiveEnvelopeV1 | null, wanted: string | null) => {
    if ((actual?.revisionId ?? null) !== wanted) throw new D1HostError(D1HostErrorCode.REVISION_CONFLICT, { field: 'expectedHostRevision' })
  }
  const resolvePlan = async (plan: D1HostPlanV1) => {
    try {
      const desired = await canonicalizeD1DesiredSnapshot(await options.resolver.resolvePlan(plan))
      const { expectedHostRevision: _expected, ...persistedPlan } = plan
      if (!equal(desired.plan, persistedPlan)) invalid('desired.plan')
      return desired
    } catch (error) {
      if (error instanceof D1HostError) throw error
      throw new D1HostError(D1HostErrorCode.PLAN_INVALID, { field: 'resolver' })
    }
  }
  const reproduce = async (target: D1StoredCompleteV1, hostId: string) => {
    try {
      const desired = await canonicalizeD1DesiredSnapshot(await options.resolver.reproduce(target))
      if (desired.plan.hostId !== hostId || await digestD1Desired(desired) !== target.desiredStateDigest) {
        throw new D1HostError(D1HostErrorCode.ROLLBACK_TARGET_INVALID, { field: 'targetRevision' })
      }
      return desired
    } catch (error) {
      if (error instanceof D1HostError) throw error
      throw new D1HostError(D1HostErrorCode.ROLLBACK_TARGET_INVALID, { field: 'targetRevision' })
    }
  }
  const preflightPlan = async (hostId: string, current: D1StoredCompleteV1 | null, next: D1PersistedPlanV1, confirmed: readonly string[], enforceConfirmation: boolean) => {
    const oldPlan = current ? byBinding(current.desired.plan.bindings) : new Map()
    const nextPlan = byBinding(next.bindings)
    const removals = Object.freeze([...oldPlan.keys()].filter((id) => !nextPlan.has(id)).sort())
    if (enforceConfirmation && (new Set(confirmed).size !== confirmed.length || !equal(removals, confirmed))) throw new D1HostError(D1HostErrorCode.DESTRUCTIVE_CONFIRMATION_REQUIRED, { field: 'confirmRemove' })
    let admitted: readonly string[]
    const databaseRef = current?.desired.plan.databaseRef ?? next.databaseRef
    try { admitted = await options.effects.loadAdmittedBindingIds(hostId, databaseRef) } catch {
      throw new D1HostError(D1HostErrorCode.PUBLICATION_FAILED, { field: 'admissions' })
    }
    const admittedSet = new Set(admitted.map((id, index) => strictD1Ref(id, `admissions[${index}]`)))
    if ([...admittedSet].some((id) => !oldPlan.has(id))) throw new D1HostError(D1HostErrorCode.BINDING_ADMITTED, { field: 'bindingId' })
    const admittedRemoval = removals.find((id) => admittedSet.has(id))
    if (admittedRemoval) throw new D1HostError(D1HostErrorCode.BINDING_ADMITTED, { field: 'bindingId' })
    if (!current) return removals
    if (!equal(hostRuntime(current.desired.plan), hostRuntime(next))) {
      throw new D1HostError(D1HostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, { field: 'hostRuntime' })
    }
    for (const [id, oldBinding] of oldPlan) {
      const nextBinding = nextPlan.get(id)
      if (!nextBinding) continue
      if (!equal(withoutLanding(oldBinding), withoutLanding(nextBinding))) {
        throw new D1HostError(D1HostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, { field: 'bindingId' })
      }
    }
    return removals
  }
  const validateResolved = (current: D1StoredCompleteV1 | null, desired: D1DesiredSnapshotV1) => {
    if (!current) return
    const oldPlan = byBinding(current.desired.plan.bindings)
    const oldResolved = byBinding(current.desired.resolvedBindings)
    const nextResolved = byBinding(desired.resolvedBindings)
    for (const id of oldPlan.keys()) {
      if (nextResolved.has(id) && !equal(oldResolved.get(id), nextResolved.get(id))) {
        throw new D1HostError(D1HostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, { field: 'bindingId' })
      }
    }
  }
  const canonicalizeRuntimeInputs = async (desired: D1DesiredSnapshotV1, raw: readonly D1RuntimeInputsInspectionV1[]) => {
    try {
      if (!Array.isArray(raw)) throw new Error()
      const identities = await Promise.all(raw.map(async (entry, index) => {
        assertD1ExactKeys(entry, ['bindingId', 'attestation'], `runtimeInputs[${index}]`)
        const bindingId = strictD1Ref(entry.bindingId, `runtimeInputs[${index}].bindingId`)
        const planned = desired.plan.bindings.find((binding) => binding.bindingId === bindingId)
        if (!planned) throw new Error()
        return createD1RuntimeInputsIdentity(planned, entry.attestation as D1RuntimeInputsAttestationV1)
      }))
      identities.sort((left, right) => left.bindingId < right.bindingId ? -1 : left.bindingId > right.bindingId ? 1 : 0)
      if (new Set(identities.map((identity) => identity.bindingId)).size !== identities.length ||
        !equal(identities.map((identity) => identity.bindingId), desired.plan.bindings.map((binding) => binding.bindingId))) throw new Error()
      return Object.freeze(identities)
    } catch { throw new D1HostError(D1HostErrorCode.COLLECTION_NOT_READY, { field: 'runtimeInputs' }) }
  }
  const inspectRuntimeInputs = async (desired: D1DesiredSnapshotV1) => {
    try { return await canonicalizeRuntimeInputs(desired, await options.inspectRuntimeInputs(desired)) }
    catch (error) { throw adapterError(error, 'runtimeInputs') }
  }
  const validateRuntimeInputs = (current: D1StoredCompleteV1 | null, identities: readonly D1RuntimeInputsIdentityV1[]) => {
    if (!current) return
    const retained = new Set(current.desired.plan.bindings.map((binding) => binding.bindingId))
    const active = byBinding(current.observation.bindings)
    for (const identity of identities) {
      if (!retained.has(identity.bindingId)) continue
      const prior = active.get(identity.bindingId)?.runtimeInputs
      if (!prior || prior.digest !== identity.digest || !equal(prior, identity)) {
        throw new D1HostError(D1HostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, { field: 'runtimeInputs' })
      }
    }
  }
  const audit = (revisionId: string, desiredStateDigest: string, outcome: string, phase: string, completionDigest?: string): D1AuditRecordV1 => canonicalizeD1AuditRecord({
    schemaVersion: 1, domain: 'boring-d1-audit:v1', revisionId, desiredStateDigest,
    at: options.clock(), operator: options.operator, outcome, phase, ...(completionDigest ? { completionDigest } : {}),
  })
  const appendBestEffort = async (hostId: string, revisionId: string, desiredStateDigest: string, outcome: string, phase: string, completionDigest?: string) => {
    try { await options.store.appendAudit(hostId, audit(revisionId, desiredStateDigest, outcome, phase, completionDigest)) } catch {}
  }
  const requireFencedPublication = (): D1FencedDestructivePublication => {
    if (!options.fencedPublication) throw new D1HostError(D1HostErrorCode.ROLLBACK_JOURNAL_FAILED, { field: 'rollbackJournal' })
    return options.fencedPublication
  }
  const recoverPublications = async (publication: D1FencedDestructivePublication, hostId: string) => {
    try { await publication.recoverPending(hostId) } catch {
      throw new D1HostError(D1HostErrorCode.ROLLBACK_JOURNAL_FAILED, { field: 'rollbackJournal' })
    }
  }
  const recover = async (hostId: string, active: D1ActiveEnvelopeV1 | null, complete: D1StoredCompleteV1 | null) => {
    if (!active || !complete) return
    let terminal: boolean
    try { terminal = await options.store.hasTerminalAudit(hostId, active) } catch { throw new D1HostError(D1HostErrorCode.PUBLICATION_FAILED, { field: 'audit' }) }
    if (!terminal) {
      try { await options.store.appendAudit(hostId, audit(active.revisionId, active.desiredStateDigest, 'RECOVERY_REQUIRED', 'RECOVERY', complete.completion.completionDigest)) } catch {
        throw new D1HostError(D1HostErrorCode.PUBLICATION_FAILED, { field: 'audit' })
      }
    }
  }
  const create = async (
    hostId: string,
    desired: D1DesiredSnapshotV1,
    inspected: readonly D1RuntimeInputsIdentityV1[],
    prior: D1ActiveEnvelopeV1 | null,
    removals: readonly string[],
    publication: D1FencedDestructivePublication,
  ): Promise<D1ActiveEnvelopeV1> => {
    const desiredStateDigest = await digestD1Desired(desired)
    let revisionId: string
    try { revisionId = await options.store.reserveRevisionId(hostId) } catch (error) {
      if (error instanceof D1HostError) throw new D1HostError(error.code, { field: error.details.field ?? 'candidate' })
      throw new D1HostError(D1HostErrorCode.COLLECTION_NOT_READY, { field: 'candidate' })
    }
    let candidate: D1StoredCandidateV1
    try { candidate = await options.store.writeCandidate(hostId, revisionId, desired) } catch (error) {
      await appendBestEffort(hostId, revisionId, desiredStateDigest, 'FAILED', 'CANDIDATE')
      if (error instanceof D1HostError) throw new D1HostError(error.code, { field: error.details.field ?? 'candidate' })
      throw new D1HostError(D1HostErrorCode.COLLECTION_NOT_READY, { field: 'candidate' })
    }
    let materialized: readonly D1RuntimeInputsIdentityV1[]
    try {
      materialized = await canonicalizeRuntimeInputs(desired, await options.effects.materialize(candidate, inspected))
      if (!equal(materialized, inspected)) throw new D1HostError(D1HostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, { field: 'runtimeInputs' })
    } catch (error) {
      await appendBestEffort(hostId, revisionId, desiredStateDigest, 'FAILED', 'MATERIALIZE')
      throw adapterError(error, 'materialize')
    }
    let observation: D1ObservationV1
    try {
      const refreshed = await inspectRuntimeInputs(desired)
      if (!equal(refreshed, materialized)) throw new D1HostError(D1HostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, { field: 'runtimeInputs' })
      observation = await canonicalizeD1Observation(await options.effects.preload(candidate, materialized), desired)
      if (!equal(observation.bindings.map((binding) => binding.runtimeInputs), materialized)) {
        throw new D1HostError(D1HostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, { field: 'runtimeInputs' })
      }
      await options.store.writeObservation(hostId, revisionId, observation)
    } catch (error) {
      await appendBestEffort(hostId, revisionId, desiredStateDigest, 'FAILED', 'READINESS')
      throw adapterError(error, 'readiness')
    }
    let complete: D1StoredCompleteV1
    try { complete = await options.store.writeComplete(hostId, revisionId) } catch {
      await appendBestEffort(hostId, revisionId, desiredStateDigest, 'FAILED', 'COMPLETION')
      throw new D1HostError(D1HostErrorCode.COLLECTION_NOT_READY, { field: 'completion' })
    }
    let active: D1ActiveEnvelopeV1
    if (removals.length > 0) {
      if (!prior) throw new D1HostError(D1HostErrorCode.ROLLBACK_JOURNAL_FAILED, { field: 'rollbackJournal' })
      try {
        await publication.publish({
          operationId: options.operator.invocationId, hostId,
          expectedRevision: prior.revisionId, expectedDigest: prior.desiredStateDigest,
          targetRevision: revisionId, targetDigest: complete.desiredStateDigest,
          removalBindingIds: removals,
        })
      } catch (error) {
        if (error instanceof D1HostError && FENCED_PUBLICATION_CODES.has(error.code)) throw error
        throw new D1HostError(D1HostErrorCode.ROLLBACK_JOURNAL_FAILED, { field: 'rollbackJournal' })
      }
      active = Object.freeze({ schemaVersion: 1, revisionId, desiredStateDigest: complete.desiredStateDigest })
    } else try { active = await options.store.publishActive(hostId, revisionId) } catch (error) {
      let committed = error instanceof D1ActivePublishError && error.committed
      if (!(error instanceof D1ActivePublishError)) {
        try { committed = (await options.store.readActive(hostId))?.revisionId === revisionId } catch { committed = true }
      }
      await appendBestEffort(hostId, revisionId, desiredStateDigest, committed ? 'RECOVERY_REQUIRED' : 'FAILED', 'PUBLICATION', complete.completion.completionDigest)
      throw new D1HostError(D1HostErrorCode.PUBLICATION_FAILED, { field: 'active' })
    }
    try { await options.effects.verifyActive(active) } catch {
      await appendBestEffort(hostId, revisionId, desiredStateDigest, 'RECOVERY_REQUIRED', 'PUBLICATION', complete.completion.completionDigest)
      throw new D1HostError(D1HostErrorCode.PUBLICATION_FAILED, { field: 'active' })
    }
    try { await options.store.appendAudit(hostId, audit(revisionId, desiredStateDigest, 'COMPLETE', 'AUDIT', complete.completion.completionDigest)) } catch {
      await appendBestEffort(hostId, revisionId, desiredStateDigest, 'RECOVERY_REQUIRED', 'AUDIT', complete.completion.completionDigest)
      throw new D1HostError(D1HostErrorCode.PUBLICATION_FAILED, { field: 'audit' })
    }
    return active
  }

  return Object.freeze({
    async execute(raw: unknown): Promise<D1CommandResult> {
      const command = parse(raw)
      let desired: D1DesiredSnapshotV1
      let hostId: string
      let expectedHostRevision: string | null
      if (command.kind === 'rollback') {
        hostId = command.hostId; expectedHostRevision = command.expectedHostRevision
        try { options.mutationGuard.assertHeld(hostId) } catch { throw new D1HostError(D1HostErrorCode.REVISION_CONFLICT, { field: 'hostLock' }) }
        const publication = requireFencedPublication()
        await recoverPublications(publication, hostId)
        const state = await loadActive(hostId); assertCas(state.active, expectedHostRevision)
        let target: D1StoredCompleteV1 | null
        try { target = await options.store.readComplete(hostId, command.targetRevision) } catch { target = null }
        if (!target) throw new D1HostError(D1HostErrorCode.ROLLBACK_TARGET_INVALID, { field: 'targetRevision' })
        const removals = await preflightPlan(hostId, state.complete, target.desired.plan, command.confirmRemove ?? [], true)
        desired = await reproduce(target, hostId)
        validateResolved(state.complete, desired)
        const inspected = await inspectRuntimeInputs(desired)
        validateRuntimeInputs(state.complete, inspected)
        const desiredStateDigest = await digestD1Desired(desired)
        await recover(hostId, state.active, state.complete)
        if (desiredStateDigest === state.active?.desiredStateDigest) return Object.freeze({ kind: 'ROLLBACK', action: 'NOOP', activeRevision: state.active?.revisionId ?? null, desiredStateDigest, removals })
        const active = await create(hostId, desired, inspected, state.active, removals, publication)
        return Object.freeze({ kind: 'ROLLBACK', action: 'CREATE', activeRevision: active.revisionId, revisionId: active.revisionId, desiredStateDigest, removals })
      }
      const parsedPlan = parseD1HostPlan(command.plan)
      hostId = parsedPlan.hostId; expectedHostRevision = parsedPlan.expectedHostRevision
      let publication: D1FencedDestructivePublication | undefined
      if (command.kind === 'apply') {
        try { options.mutationGuard.assertHeld(hostId) } catch { throw new D1HostError(D1HostErrorCode.REVISION_CONFLICT, { field: 'hostLock' }) }
        publication = requireFencedPublication()
        await recoverPublications(publication, hostId)
      }
      const state = await loadActive(hostId); assertCas(state.active, expectedHostRevision)
      const removals = await preflightPlan(hostId, state.complete, persistedPlan(parsedPlan), command.confirmRemove ?? [], command.kind === 'apply')
      desired = await resolvePlan(parsedPlan)
      validateResolved(state.complete, desired)
      const inspected = await inspectRuntimeInputs(desired)
      validateRuntimeInputs(state.complete, inspected)
      const desiredStateDigest = await digestD1Desired(desired)
      if (command.kind === 'plan') return Object.freeze({ kind: 'PLAN', action: desiredStateDigest === state.active?.desiredStateDigest ? 'NOOP' : 'CREATE', activeRevision: state.active?.revisionId ?? null, desiredStateDigest, removals })
      await recover(hostId, state.active, state.complete)
      if (desiredStateDigest === state.active?.desiredStateDigest) return Object.freeze({ kind: 'APPLY', action: 'NOOP', activeRevision: state.active?.revisionId ?? null, desiredStateDigest, removals })
      const active = await create(hostId, desired, inspected, state.active, removals, publication!)
      return Object.freeze({ kind: 'APPLY', action: 'CREATE', activeRevision: active.revisionId, revisionId: active.revisionId, desiredStateDigest, removals })
    },
  })
}
