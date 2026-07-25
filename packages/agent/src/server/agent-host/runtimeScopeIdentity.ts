import { createHash } from 'node:crypto'
import type { JsonValue } from '../../shared/index'

export interface RuntimeScopeIdentityInput {
  readonly artifacts: readonly {
    readonly pluginId: string
    readonly digest: string
  }[]
  readonly validatedConfig: JsonValue
  readonly grants: readonly string[]
  readonly placementIdentity: string
  readonly isolationMode: string
  readonly toolContractDigests: readonly string[]
  readonly provisioningGeneration: string
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
  return digest({
    artifacts: [...input.artifacts]
      .map((artifact) => ({ pluginId: artifact.pluginId, digest: artifact.digest }))
      .sort((a, b) => a.pluginId.localeCompare(b.pluginId) || a.digest.localeCompare(b.digest)),
    validatedConfig: input.validatedConfig,
    grants: [...input.grants].sort(),
    placementIdentity: input.placementIdentity,
    isolationMode: input.isolationMode,
    toolContractDigests: [...input.toolContractDigests].sort(),
    provisioningGeneration: input.provisioningGeneration,
    ...(input.bindingInputs === undefined ? {} : { bindingInputs: input.bindingInputs }),
  })
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
