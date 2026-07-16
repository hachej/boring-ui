import { isIP } from 'node:net'
import { OpaqueRefSchema, type Sha256Digest } from '@hachej/boring-agent/shared'

export const AgentHostErrorCode = {
  PLAN_INVALID: 'AGENT_HOST_PLAN_INVALID',
  REQUIREMENT_UNSATISFIED: 'AGENT_COMPOSITION_REQUIREMENT_UNSATISFIED',
  REVISION_CONFLICT: 'AGENT_HOST_REVISION_CONFLICT',
  DESTRUCTIVE_CONFIRMATION_REQUIRED: 'AGENT_HOST_DESTRUCTIVE_CONFIRMATION_REQUIRED',
  BINDING_ADMITTED: 'AGENT_HOST_BINDING_ADMITTED',
  ACTIVE_BINDING_RESTART_REQUIRED: 'AGENT_HOST_ACTIVE_BINDING_RESTART_REQUIRED',
  SECRET_UNAVAILABLE: 'AGENT_HOST_SECRET_UNAVAILABLE',
  COLLECTION_LIMIT_EXCEEDED: 'AGENT_HOST_COLLECTION_LIMIT_EXCEEDED',
  COLLECTION_NOT_READY: 'AGENT_HOST_COLLECTION_NOT_READY',
  PUBLICATION_FAILED: 'AGENT_HOST_PUBLICATION_FAILED',
  ROLLBACK_TARGET_INVALID: 'AGENT_HOST_ROLLBACK_TARGET_INVALID',
  HOST_SCOPE_VIOLATION: 'AGENT_HOST_SCOPE_VIOLATION',
  ADMISSION_IDENTITY_MISMATCH: 'AGENT_HOST_ADMISSION_IDENTITY_MISMATCH',
  ADMISSION_RECORD_FAILED: 'AGENT_HOST_ADMISSION_RECORD_FAILED',
  ROLLBACK_JOURNAL_FAILED: 'AGENT_HOST_ROLLBACK_JOURNAL_FAILED',
  PROOF_INVALID: 'AGENT_HOST_PROOF_INVALID',
} as const

export type AgentHostErrorCode = typeof AgentHostErrorCode[keyof typeof AgentHostErrorCode]

export class AgentHostError extends Error {
  readonly details: Readonly<Record<string, string>>

  constructor(readonly code: AgentHostErrorCode, details: Record<string, string>) {
    super(code)
    this.name = 'AgentHostError'
    this.details = Object.freeze({ ...details })
  }
}

export interface AgentHostSiteBindingV1 {
  readonly bindingId: string
  readonly hostname: string
  readonly workspaceId: string
  readonly defaultDeploymentId: string
  readonly bundleRef: string
  readonly deploymentRef: string
  readonly workspaceAllocationRef: string
  readonly sessionAllocationRef: string
  readonly ownerPrincipalRef: string
  readonly landing: Readonly<{ title: string; summary: string; ctaLabel?: string }>
  readonly environmentRef: string
  readonly secretRefs: readonly string[]
}

export interface AgentHostPlanV1 {
  readonly schemaVersion: 1
  readonly hostId: string
  readonly expectedHostRevision: string | null
  readonly hostAppImageDigest: Sha256Digest
  readonly runtimeProfileRef: string
  readonly databaseRef: string
  readonly workspaceRootPolicyRef: string
  readonly sessionRootPolicyRef: string
  readonly bindings: readonly AgentHostSiteBindingV1[]
}

const PLAN_KEYS = ['schemaVersion', 'hostId', 'expectedHostRevision', 'hostAppImageDigest', 'runtimeProfileRef', 'databaseRef', 'workspaceRootPolicyRef', 'sessionRootPolicyRef', 'bindings'] as const
const BINDING_KEYS = ['bindingId', 'hostname', 'workspaceId', 'defaultDeploymentId', 'bundleRef', 'deploymentRef', 'workspaceAllocationRef', 'sessionAllocationRef', 'ownerPrincipalRef', 'landing', 'environmentRef', 'secretRefs'] as const
const LANDING_KEYS = ['title', 'summary', 'ctaLabel'] as const
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,255}$/
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const LEGACY_IPV4_COMPONENT_RE = /^(?:0x[0-9a-f]+|0[0-7]*|[1-9][0-9]*)$/

export function invalidAgentHostField(field: string): never {
  throw new AgentHostError(AgentHostErrorCode.PLAN_INVALID, { field })
}

export function assertAgentHostRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidAgentHostField(field)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) invalidAgentHostField(field)
}

export function assertAgentHostExactKeys(value: unknown, keys: readonly string[], field: string, optional: readonly string[] = []): asserts value is Record<string, unknown> {
  assertAgentHostRecord(value, field)
  const allowed = new Set(keys)
  const unexpected = Object.keys(value).find((key) => !allowed.has(key))
  if (unexpected) invalidAgentHostField(field ? `${field}.${unexpected}` : unexpected)
  const missing = keys.find((key) => !optional.includes(key) && !Object.hasOwn(value, key))
  if (missing) invalidAgentHostField(field ? `${field}.${missing}` : missing)
}

export function strictAgentHostRef(value: unknown, field: string): string {
  if (typeof value !== 'string' || !REF_RE.test(value)) invalidAgentHostField(field)
  return value
}

export function strictAgentHostId(value: unknown, field: string): string {
  const hostId = strictAgentHostRef(value, field)
  if (hostId.length > 250) invalidAgentHostField(field)
  return hostId
}

export function strictAgentHostname(value: unknown, field: string): string {
  if (typeof value !== 'string' || !HOST_RE.test(value)) invalidAgentHostField(field)
  const parts = value.split('.')
  const isLegacyIpv4 = parts.length <= 4 && parts.every((part) => LEGACY_IPV4_COMPONENT_RE.test(part))
  if (isIP(value) !== 0 || isLegacyIpv4) invalidAgentHostField(field)
  return value
}

function agentRef(value: unknown, field: string): string {
  const parsed = OpaqueRefSchema.safeParse(value)
  if (!parsed.success) invalidAgentHostField(field)
  return parsed.data
}

export function agentHostDigest(value: unknown, field: string): Sha256Digest {
  if (typeof value !== 'string' || !DIGEST_RE.test(value)) invalidAgentHostField(field)
  return value as Sha256Digest
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\0-\x1f\x7f]/.test(value)) invalidAgentHostField(field)
  return value
}

function unique(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) invalidAgentHostField(field)
}

function parseBinding(value: unknown, index: number): AgentHostSiteBindingV1 {
  const field = `bindings[${index}]`
  assertAgentHostExactKeys(value, BINDING_KEYS, field)
  const input = value
  assertAgentHostExactKeys(input.landing, LANDING_KEYS, `${field}.landing`, ['ctaLabel'])
  const landing = input.landing
  if (!Array.isArray(input.secretRefs)) invalidAgentHostField(`${field}.secretRefs`)
  const secretRefs = input.secretRefs.map((value, secretIndex) => strictAgentHostRef(value, `${field}.secretRefs[${secretIndex}]`)).sort()
  unique(secretRefs, `${field}.secretRefs`)
  const hostname = strictAgentHostname(input.hostname, `${field}.hostname`)
  const bindingId = strictAgentHostRef(input.bindingId, `${field}.bindingId`)
  if (bindingId.length > 250) invalidAgentHostField(`${field}.bindingId`)

  return Object.freeze({
    bindingId,
    hostname,
    workspaceId: agentRef(input.workspaceId, `${field}.workspaceId`),
    defaultDeploymentId: agentRef(input.defaultDeploymentId, `${field}.defaultDeploymentId`),
    bundleRef: strictAgentHostRef(input.bundleRef, `${field}.bundleRef`),
    deploymentRef: strictAgentHostRef(input.deploymentRef, `${field}.deploymentRef`),
    workspaceAllocationRef: strictAgentHostRef(input.workspaceAllocationRef, `${field}.workspaceAllocationRef`),
    sessionAllocationRef: strictAgentHostRef(input.sessionAllocationRef, `${field}.sessionAllocationRef`),
    ownerPrincipalRef: strictAgentHostRef(input.ownerPrincipalRef, `${field}.ownerPrincipalRef`),
    landing: Object.freeze({
      title: text(landing.title, `${field}.landing.title`, 120),
      summary: text(landing.summary, `${field}.landing.summary`, 500),
      ...(landing.ctaLabel === undefined ? {} : { ctaLabel: text(landing.ctaLabel, `${field}.landing.ctaLabel`, 80) }),
    }),
    environmentRef: strictAgentHostRef(input.environmentRef, `${field}.environmentRef`),
    secretRefs: Object.freeze(secretRefs),
  })
}

export function parseAgentHostPlan(raw: unknown): AgentHostPlanV1 {
  assertAgentHostExactKeys(raw, PLAN_KEYS, '')
  const input = raw
  if (input.schemaVersion !== 1) invalidAgentHostField('schemaVersion')
  if (input.expectedHostRevision !== null) strictAgentHostRef(input.expectedHostRevision, 'expectedHostRevision')
  const hostAppImageDigest = agentHostDigest(input.hostAppImageDigest, 'hostAppImageDigest')
  if (!Array.isArray(input.bindings) || input.bindings.length === 0) invalidAgentHostField('bindings')
  const bindings = input.bindings.map(parseBinding).sort((left, right) => left.bindingId < right.bindingId ? -1 : left.bindingId > right.bindingId ? 1 : 0)
  for (const [field, values] of [
    ['bindings.bindingId', bindings.map((binding) => binding.bindingId)],
    ['bindings.hostname', bindings.map((binding) => binding.hostname)],
    ['bindings.workspaceId', bindings.map((binding) => binding.workspaceId)],
    ['bindings.defaultDeploymentId', bindings.map((binding) => binding.defaultDeploymentId)],
    ['bindings.workspaceAllocationRef', bindings.map((binding) => binding.workspaceAllocationRef)],
    ['bindings.sessionAllocationRef', bindings.map((binding) => binding.sessionAllocationRef)],
  ] as const) unique(values, field)

  return Object.freeze({
    schemaVersion: 1,
    hostId: strictAgentHostId(input.hostId, 'hostId'),
    expectedHostRevision: input.expectedHostRevision as string | null,
    hostAppImageDigest,
    runtimeProfileRef: strictAgentHostRef(input.runtimeProfileRef, 'runtimeProfileRef'),
    databaseRef: strictAgentHostRef(input.databaseRef, 'databaseRef'),
    workspaceRootPolicyRef: strictAgentHostRef(input.workspaceRootPolicyRef, 'workspaceRootPolicyRef'),
    sessionRootPolicyRef: strictAgentHostRef(input.sessionRootPolicyRef, 'sessionRootPolicyRef'),
    bindings: Object.freeze(bindings),
  })
}
