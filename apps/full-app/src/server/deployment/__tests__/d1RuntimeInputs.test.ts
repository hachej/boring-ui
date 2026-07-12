import { createAgentAssetDigest, type Sha256Digest } from '@hachej/boring-agent/shared'
import { describe, expect, it } from 'vitest'

import { D1HostErrorCode, type D1SiteBindingV1 } from '../d1Plan.js'
import {
  canonicalizeD1RuntimeInputsIdentity,
  createD1RuntimeInputsIdentity,
  type D1RuntimeInputsAttestationV1,
} from '../d1RuntimeInputs.js'

const digest = (value: string): Sha256Digest => `sha256:${value.repeat(64).slice(0, 64)}`
const desired: D1SiteBindingV1 = Object.freeze({
  bindingId: 'insurance', hostname: 'insurance.example.test', workspaceId: 'workspace:insurance',
  defaultDeploymentId: 'deployment:insurance', bundleRef: 'bundle', deploymentRef: 'deployment',
  workspaceAllocationRef: 'workspace-allocation', sessionAllocationRef: 'session-allocation', ownerPrincipalRef: 'owner',
  landing: Object.freeze({ title: 'Insurance', summary: 'Compare policies.' }), environmentRef: 'production',
  secretRefs: Object.freeze(['credential-a', 'credential-z']),
})

function attestation(reverse = false): D1RuntimeInputsAttestationV1 {
  const secrets = [
    { secretRef: 'credential-a', providerVersionFingerprint: digest('4') },
    { secretRef: 'credential-z', providerVersionFingerprint: digest('5') },
  ]
  return {
    environment: { versionFingerprint: digest('1') },
    workspaceAllocation: { versionFingerprint: digest('2') },
    sessionAllocation: { versionFingerprint: digest('3') },
    secrets: reverse ? secrets.reverse() : secrets,
  }
}

describe('D1 runtime input identity', () => {
  it('constructs a deterministic, sorted, deeply frozen, redacted identity', async () => {
    const first = await createD1RuntimeInputsIdentity(desired, attestation(true))
    const second = await createD1RuntimeInputsIdentity(desired, attestation())
    expect(first).toEqual(second)
    expect(first).toMatchObject({
      schemaVersion: 1, domain: 'boring-d1-runtime-inputs:v1', bindingId: 'insurance',
      environment: { ref: 'production' }, workspaceAllocation: { ref: 'workspace-allocation' },
      sessionAllocation: { ref: 'session-allocation' }, secrets: [{ secretRef: 'credential-a' }, { secretRef: 'credential-z' }],
    })
    expect(first.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.environment)).toBe(true)
    expect(Object.isFrozen(first.secrets)).toBe(true)
    expect(Object.isFrozen(first.secrets[0])).toBe(true)
    expect(JSON.stringify(first)).not.toMatch(/secret-value|\/srv\/private|runtimeHandle|rawVersion/)
  })

  it('domain-separates the aggregate and makes every fingerprint projection digest-sensitive', async () => {
    const base = await createD1RuntimeInputsIdentity(desired, attestation())
    const { digest: _aggregate, ...projection } = base
    expect(await createAgentAssetDigest(JSON.stringify({ ...projection, domain: 'boring-d1-runtime-inputs:v2' }))).not.toBe(base.digest)
    const changes: D1RuntimeInputsAttestationV1[] = [
      { ...attestation(), environment: { versionFingerprint: digest('6') } },
      { ...attestation(), workspaceAllocation: { versionFingerprint: digest('6') } },
      { ...attestation(), sessionAllocation: { versionFingerprint: digest('6') } },
      { ...attestation(), secrets: attestation().secrets.map((secret, index) => index === 0 ? { ...secret, providerVersionFingerprint: digest('6') } : secret) },
    ]
    for (const changed of changes) expect((await createD1RuntimeInputsIdentity(desired, changed)).digest).not.toBe(base.digest)
  })

  it('recomputes persisted aggregates and crosslinks every desired ref', async () => {
    const identity = await createD1RuntimeInputsIdentity(desired, attestation())
    await expect(canonicalizeD1RuntimeInputsIdentity({ ...identity, digest: digest('9') }, desired))
      .rejects.toMatchObject({ details: { field: 'runtimeInputs.digest' } })
    for (const changed of [
      { ...identity, bindingId: 'travel' },
      { ...identity, environment: { ...identity.environment, ref: 'staging' } },
      { ...identity, workspaceAllocation: { ...identity.workspaceAllocation, ref: 'workspace-other' } },
      { ...identity, sessionAllocation: { ...identity.sessionAllocation, ref: 'session-other' } },
      { ...identity, secrets: identity.secrets.map((secret, index) => index === 0 ? { ...secret, secretRef: 'credential-other' } : secret) },
    ]) await expect(canonicalizeD1RuntimeInputsIdentity(changed, desired)).rejects.toMatchObject({ code: D1HostErrorCode.PLAN_INVALID })
  })

  it('rejects duplicate, missing, extra, raw, path, value, and handle attestation data', async () => {
    const base = attestation()
    for (const secrets of [
      base.secrets.slice(1),
      [...base.secrets, { secretRef: 'credential-extra', providerVersionFingerprint: digest('6') }],
      [base.secrets[0], base.secrets[0]],
    ]) await expect(createD1RuntimeInputsIdentity(desired, { ...base, secrets })).rejects.toMatchObject({ code: D1HostErrorCode.PLAN_INVALID })
    for (const invalid of [
      { ...base, rawValue: 'secret-value' },
      { ...base, environment: { ...base.environment, path: '/srv/private' } },
      { ...base, workspaceAllocation: { ...base.workspaceAllocation, runtimeHandle: 'handle-1' } },
      { ...base, secrets: base.secrets.map((secret, index) => index === 0 ? { ...secret, rawVersion: 'v17' } : secret) },
      { ...base, secrets: base.secrets.map((secret, index) => index === 0 ? { ...secret, value: 'secret-value' } : secret) },
    ]) await expect(createD1RuntimeInputsIdentity(desired, invalid)).rejects.toMatchObject({ code: D1HostErrorCode.PLAN_INVALID })
  })
})
