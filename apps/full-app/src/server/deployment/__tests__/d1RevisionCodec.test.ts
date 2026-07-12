import {
  createAgentAssetDigest,
  createAgentDeploymentDigest,
  type Sha256Digest,
} from '@hachej/boring-agent/shared'
import { createResolvedAgentDigest } from '@hachej/boring-agent/server'
import { describe, expect, it } from 'vitest'

import { D1HostErrorCode } from '../d1Plan.js'
import {
  canonicalizeD1ActiveEnvelope,
  canonicalizeD1AuditRecord,
  canonicalizeD1CompleteEnvelope,
  canonicalizeD1DesiredSnapshot,
  canonicalizeD1Observation,
  canonicalizeD1SecretRefsEnvelope,
  createD1CompleteEnvelope,
  createD1DesiredSnapshot,
  deriveD1SecretRefsEnvelope,
  digestD1Desired,
  digestD1Observation,
  isD1TerminalAuditFor,
  type D1AuditRecordV1,
  type D1DesiredSnapshotV1,
} from '../d1RevisionCodec.js'
import { canonicalizeWorkspaceCompositionSnapshot } from '../workspaceComposition.js'

const digest = (value: string): Sha256Digest => `sha256:${value.repeat(64).slice(0, 64)}`

function plan(ids: string[], expectedHostRevision: string | null = null) {
  return {
    schemaVersion: 1,
    hostId: 'eu-host-1',
    expectedHostRevision,
    hostAppImageDigest: digest('a'),
    runtimeProfileRef: 'runsc-eu',
    databaseRef: 'postgres-eu',
    workspaceRootPolicyRef: 'workspace-roots',
    sessionRootPolicyRef: 'session-roots',
    bindings: ids.map((bindingId) => ({
      bindingId,
      hostname: `${bindingId}.example.test`,
      workspaceId: `espace:éclair-${bindingId}`,
      defaultDeploymentId: `déploiement:${bindingId}`,
      bundleRef: `bundle-${bindingId}`,
      deploymentRef: `deployment-${bindingId}`,
      workspaceAllocationRef: `workspace-${bindingId}`,
      sessionAllocationRef: `session-${bindingId}`,
      ownerPrincipalRef: `owner-${bindingId}`,
      landing: { title: `Agent ${bindingId}`, summary: `Summary ${bindingId}` },
      environmentRef: `environment-${bindingId}`,
      secretRefs: [`credential-${bindingId}`],
    })),
  }
}

function composition(bindingId: string, reverse = false) {
  const snapshot = {
    schemaVersion: 1,
    domain: 'boring-workspace-composition:v1',
    workspaceId: `espace:éclair-${bindingId}`,
    runtimeProfile: {
      ref: 'runsc-eu', id: 'runsc', version: '2026.07.12',
      contentDigest: digest('b'), isolationAttestationDigest: digest('c'),
      workspaceRootPolicyRef: 'workspace-roots', sessionRootPolicyRef: 'session-roots',
    },
    hostAppImageDigest: digest('a'),
    serverPlugins: [
      { id: 'plugin-a', version: '1.0.0', contentDigest: digest('d') },
      { id: 'plugin-b', version: '1.0.0', contentDigest: digest('e') },
    ],
    defaultPluginPackages: [{ id: 'automation', version: '1.0.0', contentDigest: digest('f') }],
    staticSystemPromptDigest: digest('1'),
    inventories: { capabilities: ['filesystem:read', 'filesystem:write'], tools: ['quotes.compare'], skills: null, mcpServers: null },
    provisioning: [{ id: 'python', version: '3.13', contentDigest: digest('2') }],
    filesystemBindings: [
      { id: 'company', access: 'readonly', policy: 'filtered' },
      { id: 'user', access: 'readwrite', policy: 'workspace-only' },
    ],
    policies: { externalPlugins: false, pluginAuthoring: false },
  }
  if (reverse) {
    snapshot.serverPlugins.reverse()
    snapshot.inventories.capabilities.reverse()
    snapshot.filesystemBindings.reverse()
  }
  return snapshot
}

async function resolved(bindingId: string, reverse = false) {
  const snapshot = canonicalizeWorkspaceCompositionSnapshot(composition(bindingId, reverse))
  const compositionDigest = await createAgentAssetDigest(JSON.stringify(snapshot))
  const definition = {
    definitionId: `assurance:éclair-${bindingId}`,
    version: '1.0.0',
    digest: digest('3'),
    instructionsRef: 'instructions.md',
  }
  const deployment = {
    deploymentId: `déploiement:${bindingId}`,
    version: '2026.07.12',
    agentId: 'default',
    definition: { definitionId: definition.definitionId, version: definition.version, digest: definition.digest },
  }
  const deploymentDigest = await createAgentDeploymentDigest(deployment)
  const resolvedDigest = await createResolvedAgentDigest({
    workspaceId: `espace:éclair-${bindingId}`,
    defaultDeploymentId: deployment.deploymentId,
    workspaceCompositionDigest: compositionDigest,
    definitionDigest: definition.digest,
    deploymentDigest,
  })
  return {
    schemaVersion: 1,
    bindingId,
    composition: { snapshot: reverse ? composition(bindingId, true) : snapshot, digest: compositionDigest },
    workspace: { workspaceId: `espace:éclair-${bindingId}`, defaultDeploymentId: deployment.deploymentId, compositionDigest },
    deployment: { deploymentId: deployment.deploymentId, version: deployment.version, agentId: deployment.agentId, digest: deploymentDigest },
    definition,
    resolvedDigest,
  }
}

async function desired(ids = ['a', 'b'], expected: string | null = null, reverse = false) {
  return createD1DesiredSnapshot(plan(ids, expected), await Promise.all(ids.map((id) => resolved(id, reverse))))
}

function observed(value: D1DesiredSnapshotV1, reverse = false, ready = true) {
  const bindings = value.resolvedBindings.map((binding) => ({ bindingId: binding.bindingId, ready, resolvedDigest: binding.resolvedDigest }))
  return { schemaVersion: 1, domain: 'boring-d1-observed:v1', bindings: reverse ? bindings.reverse() : bindings }
}

const operator = { uid: 1000, effectiveUser: 'Julien opérateur', invocationId: 'deploy:2026-07-12', note: 'planned release' }

describe('D1 revision codec', () => {
  it('keeps canonical ordering and desired digests stable while excluding command CAS', async () => {
    const first = await desired(['b', 'a'], null, true)
    const second = await desired(['a', 'b'], 'r0000000042')
    expect(first).toEqual(second)
    expect(await digestD1Desired(first)).toBe(await digestD1Desired(second))
    expect(JSON.stringify(first)).not.toContain('expectedHostRevision')
    expect(first.resolvedBindings.map((binding) => binding.bindingId)).toEqual(['a', 'b'])
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.plan.bindings[0])).toBe(true)
    expect(Object.isFrozen(first.resolvedBindings[0].definition)).toBe(true)
  })

  it('persists composition and exact redacted P6 identities without prompt, path, handle, or secret values', async () => {
    const value = await desired(['a'])
    const serialized = JSON.stringify({ desired: value, secrets: deriveD1SecretRefsEnvelope(value) })
    expect(serialized).toContain('assurance:éclair-a')
    expect(serialized).toContain('instructions.md')
    expect(serialized).toContain('boring-workspace-composition:v1')
    expect(serialized).not.toMatch(/Compare policies|"instructions":|\/srv\/private|secret-value|runtimeHandle/)
    expect(Object.isFrozen(value.resolvedBindings[0].composition.snapshot.runtimeProfile)).toBe(true)
    expect(canonicalizeD1SecretRefsEnvelope(deriveD1SecretRefsEnvelope(value), value))
      .toEqual(deriveD1SecretRefsEnvelope(value))
    expect(() => canonicalizeD1SecretRefsEnvelope({ ...deriveD1SecretRefsEnvelope(value), rawValue: 'secret-value' }, value))
      .toThrow(expect.objectContaining({ details: { field: 'secretRefs.rawValue' } }))
  })

  it('reuses the composition parser and makes its canonical digest sensitive to identity', async () => {
    const first = canonicalizeWorkspaceCompositionSnapshot(composition('a', true))
    const second = canonicalizeWorkspaceCompositionSnapshot(composition('a'))
    expect(first).toEqual(second)
    const changed = canonicalizeWorkspaceCompositionSnapshot({ ...composition('a'), staticSystemPromptDigest: digest('9') })
    expect(await createAgentAssetDigest(JSON.stringify(first))).not.toBe(await createAgentAssetDigest(JSON.stringify(changed)))
  })

  it('recomputes deployment and resolved digests instead of trusting supplied cross-digests', async () => {
    const valid = await desired(['a'])
    const raw = {
      ...valid,
      resolvedBindings: valid.resolvedBindings.map((binding) => ({
        ...binding,
        deployment: { ...binding.deployment, digest: digest('f') },
      })),
    }
    await expect(canonicalizeD1DesiredSnapshot(raw)).rejects.toMatchObject({
      code: D1HostErrorCode.PLAN_INVALID,
      details: { field: 'desired.resolvedBindings[0].deployment.digest' },
    })
    const changedDefinition = {
      ...valid,
      resolvedBindings: valid.resolvedBindings.map((binding) => ({
        ...binding,
        definition: { ...binding.definition, digest: digest('e') },
      })),
    }
    await expect(canonicalizeD1DesiredSnapshot(changedDefinition)).rejects.toMatchObject({ code: D1HostErrorCode.PLAN_INVALID })
    const changedResolved = {
      ...valid,
      resolvedBindings: valid.resolvedBindings.map((binding) => ({ ...binding, resolvedDigest: digest('d') })),
    }
    await expect(canonicalizeD1DesiredSnapshot(changedResolved)).rejects.toMatchObject({
      details: { field: 'desired.resolvedBindings[0].resolvedDigest' },
    })
    const pathBearing = {
      ...valid,
      resolvedBindings: valid.resolvedBindings.map((binding) => ({
        ...binding,
        definition: { ...binding.definition, instructionsRef: '/srv/private/instructions.md' },
      })),
    }
    await expect(canonicalizeD1DesiredSnapshot(pathBearing)).rejects.toMatchObject({
      details: { field: 'desired.resolvedBindings[0].definition.instructionsRef' },
    })
  })

  it('rejects fixed-key extras and observation duplicates while canonicalizing readiness', async () => {
    const value = await desired()
    await expect(canonicalizeD1DesiredSnapshot({ ...value, sourcePath: '/srv/private' }))
      .rejects.toMatchObject({ details: { field: 'desired.sourcePath' } })
    expect(() => canonicalizeD1ActiveEnvelope({ schemaVersion: 1, revisionId: 'r0000000001', desiredStateDigest: digest('a'), completionDigest: digest('b') }))
      .toThrow(expect.objectContaining({ details: { field: 'active.completionDigest' } }))
    expect(canonicalizeD1Observation(observed(value, true), value).bindings.map((binding) => binding.bindingId)).toEqual(['a', 'b'])
    const duplicate = observed(value)
    duplicate.bindings = [duplicate.bindings[0], duplicate.bindings[0]]
    expect(() => canonicalizeD1Observation(duplicate, value)).toThrow(expect.objectContaining({ details: { field: 'observation.bindings' } }))
    await expect(createD1CompleteEnvelope('r0000000001', value, canonicalizeD1Observation(observed(value, false, false), value)))
      .rejects.toMatchObject({ details: { field: 'completion.observation.ready' } })
  })

  it('recomputes completion digests and deeply freezes every resulting envelope', async () => {
    const value = await desired(['a'])
    const observation = canonicalizeD1Observation(observed(value), value)
    const complete = await createD1CompleteEnvelope('r0000000001', value, observation)
    expect(complete.completionDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(await digestD1Observation(observation, value)).toBe(complete.observationDigest)
    expect(Object.isFrozen(observation.bindings[0])).toBe(true)
    expect(Object.isFrozen(complete)).toBe(true)
    await expect(canonicalizeD1CompleteEnvelope({ ...complete, completionDigest: digest('f') }, value, observation))
      .rejects.toMatchObject({ details: { field: 'completion.completionDigest' } })
  })

  it('accepts FAILED before completion and requires the actual completion for terminal audit matching', async () => {
    const value = await desired(['a'])
    const observation = canonicalizeD1Observation(observed(value), value)
    const complete = await createD1CompleteEnvelope('r0000000001', value, observation)
    const active = canonicalizeD1ActiveEnvelope({ schemaVersion: 1, revisionId: complete.revisionId, desiredStateDigest: complete.desiredStateDigest })
    const failed = canonicalizeD1AuditRecord({
      schemaVersion: 1, domain: 'boring-d1-audit:v1', revisionId: active.revisionId,
      desiredStateDigest: active.desiredStateDigest, outcome: 'FAILED', phase: 'READINESS',
      at: '2026-07-12T00:00:00.000Z', operator,
    })
    expect(failed.outcome).toBe('FAILED')
    expect(() => canonicalizeD1AuditRecord({ ...failed, completionDigest: complete.completionDigest }))
      .toThrow(expect.objectContaining({ details: { field: 'audit.completionDigest' } }))
    const postCompleteFailure = canonicalizeD1AuditRecord({
      ...failed, phase: 'PUBLICATION', completionDigest: complete.completionDigest,
    })
    expect(postCompleteFailure).toMatchObject({
      outcome: 'FAILED', phase: 'PUBLICATION', completionDigest: complete.completionDigest,
    })
    expect(() => canonicalizeD1AuditRecord({ ...failed, phase: 'PUBLICATION' }))
      .toThrow(expect.objectContaining({ details: { field: 'audit.completionDigest' } }))
    expect(() => canonicalizeD1AuditRecord({
      ...failed, outcome: 'COMPLETE', phase: 'PUBLICATION', completionDigest: complete.completionDigest,
    })).toThrow(expect.objectContaining({ details: { field: 'audit.phase' } }))
    expect(() => canonicalizeD1AuditRecord({
      ...failed, outcome: 'RECOVERY_REQUIRED', phase: 'READINESS', completionDigest: complete.completionDigest,
    })).toThrow(expect.objectContaining({ details: { field: 'audit.phase' } }))
    const terminal = canonicalizeD1AuditRecord({
      ...failed, outcome: 'RECOVERY_REQUIRED', phase: 'RECOVERY', completionDigest: complete.completionDigest,
    }) as D1AuditRecordV1
    expect(isD1TerminalAuditFor(terminal, active, complete)).toBe(true)
    const wrong = canonicalizeD1AuditRecord({ ...terminal, completionDigest: digest('f') })
    expect(isD1TerminalAuditFor(wrong, active, complete)).toBe(false)
    expect(Object.isFrozen(terminal.operator)).toBe(true)
  })
})
