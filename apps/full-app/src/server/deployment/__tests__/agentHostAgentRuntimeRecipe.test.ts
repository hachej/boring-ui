import { createAgentAssetDigest, createAgentDefinitionDigest, type Sha256Digest } from '@hachej/boring-agent/shared'
import { resolveAgentDeployment } from '@hachej/boring-agent/server'
import { describe, expect, it } from 'vitest'

import type { AgentHostAgentArtifactEnvelopeV1 } from '../agentHostAgentArtifactSnapshot.js'
import { createAgentHostAgentRuntimeIdentityResolver, createAgentHostAgentRuntimeRecipeResolver, loadAgentHostValidatedAgentArtifactRecipe } from '../agentHostAgentRuntimeRecipe.js'
import type { AgentHostActiveCollection, AgentHostAgentArtifactReader } from '../activeCollectionReader.js'
import { AgentHostErrorCode, type AgentHostSiteBindingV1 } from '../agentHostPlan.js'

const digest = (value: string): Sha256Digest => `sha256:${(value.charCodeAt(0) % 16).toString(16).repeat(64)}`

async function deployed(id: string, content: string) {
  const asset = { path: 'instructions.md', content, digest: await createAgentAssetDigest(content) }
  const definition = { schemaVersion: 1 as const, definitionId: `definition:${id}`, version: '1.0.0', instructionsRef: asset.path }
  const bundle = { definition, definitionDigest: await createAgentDefinitionDigest({ definition, assets: [asset] }), assets: [asset] }
  const binding = { bindingId: id, hostname: `${id}.example.test`, workspaceId: `workspace:${id}`,
    defaultDeploymentId: `deployment:${id}`, bundleRef: `bundle:${id}`, deploymentRef: `deployment-ref:${id}`,
    workspaceAllocationRef: 'workspace', sessionAllocationRef: 'session', ownerPrincipalRef: 'owner',
    landing: { title: id, summary: id }, environmentRef: 'production', secretRefs: [] } satisfies AgentHostSiteBindingV1
  const deployment = { deploymentId: binding.defaultDeploymentId, version: '1.0.0', agentId: 'default',
    definition: { definitionId: definition.definitionId, version: definition.version, digest: bundle.definitionDigest } }
  const compositionDigest = digest(id)
  const resolved = await resolveAgentDeployment(bundle, deployment, { workspaceId: binding.workspaceId,
    defaultDeploymentId: binding.defaultDeploymentId, workspaceCompositionDigest: compositionDigest })
  const envelope = { schemaVersion: 1, domain: 'boring-agent-host-agent-artifact:v1', hostId: 'host-1', bindingId: binding.bindingId,
    bundleRef: binding.bundleRef, deploymentRef: binding.deploymentRef, workspaceAllocationRef: binding.workspaceAllocationRef,
    workspaceCompositionDigest: compositionDigest, bundle, deployment } satisfies AgentHostAgentArtifactEnvelopeV1
  return { binding, envelope, resolved: { schemaVersion: 1 as const, bindingId: binding.bindingId,
    composition: { snapshot: {} as never, digest: compositionDigest }, ...resolved } }
}

describe('AgentHost deployed-agent runtime recipe', () => {
  it('returns exact immutable workspace recipes without sibling prompt leakage', async () => {
    const first = await deployed('insurance', 'Compare insurance only.'); const second = await deployed('travel', 'Compare travel only.')
    const collection = { active: { schemaVersion: 1, revisionId: 'r0000000001', desiredStateDigest: digest('a') },
      desired: { plan: { bindings: [first.binding, second.binding] }, resolvedBindings: [first.resolved, second.resolved] } } as unknown as AgentHostActiveCollection
    const artifacts = new Map([[first.binding.bindingId, first.envelope], [second.binding.bindingId, second.envelope]])
    let artifactReads = 0
    const reader = { async read() { return collection }, async readAgentArtifact(snapshot, binding) {
      artifactReads += 1
      expect(snapshot).toBe(collection); return artifacts.get(binding.bindingId)!
    } } satisfies AgentHostAgentArtifactReader
    const identity = await createAgentHostAgentRuntimeIdentityResolver(reader)(first.binding.workspaceId)
    expect(identity).toEqual({ workspaceId: first.binding.workspaceId, defaultDeploymentId: first.binding.defaultDeploymentId,
      resolvedDigest: first.resolved.resolvedDigest, activeRevision: collection.active.revisionId })
    expect(artifactReads).toBe(0)
    const resolve = createAgentHostAgentRuntimeRecipeResolver(reader)
    const insurance = await resolve(first.binding.workspaceId, collection.active.revisionId)
    const travel = await resolve(second.binding.workspaceId, collection.active.revisionId)
    expect(await resolve(first.binding.workspaceId)).toEqual(insurance)
    expect(insurance).toEqual({ workspaceId: first.binding.workspaceId, defaultDeploymentId: first.binding.defaultDeploymentId,
      resolvedDigest: first.resolved.resolvedDigest, instructions: { ref: 'instructions.md', content: 'Compare insurance only.' } })
    expect(travel.instructions.content).toBe('Compare travel only.')
    expect(JSON.stringify(insurance)).not.toContain('travel')
    expect(Object.isFrozen(insurance)).toBe(true); expect(Object.isFrozen(insurance.instructions)).toBe(true)
    expect(artifactReads).toBe(3)
  })

  it('projects a candidate artifact through the same validation path', async () => {
    const value = await deployed('insurance', 'Compare insurance only.')
    await expect(loadAgentHostValidatedAgentArtifactRecipe(value.envelope, value.binding, value.resolved)).resolves.toEqual({
      workspaceId: value.binding.workspaceId, defaultDeploymentId: value.binding.defaultDeploymentId,
      resolvedDigest: value.resolved.resolvedDigest, instructions: { ref: 'instructions.md', content: 'Compare insurance only.' },
    })
    await expect(loadAgentHostValidatedAgentArtifactRecipe(value.envelope, value.binding, { ...value.resolved, resolvedDigest: digest('f') }))
      .rejects.toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED })
  })

  it('fails before runtime creation on revision or persisted digest mismatch', async () => {
    const value = await deployed('insurance', 'Compare insurance only.')
    const collection = { active: { schemaVersion: 1, revisionId: 'r0000000001', desiredStateDigest: digest('a') },
      desired: { plan: { bindings: [value.binding] }, resolvedBindings: [{ ...value.resolved, resolvedDigest: digest('f') }] } } as unknown as AgentHostActiveCollection
    const reader = { async read() { return collection }, async readAgentArtifact() { return value.envelope } } satisfies AgentHostAgentArtifactReader
    const resolve = createAgentHostAgentRuntimeRecipeResolver(reader)
    await expect(resolve(value.binding.workspaceId, 'r0000000002')).rejects.toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED })
    await expect(resolve(value.binding.workspaceId)).rejects.toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED })
  })
})
