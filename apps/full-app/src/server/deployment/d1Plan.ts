import { OpaqueRefSchema, type Sha256Digest } from '@hachej/boring-agent/shared'

export const D1HostErrorCode = {
  PLAN_INVALID: 'D1_PLAN_INVALID',
  REQUIREMENT_UNSATISFIED: 'AGENT_COMPOSITION_REQUIREMENT_UNSATISFIED',
  REVISION_CONFLICT: 'D1_REVISION_CONFLICT',
  DESTRUCTIVE_CONFIRMATION_REQUIRED: 'D1_DESTRUCTIVE_CONFIRMATION_REQUIRED',
  COLLECTION_NOT_READY: 'D1_COLLECTION_NOT_READY',
  PUBLICATION_FAILED: 'D1_PUBLICATION_FAILED',
  ROLLBACK_TARGET_INVALID: 'D1_ROLLBACK_TARGET_INVALID',
} as const

export type D1HostErrorCode = typeof D1HostErrorCode[keyof typeof D1HostErrorCode]

export class D1HostError extends Error {
  readonly details: Readonly<Record<string, string>>

  constructor(readonly code: D1HostErrorCode, details: Record<string, string>) {
    super(code)
    this.name = 'D1HostError'
    this.details = Object.freeze({ ...details })
  }
}

export interface D1SiteBindingV1 {
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

export interface D1HostPlanV1 {
  readonly schemaVersion: 1
  readonly hostId: string
  readonly expectedHostRevision: string | null
  readonly hostAppImageDigest: Sha256Digest
  readonly runtimeProfileRef: string
  readonly databaseRef: string
  readonly workspaceRootPolicyRef: string
  readonly sessionRootPolicyRef: string
  readonly bindings: readonly D1SiteBindingV1[]
}

const PLAN_KEYS = ['schemaVersion', 'hostId', 'expectedHostRevision', 'hostAppImageDigest', 'runtimeProfileRef', 'databaseRef', 'workspaceRootPolicyRef', 'sessionRootPolicyRef', 'bindings'] as const
const BINDING_KEYS = ['bindingId', 'hostname', 'workspaceId', 'defaultDeploymentId', 'bundleRef', 'deploymentRef', 'workspaceAllocationRef', 'sessionAllocationRef', 'ownerPrincipalRef', 'landing', 'environmentRef', 'secretRefs'] as const
const LANDING_KEYS = ['title', 'summary', 'ctaLabel'] as const
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,255}$/
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export function invalidD1Field(field: string): never {
  throw new D1HostError(D1HostErrorCode.PLAN_INVALID, { field })
}

export function assertD1Record(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidD1Field(field)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) invalidD1Field(field)
}

export function assertD1ExactKeys(value: unknown, keys: readonly string[], field: string, optional: readonly string[] = []): asserts value is Record<string, unknown> {
  assertD1Record(value, field)
  const allowed = new Set(keys)
  const unexpected = Object.keys(value).find((key) => !allowed.has(key))
  if (unexpected) invalidD1Field(field ? `${field}.${unexpected}` : unexpected)
  const missing = keys.find((key) => !optional.includes(key) && !Object.hasOwn(value, key))
  if (missing) invalidD1Field(field ? `${field}.${missing}` : missing)
}

export function strictD1Ref(value: unknown, field: string): string {
  if (typeof value !== 'string' || !REF_RE.test(value)) invalidD1Field(field)
  return value
}

function agentRef(value: unknown, field: string): string {
  const parsed = OpaqueRefSchema.safeParse(value)
  if (!parsed.success) invalidD1Field(field)
  return parsed.data
}

export function d1Digest(value: unknown, field: string): Sha256Digest {
  if (typeof value !== 'string' || !DIGEST_RE.test(value)) invalidD1Field(field)
  return value as Sha256Digest
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\0-\x1f\x7f]/.test(value)) invalidD1Field(field)
  return value
}

function unique(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) invalidD1Field(field)
}

function parseBinding(value: unknown, index: number): D1SiteBindingV1 {
  const field = `bindings[${index}]`
  assertD1ExactKeys(value, BINDING_KEYS, field)
  const input = value
  assertD1ExactKeys(input.landing, LANDING_KEYS, `${field}.landing`, ['ctaLabel'])
  const landing = input.landing
  if (!Array.isArray(input.secretRefs)) invalidD1Field(`${field}.secretRefs`)
  const secretRefs = input.secretRefs.map((value, secretIndex) => strictD1Ref(value, `${field}.secretRefs[${secretIndex}]`)).sort()
  unique(secretRefs, `${field}.secretRefs`)
  if (typeof input.hostname !== 'string' || !HOST_RE.test(input.hostname)) invalidD1Field(`${field}.hostname`)

  return Object.freeze({
    bindingId: strictD1Ref(input.bindingId, `${field}.bindingId`),
    hostname: input.hostname,
    workspaceId: agentRef(input.workspaceId, `${field}.workspaceId`),
    defaultDeploymentId: agentRef(input.defaultDeploymentId, `${field}.defaultDeploymentId`),
    bundleRef: strictD1Ref(input.bundleRef, `${field}.bundleRef`),
    deploymentRef: strictD1Ref(input.deploymentRef, `${field}.deploymentRef`),
    workspaceAllocationRef: strictD1Ref(input.workspaceAllocationRef, `${field}.workspaceAllocationRef`),
    sessionAllocationRef: strictD1Ref(input.sessionAllocationRef, `${field}.sessionAllocationRef`),
    ownerPrincipalRef: strictD1Ref(input.ownerPrincipalRef, `${field}.ownerPrincipalRef`),
    landing: Object.freeze({
      title: text(landing.title, `${field}.landing.title`, 120),
      summary: text(landing.summary, `${field}.landing.summary`, 500),
      ...(landing.ctaLabel === undefined ? {} : { ctaLabel: text(landing.ctaLabel, `${field}.landing.ctaLabel`, 80) }),
    }),
    environmentRef: strictD1Ref(input.environmentRef, `${field}.environmentRef`),
    secretRefs: Object.freeze(secretRefs),
  })
}

export function parseD1HostPlan(raw: unknown): D1HostPlanV1 {
  assertD1ExactKeys(raw, PLAN_KEYS, '')
  const input = raw
  if (input.schemaVersion !== 1) invalidD1Field('schemaVersion')
  if (input.expectedHostRevision !== null) strictD1Ref(input.expectedHostRevision, 'expectedHostRevision')
  const hostAppImageDigest = d1Digest(input.hostAppImageDigest, 'hostAppImageDigest')
  if (!Array.isArray(input.bindings) || input.bindings.length === 0) invalidD1Field('bindings')
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
    hostId: strictD1Ref(input.hostId, 'hostId'),
    expectedHostRevision: input.expectedHostRevision as string | null,
    hostAppImageDigest,
    runtimeProfileRef: strictD1Ref(input.runtimeProfileRef, 'runtimeProfileRef'),
    databaseRef: strictD1Ref(input.databaseRef, 'databaseRef'),
    workspaceRootPolicyRef: strictD1Ref(input.workspaceRootPolicyRef, 'workspaceRootPolicyRef'),
    sessionRootPolicyRef: strictD1Ref(input.sessionRootPolicyRef, 'sessionRootPolicyRef'),
    bindings: Object.freeze(bindings),
  })
}
