import type { Sha256Digest } from '@hachej/boring-agent/shared'
import { describe, expect, it, vi } from 'vitest'

import { AgentHostErrorCode, type AgentHostSiteBindingV1 } from '../agentHostPlan.js'
import type { AgentHostResolvedBindingV1 } from '../agentHostRevisionCodec.js'
import { createAgentHostRuntimeInputsIdentity } from '../agentHostRuntimeInputs.js'
import { createAgentHostUserNeutralCandidatePreloader, type AgentHostUserNeutralCandidateInput } from '../agentHostUserNeutralPreloader.js'

const sha = (value: string): Sha256Digest => `sha256:${value.repeat(64).slice(0, 64)}`
const binding = { bindingId: 'insurance', hostname: 'insurance.example.test', workspaceId: 'workspace:insurance',
  defaultDeploymentId: 'deployment:insurance', bundleRef: 'bundle', deploymentRef: 'deployment',
  workspaceAllocationRef: 'allocation', sessionAllocationRef: 'sessions', ownerPrincipalRef: 'owner',
  landing: { title: 'Insurance', summary: 'Compare policies.' }, environmentRef: 'production', secretRefs: [] } satisfies AgentHostSiteBindingV1
const resolved = { schemaVersion: 1, bindingId: binding.bindingId, resolvedDigest: sha('a'),
  workspace: { workspaceId: binding.workspaceId, defaultDeploymentId: binding.defaultDeploymentId, compositionDigest: sha('b') },
  deployment: { deploymentId: binding.defaultDeploymentId, version: '1', agentId: 'default', digest: sha('c') },
  definition: { definitionId: 'definition', version: '1', digest: sha('d'), instructionsRef: 'instructions.md' },
  composition: { snapshot: {}, digest: sha('b') } } as unknown as AgentHostResolvedBindingV1

async function input(site = binding) {
  return { revisionId: 'r0000000001', binding: site, resolved, runtimeInputs: await createAgentHostRuntimeInputsIdentity(site, {
    environment: { versionFingerprint: sha('e') }, workspaceAllocation: { versionFingerprint: sha('f') },
    sessionAllocation: { versionFingerprint: sha('1') }, secrets: [],
  }) }
}

describe('AgentHost user-neutral candidate preloader', () => {
  it('shares exact preparation and releases once after the final disposable holder', async () => {
    let mutate = () => {}; const release = vi.fn(async () => {}); const load = vi.fn(async () => { mutate(); return Object.freeze({
      workspaceId: binding.workspaceId, defaultDeploymentId: binding.defaultDeploymentId,
      resolvedDigest: resolved.resolvedDigest, instructions: Object.freeze({ ref: 'instructions.md', content: 'Compare.' }),
    }) })
    const allocate = vi.fn(async (value: AgentHostUserNeutralCandidateInput) => Object.freeze({
      workspaceId: value.binding.workspaceId, ref: value.runtimeInputs.workspaceAllocation.ref,
      versionFingerprint: value.runtimeInputs.workspaceAllocation.versionFingerprint, dispose: release,
    }))
    const preloader = createAgentHostUserNeutralCandidatePreloader({ loadValidatedRecipe: load, prepareWorkspaceAllocation: allocate })
    const value = { ...await input(), resolved: { ...resolved } }; mutate = () => Object.assign(value.resolved, { resolvedDigest: sha('9') })
    const first = await preloader.prepare(value); Object.assign(value.resolved, { resolvedDigest: resolved.resolvedDigest })
    const second = await preloader.prepare(value)
    expect(load).toHaveBeenCalledOnce(); expect(allocate).toHaveBeenCalledOnce()
    expect(first.recipe).toBe(second.recipe); expect(first.workspaceAllocation).toBe(second.workspaceAllocation)
    expect('dispose' in first.workspaceAllocation).toBe(false)
    expect(() => Object.assign(first.recipe.instructions, { content: 'mutated' })).toThrow()
    Object.assign(value.binding.landing, { title: 'Mutated' }); expect(first.binding.landing.title).toBe('Insurance')
    await first.dispose(); await first.dispose(); expect(release).not.toHaveBeenCalled()
    await second.dispose(); await second.dispose(); expect(release).toHaveBeenCalledOnce()
  })

  it('rejects conflicting aliases and releases failed candidate-owned allocation before retry', async () => {
    const release = vi.fn(async () => {}); let fail = false
    const preloader = createAgentHostUserNeutralCandidatePreloader({
      loadValidatedRecipe: async () => {
        if (fail) throw new Error('artifact')
        return { workspaceId: binding.workspaceId, defaultDeploymentId: binding.defaultDeploymentId,
          resolvedDigest: resolved.resolvedDigest, instructions: { ref: 'instructions.md', content: 'Compare.' } }
      },
      prepareWorkspaceAllocation: async (value) => ({ workspaceId: value.binding.workspaceId,
        ref: value.runtimeInputs.workspaceAllocation.ref, versionFingerprint: value.runtimeInputs.workspaceAllocation.versionFingerprint, dispose: release }),
    })
    const value = await input(); const retained = await preloader.prepare(value)
    await expect(preloader.prepare({ ...value, binding: { ...binding, hostname: 'changed.example.test' } }))
      .rejects.toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED })
    await retained.dispose(); fail = true
    await expect(preloader.prepare(value)).rejects.toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED })
    expect(release).toHaveBeenCalledTimes(2)
    fail = false; await (await preloader.prepare(value)).dispose(); expect(release).toHaveBeenCalledTimes(3)
    const unavailable = createAgentHostUserNeutralCandidatePreloader({ loadValidatedRecipe: async () => { throw new Error() },
      prepareWorkspaceAllocation: async () => { throw new Error('allocation') } })
    await expect(unavailable.prepare(value)).rejects.toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED })
    await expect(unavailable.prepare(value)).rejects.toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED })
  })

  it('blocks reacquisition until failed final cleanup retries successfully', async () => {
    let allocations = 0; let releases = 0
    const preloader = createAgentHostUserNeutralCandidatePreloader({
      loadValidatedRecipe: async () => ({ workspaceId: binding.workspaceId, defaultDeploymentId: binding.defaultDeploymentId,
        resolvedDigest: resolved.resolvedDigest, instructions: { ref: 'instructions.md', content: 'Compare.' } }),
      prepareWorkspaceAllocation: async (value) => { allocations += 1; return { workspaceId: value.binding.workspaceId,
        ref: value.runtimeInputs.workspaceAllocation.ref, versionFingerprint: value.runtimeInputs.workspaceAllocation.versionFingerprint,
        async dispose() { releases += 1; if (releases === 1) throw new Error('busy') } } },
    })
    const value = await input(); const first = await preloader.prepare(value)
    await expect(first.dispose()).rejects.toThrow('busy'); expect(allocations).toBe(1)
    const replacement = await preloader.prepare(value)
    expect(releases).toBe(2); expect(allocations).toBe(2)
    await replacement.dispose(); expect(releases).toBe(3)
  })
})
