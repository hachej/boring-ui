import {
  createAgentAssetDigest,
  createAgentDeploymentDigest,
  OpaqueRefSchema,
  type AgentDeployment,
  type Sha256Digest,
} from '@hachej/boring-agent/shared'
import { createResolvedAgentDigest } from '@hachej/boring-agent/server'

import {
  assertAgentHostExactKeys as exactKeys,
  agentHostDigest as digest,
  invalidAgentHostField as fail,
  parseAgentHostPlan,
  strictAgentHostRef as ref,
  type AgentHostPlanV1,
} from './agentHostPlan.js'
import {
  canonicalizeWorkspaceCompositionSnapshot,
  type WorkspaceCompositionSnapshotV1,
} from './workspaceComposition.js'
import { canonicalizeAgentHostRuntimeInputsIdentity, type AgentHostRuntimeInputsIdentityV1 } from './agentHostRuntimeInputs.js'

export type AgentHostPersistedPlanV1 = Omit<AgentHostPlanV1, 'expectedHostRevision'>

export interface AgentHostResolvedBindingV1 {
  readonly schemaVersion: 1
  readonly bindingId: string
  readonly composition: Readonly<{ snapshot: WorkspaceCompositionSnapshotV1; digest: Sha256Digest }>
  readonly workspace: Readonly<{ workspaceId: string; defaultDeploymentId: string; compositionDigest: Sha256Digest }>
  readonly deployment: Readonly<{ deploymentId: string; version: string; agentId: string; digest: Sha256Digest }>
  readonly definition: Readonly<{ definitionId: string; version: string; digest: Sha256Digest; instructionsRef: string }>
  readonly resolvedDigest: Sha256Digest
}

export interface AgentHostDesiredSnapshotV1 {
  readonly schemaVersion: 1
  readonly domain: 'boring-agent-host-desired:v1'
  readonly plan: AgentHostPersistedPlanV1
  readonly resolvedBindings: readonly AgentHostResolvedBindingV1[]
}

export interface AgentHostSecretRefsEnvelopeV1 {
  readonly schemaVersion: 1
  readonly domain: 'boring-agent-host-secret-refs:v1'
  readonly bindings: readonly Readonly<{ bindingId: string; secretRefs: readonly string[] }>[]
}

// AgentHost is pre-production with no persisted v1 state; runtime identity is intentionally required.
export interface AgentHostObservationV1 {
  readonly schemaVersion: 1
  readonly domain: 'boring-agent-host-observed:v1'
  readonly bindings: readonly Readonly<{
    bindingId: string
    ready: boolean
    resolvedDigest: Sha256Digest
    runtimeInputs: AgentHostRuntimeInputsIdentityV1
  }>[]
}

export interface AgentHostCompleteEnvelopeV1 {
  readonly schemaVersion: 1
  readonly domain: 'boring-agent-host-completion:v1'
  readonly status: 'COMPLETE'
  readonly revisionId: string
  readonly desiredStateDigest: Sha256Digest
  readonly observationDigest: Sha256Digest
  readonly completionDigest: Sha256Digest
}

export interface AgentHostActiveEnvelopeV1 {
  readonly schemaVersion: 1
  readonly revisionId: string
  readonly desiredStateDigest: Sha256Digest
}

interface AgentHostAuditBaseV1 {
  readonly schemaVersion: 1
  readonly domain: 'boring-agent-host-audit:v1'
  readonly revisionId: string
  readonly desiredStateDigest: Sha256Digest
  readonly at: string
  readonly operator: Readonly<{ uid: number; effectiveUser: string; invocationId: string; note?: string }>
}

export interface AgentHostPreCompleteFailedAuditV1 extends AgentHostAuditBaseV1 {
  readonly outcome: 'FAILED'
  readonly phase: 'CANDIDATE' | 'MATERIALIZE' | 'READINESS' | 'COMPLETION'
}
export interface AgentHostPostCompleteFailedAuditV1 extends AgentHostAuditBaseV1 {
  readonly outcome: 'FAILED'
  readonly phase: 'PUBLICATION'
  readonly completionDigest: Sha256Digest
}
export interface AgentHostCompleteAuditV1 extends AgentHostAuditBaseV1 {
  readonly outcome: 'COMPLETE'
  readonly phase: 'AUDIT'
  readonly completionDigest: Sha256Digest
}
export interface AgentHostRecoveryAuditV1 extends AgentHostAuditBaseV1 {
  readonly outcome: 'RECOVERY_REQUIRED'
  readonly phase: 'PUBLICATION' | 'AUDIT' | 'RECOVERY'
  readonly completionDigest: Sha256Digest
}
export type AgentHostAuditRecordV1 = AgentHostPreCompleteFailedAuditV1 | AgentHostPostCompleteFailedAuditV1 | AgentHostCompleteAuditV1 | AgentHostRecoveryAuditV1

const DESIRED_DOMAIN = 'boring-agent-host-desired:v1' as const
const OBSERVED_DOMAIN = 'boring-agent-host-observed:v1' as const
const COMPLETION_DOMAIN = 'boring-agent-host-completion:v1' as const
const AUDIT_DOMAIN = 'boring-agent-host-audit:v1' as const
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

async function canonicalResolved(raw: unknown, index: number): Promise<AgentHostResolvedBindingV1> {
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

async function fromPersistedPlan(raw: unknown, resolvedBindings: unknown): Promise<AgentHostDesiredSnapshotV1> {
  exactKeys(raw, PLAN_KEYS, 'desired.plan')
  const { expectedHostRevision: _expected, ...plan } = parseAgentHostPlan({ ...raw, expectedHostRevision: null })
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

export async function createAgentHostDesiredSnapshot(plan: unknown, resolvedBindings: unknown): Promise<AgentHostDesiredSnapshotV1> {
  const parsed = parseAgentHostPlan(plan)
  const { expectedHostRevision: _expected, ...persisted } = parsed
  return fromPersistedPlan(persisted, resolvedBindings)
}

export async function canonicalizeAgentHostDesiredSnapshot(raw: unknown): Promise<AgentHostDesiredSnapshotV1> {
  exactKeys(raw, ['schemaVersion', 'domain', 'plan', 'resolvedBindings'], 'desired')
  if (raw.schemaVersion !== 1 || raw.domain !== DESIRED_DOMAIN) fail('desired')
  return fromPersistedPlan(raw.plan, raw.resolvedBindings)
}

export async function digestAgentHostDesired(raw: unknown): Promise<Sha256Digest> {
  return createAgentAssetDigest(JSON.stringify(await canonicalizeAgentHostDesiredSnapshot(raw)))
}

export function deriveAgentHostSecretRefsEnvelope(desired: AgentHostDesiredSnapshotV1): AgentHostSecretRefsEnvelopeV1 {
  return Object.freeze({
    schemaVersion: 1,
    domain: 'boring-agent-host-secret-refs:v1',
    bindings: Object.freeze(desired.plan.bindings.map((binding) => Object.freeze({ bindingId: binding.bindingId, secretRefs: binding.secretRefs }))),
  })
}

export function canonicalizeAgentHostSecretRefsEnvelope(raw: unknown, desired: AgentHostDesiredSnapshotV1): AgentHostSecretRefsEnvelopeV1 {
  exactKeys(raw, ['schemaVersion', 'domain', 'bindings'], 'secretRefs')
  if (raw.schemaVersion !== 1 || raw.domain !== 'boring-agent-host-secret-refs:v1' || !Array.isArray(raw.bindings)) fail('secretRefs')
  const bindings = sortUnique(raw.bindings.map((binding, index) => {
    exactKeys(binding, ['bindingId', 'secretRefs'], `secretRefs.bindings[${index}]`)
    if (!Array.isArray(binding.secretRefs)) fail(`secretRefs.bindings[${index}].secretRefs`)
    const secretRefs = sortUnique(binding.secretRefs.map((value, secretIndex) => ref(value, `secretRefs.bindings[${index}].secretRefs[${secretIndex}]`)), (value) => value, `secretRefs.bindings[${index}].secretRefs`)
    return Object.freeze({ bindingId: ref(binding.bindingId, `secretRefs.bindings[${index}].bindingId`), secretRefs })
  }), (binding) => binding.bindingId, 'secretRefs.bindings')
  const canonical = Object.freeze({ schemaVersion: 1 as const, domain: 'boring-agent-host-secret-refs:v1' as const, bindings })
  if (JSON.stringify(canonical) !== JSON.stringify(deriveAgentHostSecretRefsEnvelope(desired))) fail('secretRefs.bindings')
  return canonical
}

export async function canonicalizeAgentHostObservation(raw: unknown, desired: AgentHostDesiredSnapshotV1): Promise<AgentHostObservationV1> {
  exactKeys(raw, ['schemaVersion', 'domain', 'bindings'], 'observation')
  if (raw.schemaVersion !== 1 || raw.domain !== OBSERVED_DOMAIN || !Array.isArray(raw.bindings)) fail('observation')
  const bindings = sortUnique(await Promise.all(raw.bindings.map(async (binding, index) => {
    const field = `observation.bindings[${index}]`
    exactKeys(binding, ['bindingId', 'ready', 'resolvedDigest', 'runtimeInputs'], field)
    if (typeof binding.ready !== 'boolean') fail(`observation.bindings[${index}].ready`)
    const bindingId = ref(binding.bindingId, `${field}.bindingId`)
    const planned = desired.plan.bindings.find((entry) => entry.bindingId === bindingId)
    if (!planned) fail('observation.bindings')
    return Object.freeze({
      bindingId,
      ready: binding.ready,
      resolvedDigest: digest(binding.resolvedDigest, `observation.bindings[${index}].resolvedDigest`),
      runtimeInputs: await canonicalizeAgentHostRuntimeInputsIdentity(binding.runtimeInputs, planned),
    })
  })), (binding) => binding.bindingId, 'observation.bindings')
  if (JSON.stringify(bindings.map((binding) => binding.bindingId)) !== JSON.stringify(desired.resolvedBindings.map((binding) => binding.bindingId))) fail('observation.bindings')
  for (const binding of bindings) {
    if (binding.resolvedDigest !== desired.resolvedBindings.find((entry) => entry.bindingId === binding.bindingId)!.resolvedDigest) fail(`observation.bindings.${binding.bindingId}.resolvedDigest`)
  }
  return Object.freeze({ schemaVersion: 1, domain: OBSERVED_DOMAIN, bindings })
}

export async function digestAgentHostObservation(raw: unknown, desired: AgentHostDesiredSnapshotV1): Promise<Sha256Digest> {
  return createAgentAssetDigest(JSON.stringify(await canonicalizeAgentHostObservation(raw, desired)))
}

export async function createAgentHostCompleteEnvelope(
  revisionId: string,
  desired: AgentHostDesiredSnapshotV1,
  observed: AgentHostObservationV1,
): Promise<AgentHostCompleteEnvelopeV1> {
  const observation = await canonicalizeAgentHostObservation(observed, desired)
  if (observation.bindings.some((binding) => !binding.ready)) fail('completion.observation.ready')
  const desiredStateDigest = await digestAgentHostDesired(desired)
  const observationDigest = await digestAgentHostObservation(observation, desired)
  const completionDigest = await createAgentAssetDigest(JSON.stringify({ domain: COMPLETION_DOMAIN, desiredStateDigest, observationDigest }))
  return Object.freeze({ schemaVersion: 1, domain: COMPLETION_DOMAIN, status: 'COMPLETE', revisionId: revision(revisionId, 'completion.revisionId'), desiredStateDigest, observationDigest, completionDigest })
}

export async function canonicalizeAgentHostCompleteEnvelope(raw: unknown, desired: AgentHostDesiredSnapshotV1, observed: AgentHostObservationV1): Promise<AgentHostCompleteEnvelopeV1> {
  exactKeys(raw, ['schemaVersion', 'domain', 'status', 'revisionId', 'desiredStateDigest', 'observationDigest', 'completionDigest'], 'completion')
  if (raw.schemaVersion !== 1 || raw.domain !== COMPLETION_DOMAIN || raw.status !== 'COMPLETE') fail('completion')
  const expected = await createAgentHostCompleteEnvelope(revision(raw.revisionId, 'completion.revisionId'), desired, observed)
  for (const key of ['desiredStateDigest', 'observationDigest', 'completionDigest'] as const) {
    if (digest(raw[key], `completion.${key}`) !== expected[key]) fail(`completion.${key}`)
  }
  return expected
}

export function canonicalizeAgentHostActiveEnvelope(raw: unknown): AgentHostActiveEnvelopeV1 {
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

export function canonicalizeAgentHostAuditRecord(raw: unknown): AgentHostAuditRecordV1 {
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
    return Object.freeze({ ...base, outcome: 'FAILED', phase: raw.phase as AgentHostPreCompleteFailedAuditV1['phase'] })
  }
  if (!hasCompletion) fail('audit.completionDigest')
  const completionDigest = digest(raw.completionDigest, 'audit.completionDigest')
  if (raw.outcome === 'COMPLETE') {
    if (raw.phase !== 'AUDIT') fail('audit.phase')
    return Object.freeze({ ...base, outcome: 'COMPLETE', phase: 'AUDIT', completionDigest })
  }
  if (raw.outcome !== 'RECOVERY_REQUIRED') fail('audit.outcome')
  if (!RECOVERY_PHASES.includes(raw.phase as typeof RECOVERY_PHASES[number])) fail('audit.phase')
  return Object.freeze({ ...base, outcome: 'RECOVERY_REQUIRED', phase: raw.phase as AgentHostRecoveryAuditV1['phase'], completionDigest })
}

export function isAgentHostTerminalAuditFor(
  record: AgentHostAuditRecordV1,
  active: AgentHostActiveEnvelopeV1,
  complete: AgentHostCompleteEnvelopeV1,
): boolean {
  return record.outcome !== 'FAILED' &&
    record.revisionId === active.revisionId &&
    record.desiredStateDigest === active.desiredStateDigest &&
    complete.revisionId === active.revisionId &&
    complete.desiredStateDigest === active.desiredStateDigest &&
    record.completionDigest === complete.completionDigest
}
