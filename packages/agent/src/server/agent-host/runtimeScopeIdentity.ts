import { createHash } from 'node:crypto'
import type { JsonValue } from '../../shared/index'

export interface RuntimeScopeIdentityInput {
  readonly artifacts: readonly {
    readonly pluginId: string
    readonly digest: string
  }[]
  readonly validatedConfig: JsonValue
  readonly grants: readonly string[]
  /** Stable semantic placement class; never an absolute root or lease key. */
  readonly placementClassIdentity?: string
  /** @deprecated v1 compatibility input. */
  readonly placementIdentity?: string
  readonly isolationMode: string
  readonly toolContractDigests: readonly string[]
  /** Stable semantic provisioning identity. */
  readonly provisioningIdentity?: string
  /** @deprecated v1 compatibility input. */
  readonly provisioningGeneration?: string
  readonly bindingInputs?: JsonValue
}

export interface EnvironmentProvisioningIdentityInput {
  readonly placementIdentity: string
  readonly providerDigest: string
  readonly provisioningArtifactDigests: readonly string[]
  readonly provisioningGeneration: string
  readonly templateDigest?: string
}

/** Canonical JSON projection used only for app-resolved identity material. */
function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson((value as Readonly<Record<string, JsonValue>>)[key]!)}`
  )).join(',')}}`
}

function digest(value: JsonValue): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

/**
 * Produces the complete Agent-binding identity. Grants intentionally
 * participate here even though they do not participate in Environment
 * provisioning identity.
 */
export function createResolvedRuntimeScopeIdentity(
  input: RuntimeScopeIdentityInput,
): string {
  const placementClassIdentity = input.placementClassIdentity ?? input.placementIdentity
  const provisioningIdentity = input.provisioningIdentity ?? input.provisioningGeneration
  if (!placementClassIdentity || !provisioningIdentity) {
    throw new Error('runtime scope identity requires stable placement and provisioning identities')
  }
  return digest({
    schemaVersion: 2,
    artifacts: normalizedArtifacts(input),
    validatedConfig: input.validatedConfig,
    grants: [...input.grants].sort(),
    placementClassIdentity,
    isolationMode: input.isolationMode,
    toolContractDigests: [...input.toolContractDigests].sort(),
    provisioningIdentity,
    ...(input.bindingInputs === undefined ? {} : { bindingInputs: input.bindingInputs }),
  })
}

/** Server-side reconstruction helper for exact, evidence-backed v1 migrations. */
export function createLegacyRuntimeScopeIdentityV1(input: RuntimeScopeIdentityInput): string {
  const placementIdentity = input.placementIdentity ?? input.placementClassIdentity
  const provisioningGeneration = input.provisioningGeneration ?? input.provisioningIdentity
  if (!placementIdentity || !provisioningGeneration) {
    throw new Error('legacy runtime scope identity requires placement and provisioning identities')
  }
  return digest({
    artifacts: normalizedArtifacts(input),
    validatedConfig: input.validatedConfig,
    grants: [...input.grants].sort(),
    placementIdentity,
    isolationMode: input.isolationMode,
    toolContractDigests: [...input.toolContractDigests].sort(),
    provisioningGeneration,
    ...(input.bindingInputs === undefined ? {} : { bindingInputs: input.bindingInputs }),
  })
}

export function createRuntimeScopeIdentityDiagnostic(input: RuntimeScopeIdentityInput): {
  readonly legacyV1Identity: string
  readonly semanticV2Identity: string
} {
  return {
    legacyV1Identity: createLegacyRuntimeScopeIdentityV1(input),
    semanticV2Identity: createResolvedRuntimeScopeIdentity(input),
  }
}

function normalizedArtifacts(input: RuntimeScopeIdentityInput) {
  return [...input.artifacts]
    .map((artifact) => ({ pluginId: artifact.pluginId, digest: artifact.digest }))
    .sort((a, b) => a.pluginId.localeCompare(b.pluginId) || a.digest.localeCompare(b.digest))
}

/**
 * Produces only the Environment-mutating identity. Contribution grants and
 * tool contracts are deliberately absent, so grant-only changes share the
 * same canonical Environment lease.
 */
export function createEnvironmentProvisioningFingerprint(
  input: EnvironmentProvisioningIdentityInput,
): string {
  return digest({
    placementIdentity: input.placementIdentity,
    providerDigest: input.providerDigest,
    provisioningArtifactDigests: [...input.provisioningArtifactDigests].sort(),
    provisioningGeneration: input.provisioningGeneration,
    ...(input.templateDigest === undefined ? {} : { templateDigest: input.templateDigest }),
  })
}
