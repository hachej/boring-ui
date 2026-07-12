import {
  createAgentAssetDigest,
  createAgentDeploymentDigest,
  OpaqueRefSchema,
  type AgentDeployment,
  type Sha256Digest,
} from '@hachej/boring-agent/shared'
import { createResolvedAgentDigest } from '@hachej/boring-agent/server'

import {
  assertD1ExactKeys as exactKeys,
  d1Digest as digest,
  invalidD1Field as fail,
  parseD1HostPlan,
  strictD1Ref as ref,
  type D1HostPlanV1,
} from './d1Plan.js'
import {
  canonicalizeWorkspaceCompositionSnapshot,
  type WorkspaceCompositionSnapshotV1,
} from './workspaceComposition.js'

export type D1PersistedPlanV1 = Omit<D1HostPlanV1, 'expectedHostRevision'>

export interface D1ResolvedBindingV1 {
  readonly schemaVersion: 1
  readonly bindingId: string
  readonly composition: Readonly<{ snapshot: WorkspaceCompositionSnapshotV1; digest: Sha256Digest }>
  readonly workspace: Readonly<{ workspaceId: string; defaultDeploymentId: string; compositionDigest: Sha256Digest }>
  readonly deployment: Readonly<{ deploymentId: string; version: string; agentId: string; digest: Sha256Digest }>
  readonly definition: Readonly<{ definitionId: string; version: string; digest: Sha256Digest; instructionsRef: string }>
  readonly resolvedDigest: Sha256Digest
}

export interface D1DesiredSnapshotV1 {
  readonly schemaVersion: 1
  readonly domain: 'boring-d1-desired:v1'
  readonly plan: D1PersistedPlanV1
  readonly resolvedBindings: readonly D1ResolvedBindingV1[]
}

export interface D1SecretRefsEnvelopeV1 {
  readonly schemaVersion: 1
  readonly domain: 'boring-d1-secret-refs:v1'
  readonly bindings: readonly Readonly<{ bindingId: string; secretRefs: readonly string[] }>[]
}

export interface D1ObservationV1 {
  readonly schemaVersion: 1
  readonly domain: 'boring-d1-observed:v1'
  readonly bindings: readonly Readonly<{ bindingId: string; ready: boolean; resolvedDigest: Sha256Digest }>[]
}

export interface D1CompleteEnvelopeV1 {
  readonly schemaVersion: 1
  readonly domain: 'boring-d1-completion:v1'
  readonly status: 'COMPLETE'
  readonly revisionId: string
  readonly desiredStateDigest: Sha256Digest
  readonly observationDigest: Sha256Digest
  readonly completionDigest: Sha256Digest
}

export interface D1ActiveEnvelopeV1 {
  readonly schemaVersion: 1
  readonly revisionId: string
  readonly desiredStateDigest: Sha256Digest
}

interface D1AuditBaseV1 {
  readonly schemaVersion: 1
  readonly domain: 'boring-d1-audit:v1'
  readonly revisionId: string
  readonly desiredStateDigest: Sha256Digest
  readonly at: string
  readonly operator: Readonly<{ uid: number; effectiveUser: string; invocationId: string; note?: string }>
}

export interface D1PreCompleteFailedAuditV1 extends D1AuditBaseV1 {
  readonly outcome: 'FAILED'
  readonly phase: 'CANDIDATE' | 'MATERIALIZE' | 'READINESS' | 'COMPLETION'
}
export interface D1PostCompleteFailedAuditV1 extends D1AuditBaseV1 {
  readonly outcome: 'FAILED'
  readonly phase: 'PUBLICATION'
  readonly completionDigest: Sha256Digest
}
export interface D1CompleteAuditV1 extends D1AuditBaseV1 {
  readonly outcome: 'COMPLETE'
  readonly phase: 'AUDIT'
  readonly completionDigest: Sha256Digest
}
export interface D1RecoveryAuditV1 extends D1AuditBaseV1 {
  readonly outcome: 'RECOVERY_REQUIRED'
  readonly phase: 'PUBLICATION' | 'AUDIT' | 'RECOVERY'
  readonly completionDigest: Sha256Digest
}
export type D1AuditRecordV1 = D1PreCompleteFailedAuditV1 | D1PostCompleteFailedAuditV1 | D1CompleteAuditV1 | D1RecoveryAuditV1

const DESIRED_DOMAIN = 'boring-d1-desired:v1' as const
const OBSERVED_DOMAIN = 'boring-d1-observed:v1' as const
const COMPLETION_DOMAIN = 'boring-d1-completion:v1' as const
const AUDIT_DOMAIN = 'boring-d1-audit:v1' as const
const REVISION_RE = /^r\d{10}$/
const PLAN_KEYS = ['schemaVersion', 'hostId', 'hostAppImageDigest', 'runtimeProfileRef', 'databaseRef', 'workspaceRootPolicyRef', 'sessionRootPolicyRef', 'bindings'] as const
const RESOLVED_KEYS = ['schemaVersion', 'bindingId', 'composition', 'workspace', 'deployment', 'definition', 'resolvedDigest'] as const
const PRE_COMPLETE_PHASES = ['CANDIDATE', 'MATERIALIZE', 'READINESS', 'COMPLETION'] as const
const RECOVERY_PHASES = ['PUBLICATION', 'AUDIT', 'RECOVERY'] as const

function opaque(value: unknown, field: string): string {
  const parsed = OpaqueRefSchema.safeParse(value)
  if (!parsed.success) fail(field)
  return parsed.data
}

function assetRef(value: unknown, field: string): string {
  const candidate = opaque(value, field)
  const segments = candidate.split('/')
  if (
    candidate.normalize('NFC') !== candidate || candidate.includes('\\') ||
    candidate.startsWith('/') || candidate.startsWith('./') || /^[A-Za-z]:[\\/]/.test(candidate) ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) fail(field)
  return candidate
}

function revision(value: unknown, field: string): string {
  if (typeof value !== 'string' || !REVISION_RE.test(value)) fail(field)
  return value
}

function sortUnique<T>(values: readonly T[], identity: (value: T) => string, field: string): readonly T[] {
  const sorted = [...values].sort((left, right) => identity(left) < identity(right) ? -1 : identity(left) > identity(right) ? 1 : 0)
  if (new Set(sorted.map(identity)).size !== sorted.length) fail(field)
  return Object.freeze(sorted)
}

async function canonicalResolved(raw: unknown, index: number): Promise<D1ResolvedBindingV1> {
  const field = `desired.resolvedBindings[${index}]`
  exactKeys(raw, RESOLVED_KEYS, field)
  if (raw.schemaVersion !== 1) fail(`${field}.schemaVersion`)
  exactKeys(raw.composition, ['snapshot', 'digest'], `${field}.composition`)
  const snapshot = canonicalizeWorkspaceCompositionSnapshot(raw.composition.snapshot)
  const compositionDigest = await createAgentAssetDigest(JSON.stringify(snapshot))
  if (digest(raw.composition.digest, `${field}.composition.digest`) !== compositionDigest) fail(`${field}.composition.digest`)
  exactKeys(raw.workspace, ['workspaceId', 'defaultDeploymentId', 'compositionDigest'], `${field}.workspace`)
  const workspace = Object.freeze({
    workspaceId: opaque(raw.workspace.workspaceId, `${field}.workspace.workspaceId`),
    defaultDeploymentId: opaque(raw.workspace.defaultDeploymentId, `${field}.workspace.defaultDeploymentId`),
    compositionDigest: digest(raw.workspace.compositionDigest, `${field}.workspace.compositionDigest`),
  })
  if (workspace.compositionDigest !== compositionDigest) fail(`${field}.workspace.compositionDigest`)
  exactKeys(raw.deployment, ['deploymentId', 'version', 'agentId', 'digest'], `${field}.deployment`)
  exactKeys(raw.definition, ['definitionId', 'version', 'digest', 'instructionsRef'], `${field}.definition`)
  const definition = Object.freeze({
    definitionId: opaque(raw.definition.definitionId, `${field}.definition.definitionId`),
    version: opaque(raw.definition.version, `${field}.definition.version`),
    digest: digest(raw.definition.digest, `${field}.definition.digest`),
    instructionsRef: assetRef(raw.definition.instructionsRef, `${field}.definition.instructionsRef`),
  })
  const deploymentInput: AgentDeployment = {
    deploymentId: opaque(raw.deployment.deploymentId, `${field}.deployment.deploymentId`),
    version: opaque(raw.deployment.version, `${field}.deployment.version`),
    agentId: opaque(raw.deployment.agentId, `${field}.deployment.agentId`),
    definition: { definitionId: definition.definitionId, version: definition.version, digest: definition.digest },
  }
  if (deploymentInput.agentId !== 'default') fail(`${field}.deployment.agentId`)
  const deploymentDigest = await createAgentDeploymentDigest(deploymentInput).catch(() => fail(`${field}.deployment`))
  if (digest(raw.deployment.digest, `${field}.deployment.digest`) !== deploymentDigest) fail(`${field}.deployment.digest`)
  const deployment = Object.freeze({
    deploymentId: deploymentInput.deploymentId,
    version: deploymentInput.version,
    agentId: deploymentInput.agentId,
    digest: deploymentDigest,
  })
  const resolvedDigest = await createResolvedAgentDigest({
    workspaceId: workspace.workspaceId,
    defaultDeploymentId: workspace.defaultDeploymentId,
    workspaceCompositionDigest: workspace.compositionDigest,
    definitionDigest: definition.digest,
    deploymentDigest: deployment.digest,
  }).catch(() => fail(`${field}.resolvedDigest`))
  if (digest(raw.resolvedDigest, `${field}.resolvedDigest`) !== resolvedDigest) fail(`${field}.resolvedDigest`)
  return Object.freeze({
    schemaVersion: 1,
    bindingId: ref(raw.bindingId, `${field}.bindingId`),
    composition: Object.freeze({ snapshot, digest: compositionDigest }),
    workspace,
    deployment,
    definition,
    resolvedDigest,
  })
}

async function fromPersistedPlan(raw: unknown, resolvedBindings: unknown): Promise<D1DesiredSnapshotV1> {
  exactKeys(raw, PLAN_KEYS, 'desired.plan')
  const { expectedHostRevision: _expected, ...plan } = parseD1HostPlan({ ...raw, expectedHostRevision: null })
  if (!Array.isArray(resolvedBindings)) fail('desired.resolvedBindings')
  const bindings = sortUnique(await Promise.all(resolvedBindings.map(canonicalResolved)), (binding) => binding.bindingId, 'desired.resolvedBindings')
  if (JSON.stringify(bindings.map((binding) => binding.bindingId)) !== JSON.stringify(plan.bindings.map((binding) => binding.bindingId))) fail('desired.resolvedBindings.bindingId')
  for (const binding of bindings) {
    const planned = plan.bindings.find((entry) => entry.bindingId === binding.bindingId)!
    const composition = binding.composition.snapshot
    if (
      binding.workspace.workspaceId !== planned.workspaceId ||
      binding.workspace.defaultDeploymentId !== planned.defaultDeploymentId ||
      binding.deployment.deploymentId !== planned.defaultDeploymentId ||
      composition.workspaceId !== planned.workspaceId ||
      composition.hostAppImageDigest !== plan.hostAppImageDigest ||
      composition.runtimeProfile.ref !== plan.runtimeProfileRef ||
      composition.runtimeProfile.workspaceRootPolicyRef !== plan.workspaceRootPolicyRef ||
      composition.runtimeProfile.sessionRootPolicyRef !== plan.sessionRootPolicyRef
    ) fail(`desired.resolvedBindings.${binding.bindingId}`)
  }
  return Object.freeze({ schemaVersion: 1, domain: DESIRED_DOMAIN, plan: Object.freeze(plan), resolvedBindings: bindings })
}

export async function createD1DesiredSnapshot(plan: unknown, resolvedBindings: unknown): Promise<D1DesiredSnapshotV1> {
  const parsed = parseD1HostPlan(plan)
  const { expectedHostRevision: _expected, ...persisted } = parsed
  return fromPersistedPlan(persisted, resolvedBindings)
}

export async function canonicalizeD1DesiredSnapshot(raw: unknown): Promise<D1DesiredSnapshotV1> {
  exactKeys(raw, ['schemaVersion', 'domain', 'plan', 'resolvedBindings'], 'desired')
  if (raw.schemaVersion !== 1 || raw.domain !== DESIRED_DOMAIN) fail('desired')
  return fromPersistedPlan(raw.plan, raw.resolvedBindings)
}

export async function digestD1Desired(raw: unknown): Promise<Sha256Digest> {
  return createAgentAssetDigest(JSON.stringify(await canonicalizeD1DesiredSnapshot(raw)))
}

export function deriveD1SecretRefsEnvelope(desired: D1DesiredSnapshotV1): D1SecretRefsEnvelopeV1 {
  return Object.freeze({
    schemaVersion: 1,
    domain: 'boring-d1-secret-refs:v1',
    bindings: Object.freeze(desired.plan.bindings.map((binding) => Object.freeze({ bindingId: binding.bindingId, secretRefs: binding.secretRefs }))),
  })
}

export function canonicalizeD1SecretRefsEnvelope(raw: unknown, desired: D1DesiredSnapshotV1): D1SecretRefsEnvelopeV1 {
  exactKeys(raw, ['schemaVersion', 'domain', 'bindings'], 'secretRefs')
  if (raw.schemaVersion !== 1 || raw.domain !== 'boring-d1-secret-refs:v1' || !Array.isArray(raw.bindings)) fail('secretRefs')
  const bindings = sortUnique(raw.bindings.map((binding, index) => {
    exactKeys(binding, ['bindingId', 'secretRefs'], `secretRefs.bindings[${index}]`)
    if (!Array.isArray(binding.secretRefs)) fail(`secretRefs.bindings[${index}].secretRefs`)
    const secretRefs = sortUnique(binding.secretRefs.map((value, secretIndex) => ref(value, `secretRefs.bindings[${index}].secretRefs[${secretIndex}]`)), (value) => value, `secretRefs.bindings[${index}].secretRefs`)
    return Object.freeze({ bindingId: ref(binding.bindingId, `secretRefs.bindings[${index}].bindingId`), secretRefs })
  }), (binding) => binding.bindingId, 'secretRefs.bindings')
  const canonical = Object.freeze({ schemaVersion: 1 as const, domain: 'boring-d1-secret-refs:v1' as const, bindings })
  if (JSON.stringify(canonical) !== JSON.stringify(deriveD1SecretRefsEnvelope(desired))) fail('secretRefs.bindings')
  return canonical
}

export function canonicalizeD1Observation(raw: unknown, desired: D1DesiredSnapshotV1): D1ObservationV1 {
  exactKeys(raw, ['schemaVersion', 'domain', 'bindings'], 'observation')
  if (raw.schemaVersion !== 1 || raw.domain !== OBSERVED_DOMAIN || !Array.isArray(raw.bindings)) fail('observation')
  const bindings = sortUnique(raw.bindings.map((binding, index) => {
    exactKeys(binding, ['bindingId', 'ready', 'resolvedDigest'], `observation.bindings[${index}]`)
    if (typeof binding.ready !== 'boolean') fail(`observation.bindings[${index}].ready`)
    return Object.freeze({
      bindingId: ref(binding.bindingId, `observation.bindings[${index}].bindingId`),
      ready: binding.ready,
      resolvedDigest: digest(binding.resolvedDigest, `observation.bindings[${index}].resolvedDigest`),
    })
  }), (binding) => binding.bindingId, 'observation.bindings')
  if (JSON.stringify(bindings.map((binding) => binding.bindingId)) !== JSON.stringify(desired.resolvedBindings.map((binding) => binding.bindingId))) fail('observation.bindings')
  for (const binding of bindings) {
    if (binding.resolvedDigest !== desired.resolvedBindings.find((entry) => entry.bindingId === binding.bindingId)!.resolvedDigest) fail(`observation.bindings.${binding.bindingId}.resolvedDigest`)
  }
  return Object.freeze({ schemaVersion: 1, domain: OBSERVED_DOMAIN, bindings })
}

export async function digestD1Observation(raw: unknown, desired: D1DesiredSnapshotV1): Promise<Sha256Digest> {
  return createAgentAssetDigest(JSON.stringify(canonicalizeD1Observation(raw, desired)))
}

export async function createD1CompleteEnvelope(
  revisionId: string,
  desired: D1DesiredSnapshotV1,
  observed: D1ObservationV1,
): Promise<D1CompleteEnvelopeV1> {
  const observation = canonicalizeD1Observation(observed, desired)
  if (observation.bindings.some((binding) => !binding.ready)) fail('completion.observation.ready')
  const desiredStateDigest = await digestD1Desired(desired)
  const observationDigest = await digestD1Observation(observation, desired)
  const completionDigest = await createAgentAssetDigest(JSON.stringify({ domain: COMPLETION_DOMAIN, desiredStateDigest, observationDigest }))
  return Object.freeze({ schemaVersion: 1, domain: COMPLETION_DOMAIN, status: 'COMPLETE', revisionId: revision(revisionId, 'completion.revisionId'), desiredStateDigest, observationDigest, completionDigest })
}

export async function canonicalizeD1CompleteEnvelope(raw: unknown, desired: D1DesiredSnapshotV1, observed: D1ObservationV1): Promise<D1CompleteEnvelopeV1> {
  exactKeys(raw, ['schemaVersion', 'domain', 'status', 'revisionId', 'desiredStateDigest', 'observationDigest', 'completionDigest'], 'completion')
  if (raw.schemaVersion !== 1 || raw.domain !== COMPLETION_DOMAIN || raw.status !== 'COMPLETE') fail('completion')
  const expected = await createD1CompleteEnvelope(revision(raw.revisionId, 'completion.revisionId'), desired, observed)
  for (const key of ['desiredStateDigest', 'observationDigest', 'completionDigest'] as const) {
    if (digest(raw[key], `completion.${key}`) !== expected[key]) fail(`completion.${key}`)
  }
  return expected
}

export function canonicalizeD1ActiveEnvelope(raw: unknown): D1ActiveEnvelopeV1 {
  exactKeys(raw, ['schemaVersion', 'revisionId', 'desiredStateDigest'], 'active')
  if (raw.schemaVersion !== 1) fail('active.schemaVersion')
  return Object.freeze({ schemaVersion: 1, revisionId: revision(raw.revisionId, 'active.revisionId'), desiredStateDigest: digest(raw.desiredStateDigest, 'active.desiredStateDigest') })
}

function operator(raw: unknown) {
  exactKeys(raw, ['uid', 'effectiveUser', 'invocationId', 'note'], 'audit.operator', ['note'])
  if (!Number.isSafeInteger(raw.uid) || Number(raw.uid) < 0) fail('audit.operator.uid')
  if (raw.note !== undefined && (typeof raw.note !== 'string' || raw.note.length > 500 || /[\0-\x1f\x7f]/.test(raw.note))) fail('audit.operator.note')
  return Object.freeze({
    uid: Number(raw.uid),
    effectiveUser: opaque(raw.effectiveUser, 'audit.operator.effectiveUser'),
    invocationId: opaque(raw.invocationId, 'audit.operator.invocationId'),
    ...(raw.note === undefined ? {} : { note: raw.note }),
  })
}

export function canonicalizeD1AuditRecord(raw: unknown): D1AuditRecordV1 {
  exactKeys(raw, ['schemaVersion', 'domain', 'revisionId', 'desiredStateDigest', 'outcome', 'phase', 'at', 'operator', 'completionDigest'], 'audit', ['completionDigest'])
  if (raw.schemaVersion !== 1 || raw.domain !== AUDIT_DOMAIN) fail('audit')
  if (typeof raw.at !== 'string' || raw.at.length > 64 || !Number.isFinite(Date.parse(raw.at)) || new Date(raw.at).toISOString() !== raw.at) fail('audit.at')
  const base = {
    schemaVersion: 1 as const,
    domain: AUDIT_DOMAIN,
    revisionId: revision(raw.revisionId, 'audit.revisionId'),
    desiredStateDigest: digest(raw.desiredStateDigest, 'audit.desiredStateDigest'),
    at: raw.at,
    operator: operator(raw.operator),
  }
  const hasCompletion = Object.hasOwn(raw, 'completionDigest')
  if (raw.outcome === 'FAILED') {
    if (raw.phase === 'PUBLICATION') {
      if (!hasCompletion) fail('audit.completionDigest')
      return Object.freeze({ ...base, outcome: 'FAILED', phase: 'PUBLICATION', completionDigest: digest(raw.completionDigest, 'audit.completionDigest') })
    }
    if (!PRE_COMPLETE_PHASES.includes(raw.phase as typeof PRE_COMPLETE_PHASES[number])) fail('audit.phase')
    if (hasCompletion) fail('audit.completionDigest')
    return Object.freeze({ ...base, outcome: 'FAILED', phase: raw.phase as D1PreCompleteFailedAuditV1['phase'] })
  }
  if (!hasCompletion) fail('audit.completionDigest')
  const completionDigest = digest(raw.completionDigest, 'audit.completionDigest')
  if (raw.outcome === 'COMPLETE') {
    if (raw.phase !== 'AUDIT') fail('audit.phase')
    return Object.freeze({ ...base, outcome: 'COMPLETE', phase: 'AUDIT', completionDigest })
  }
  if (raw.outcome !== 'RECOVERY_REQUIRED') fail('audit.outcome')
  if (!RECOVERY_PHASES.includes(raw.phase as typeof RECOVERY_PHASES[number])) fail('audit.phase')
  return Object.freeze({ ...base, outcome: 'RECOVERY_REQUIRED', phase: raw.phase as D1RecoveryAuditV1['phase'], completionDigest })
}

export function isD1TerminalAuditFor(
  record: D1AuditRecordV1,
  active: D1ActiveEnvelopeV1,
  complete: D1CompleteEnvelopeV1,
): boolean {
  return record.outcome !== 'FAILED' &&
    record.revisionId === active.revisionId &&
    record.desiredStateDigest === active.desiredStateDigest &&
    complete.revisionId === active.revisionId &&
    complete.desiredStateDigest === active.desiredStateDigest &&
    record.completionDigest === complete.completionDigest
}
