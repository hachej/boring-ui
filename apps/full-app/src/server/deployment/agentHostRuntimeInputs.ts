import { createAgentAssetDigest, type Sha256Digest } from '@hachej/boring-agent/shared'

import { assertAgentHostExactKeys as exactKeys, agentHostDigest as digest, invalidAgentHostField as fail, strictAgentHostRef as ref, type AgentHostSiteBindingV1 } from './agentHostPlan.js'

export interface AgentHostRuntimeInputsAttestationV1 {
  /** Redacted immutable environment-resolution metadata; never paths or values. */
  readonly environment: Readonly<{ versionFingerprint: Sha256Digest }>
  /** Redacted immutable allocation-resolution metadata; never paths or handles. */
  readonly workspaceAllocation: Readonly<{ versionFingerprint: Sha256Digest }>
  readonly sessionAllocation: Readonly<{ versionFingerprint: Sha256Digest }>
  /** Provider version metadata only; implementations must never hash secret bytes. */
  readonly secrets: readonly Readonly<{ secretRef: string; providerVersionFingerprint: Sha256Digest }>[]
}

export interface AgentHostRuntimeInputsIdentityV1 {
  readonly schemaVersion: 1
  readonly domain: 'boring-agent-host-runtime-inputs:v1'
  readonly bindingId: string
  readonly environment: Readonly<{ ref: string; versionFingerprint: Sha256Digest }>
  readonly workspaceAllocation: Readonly<{ ref: string; versionFingerprint: Sha256Digest }>
  readonly sessionAllocation: Readonly<{ ref: string; versionFingerprint: Sha256Digest }>
  /** Fingerprints attest provider version metadata only, never secret bytes. */
  readonly secrets: readonly Readonly<{ secretRef: string; providerVersionFingerprint: Sha256Digest }>[]
  readonly digest: Sha256Digest
}

const DOMAIN = 'boring-agent-host-runtime-inputs:v1' as const

function sortedSecrets(raw: unknown, field: string) {
  if (!Array.isArray(raw)) fail(field)
  const secrets = raw.map((secret, index) => {
    const secretField = `${field}[${index}]`
    exactKeys(secret, ['secretRef', 'providerVersionFingerprint'], secretField)
    return Object.freeze({
      secretRef: ref(secret.secretRef, `${secretField}.secretRef`),
      providerVersionFingerprint: digest(secret.providerVersionFingerprint, `${secretField}.providerVersionFingerprint`),
    })
  }).sort((left, right) => left.secretRef < right.secretRef ? -1 : left.secretRef > right.secretRef ? 1 : 0)
  if (new Set(secrets.map((secret) => secret.secretRef)).size !== secrets.length) fail(field)
  return Object.freeze(secrets)
}

function fingerprint(raw: unknown, field: string): Sha256Digest {
  exactKeys(raw, ['versionFingerprint'], field)
  return digest(raw.versionFingerprint, `${field}.versionFingerprint`)
}

function linkedFingerprint(raw: unknown, field: string, desiredRef: string): Sha256Digest {
  exactKeys(raw, ['ref', 'versionFingerprint'], field)
  if (ref(raw.ref, `${field}.ref`) !== desiredRef) fail(`${field}.ref`)
  return digest(raw.versionFingerprint, `${field}.versionFingerprint`)
}

function parseAttestation(raw: unknown, desired: AgentHostSiteBindingV1): AgentHostRuntimeInputsAttestationV1 {
  exactKeys(raw, ['environment', 'workspaceAllocation', 'sessionAllocation', 'secrets'], 'runtimeInputsAttestation')
  const secrets = sortedSecrets(raw.secrets, 'runtimeInputsAttestation.secrets')
  if (JSON.stringify(secrets.map((secret) => secret.secretRef)) !== JSON.stringify(desired.secretRefs)) fail('runtimeInputsAttestation.secrets')
  return Object.freeze({
    environment: Object.freeze({ versionFingerprint: fingerprint(raw.environment, 'runtimeInputsAttestation.environment') }),
    workspaceAllocation: Object.freeze({ versionFingerprint: fingerprint(raw.workspaceAllocation, 'runtimeInputsAttestation.workspaceAllocation') }),
    sessionAllocation: Object.freeze({ versionFingerprint: fingerprint(raw.sessionAllocation, 'runtimeInputsAttestation.sessionAllocation') }),
    secrets,
  })
}

export async function createAgentHostRuntimeInputsIdentity(
  desired: AgentHostSiteBindingV1,
  rawAttestation: AgentHostRuntimeInputsAttestationV1,
): Promise<AgentHostRuntimeInputsIdentityV1> {
  const attestation = parseAttestation(rawAttestation, desired)
  const projection = Object.freeze({
    schemaVersion: 1 as const,
    domain: DOMAIN,
    bindingId: desired.bindingId,
    environment: Object.freeze({ ref: desired.environmentRef, versionFingerprint: attestation.environment.versionFingerprint }),
    workspaceAllocation: Object.freeze({ ref: desired.workspaceAllocationRef, versionFingerprint: attestation.workspaceAllocation.versionFingerprint }),
    sessionAllocation: Object.freeze({ ref: desired.sessionAllocationRef, versionFingerprint: attestation.sessionAllocation.versionFingerprint }),
    secrets: attestation.secrets,
  })
  const aggregate = await createAgentAssetDigest(JSON.stringify(projection))
  return Object.freeze({ ...projection, digest: aggregate })
}

export async function canonicalizeAgentHostRuntimeInputsIdentity(raw: unknown, desired: AgentHostSiteBindingV1): Promise<AgentHostRuntimeInputsIdentityV1> {
  exactKeys(raw, ['schemaVersion', 'domain', 'bindingId', 'environment', 'workspaceAllocation', 'sessionAllocation', 'secrets', 'digest'], 'runtimeInputs')
  if (raw.schemaVersion !== 1 || raw.domain !== DOMAIN || ref(raw.bindingId, 'runtimeInputs.bindingId') !== desired.bindingId) fail('runtimeInputs.bindingId')
  const environmentVersionFingerprint = linkedFingerprint(raw.environment, 'runtimeInputs.environment', desired.environmentRef)
  const workspaceVersionFingerprint = linkedFingerprint(raw.workspaceAllocation, 'runtimeInputs.workspaceAllocation', desired.workspaceAllocationRef)
  const sessionVersionFingerprint = linkedFingerprint(raw.sessionAllocation, 'runtimeInputs.sessionAllocation', desired.sessionAllocationRef)
  const secrets = sortedSecrets(raw.secrets, 'runtimeInputs.secrets')
  const expected = await createAgentHostRuntimeInputsIdentity(desired, {
    environment: { versionFingerprint: environmentVersionFingerprint },
    workspaceAllocation: { versionFingerprint: workspaceVersionFingerprint },
    sessionAllocation: { versionFingerprint: sessionVersionFingerprint },
    secrets,
  })
  if (digest(raw.digest, 'runtimeInputs.digest') !== expected.digest) fail('runtimeInputs.digest')
  return expected
}
