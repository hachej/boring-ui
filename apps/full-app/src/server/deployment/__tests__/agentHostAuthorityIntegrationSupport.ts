import { createAgentAssetDigest, createAgentDeploymentDigest, type Sha256Digest } from '@hachej/boring-agent/shared'
import { createResolvedAgentDigest } from '@hachej/boring-agent/server'

import type { AgentHostRuntimeInputsInspectionV1 } from '../agentHostCommand.js'
import {
  canonicalizeAgentHostObservation,
  createAgentHostCompleteEnvelope,
  createAgentHostDesiredSnapshot,
  deriveAgentHostSecretRefsEnvelope,
  digestAgentHostDesired,
  type AgentHostDesiredSnapshotV1,
} from '../agentHostRevisionCodec.js'
import { createAgentHostRuntimeInputsIdentity } from '../agentHostRuntimeInputs.js'
import type { AgentHostStoredCompleteV1 } from '../hostRevisionStore.js'
import { canonicalizeWorkspaceCompositionSnapshot } from '../workspaceComposition.js'

const sha = (value: string): Sha256Digest => `sha256:${value.repeat(64).slice(0, 64)}`

async function build(hostId: string, databaseRef: string, bindingIds: readonly string[]): Promise<{
  desired: AgentHostDesiredSnapshotV1; inspection: readonly AgentHostRuntimeInputsInspectionV1[]; complete(revisionId: string): Promise<AgentHostStoredCompleteV1>
}> {
  const planBindings = []; const resolvedBindings = []
  for (const bindingId of bindingIds) {
    const workspaceId = `workspace:${bindingId}`; const deploymentId = `deployment:${bindingId}`
    const snapshot = canonicalizeWorkspaceCompositionSnapshot({
      schemaVersion: 1, domain: 'boring-workspace-composition:v1', workspaceId,
      runtimeProfile: { ref: 'runsc-eu', id: 'runsc', version: '2026.07.12', contentDigest: sha('b'), isolationAttestationDigest: sha('c'), workspaceRootPolicyRef: 'workspace-roots', sessionRootPolicyRef: 'session-roots' },
      hostAppImageDigest: sha('a'), serverPlugins: [], defaultPluginPackages: [], staticSystemPromptDigest: sha('e'),
      inventories: { capabilities: [], tools: [], skills: null, mcpServers: null }, provisioning: [], filesystemBindings: [],
      policies: { externalPlugins: false, pluginAuthoring: false },
    })
    const compositionDigest = await createAgentAssetDigest(JSON.stringify(snapshot))
    const definition = { definitionId: `definition:${bindingId}`, version: '1.0.0', digest: sha(bindingId === 'lost' ? '9' : 'f'), instructionsRef: 'instructions.md' }
    const deploymentInput = { deploymentId, version: '2026.07.12', agentId: 'default', definition: { definitionId: definition.definitionId, version: definition.version, digest: definition.digest } }
    const deploymentDigest = await createAgentDeploymentDigest(deploymentInput)
    const resolvedDigest = await createResolvedAgentDigest({ workspaceId, defaultDeploymentId: deploymentId, workspaceCompositionDigest: compositionDigest, definitionDigest: definition.digest, deploymentDigest })
    planBindings.push({ bindingId, hostname: `${bindingId}.example.test`, workspaceId, defaultDeploymentId: deploymentId, bundleRef: 'bundle', deploymentRef: 'deployment',
      workspaceAllocationRef: `${bindingId}-workspace`, sessionAllocationRef: `${bindingId}-session`, ownerPrincipalRef: 'owner',
      landing: { title: bindingId, summary: 'Integration.' }, environmentRef: 'production', secretRefs: ['credential-ref'] })
    resolvedBindings.push({ schemaVersion: 1 as const, bindingId, composition: { snapshot, digest: compositionDigest },
      workspace: { workspaceId, defaultDeploymentId: deploymentId, compositionDigest },
      deployment: { deploymentId, version: deploymentInput.version, agentId: 'default', digest: deploymentDigest }, definition, resolvedDigest })
  }
  const desired = await createAgentHostDesiredSnapshot({ schemaVersion: 1, hostId, expectedHostRevision: null, hostAppImageDigest: sha('a'),
    runtimeProfileRef: 'runsc-eu', databaseRef, workspaceRootPolicyRef: 'workspace-roots', sessionRootPolicyRef: 'session-roots', bindings: planBindings }, resolvedBindings)
  const inspection = Object.freeze(desired.plan.bindings.map((binding) => ({ bindingId: binding.bindingId, attestation: {
    environment: { versionFingerprint: sha('1') }, workspaceAllocation: { versionFingerprint: sha('2') },
    sessionAllocation: { versionFingerprint: sha('3') }, secrets: [{ secretRef: 'credential-ref', providerVersionFingerprint: sha('4') }],
  } })))
  const identities = await Promise.all(inspection.map(async (entry) => createAgentHostRuntimeInputsIdentity(
    desired.plan.bindings.find((binding) => binding.bindingId === entry.bindingId)!, entry.attestation)))
  const observation = await canonicalizeAgentHostObservation({ schemaVersion: 1, domain: 'boring-agent-host-observed:v1',
    bindings: desired.resolvedBindings.map((resolved, index) => ({ bindingId: resolved.bindingId, ready: true, resolvedDigest: resolved.resolvedDigest, runtimeInputs: identities[index] })) }, desired)
  const desiredStateDigest = await digestAgentHostDesired(desired)
  return { desired, inspection, complete: async (revisionId) => Object.freeze({ revisionId, desired, desiredStateDigest,
    secretRefs: deriveAgentHostSecretRefsEnvelope(desired), observation, completion: await createAgentHostCompleteEnvelope(revisionId, desired, observation) }) }
}

export async function createAgentHostAuthorityIntegrationState(hostId: string, databaseRef: string) {
  const expected = await build(hostId, databaseRef, ['authority-integration', 'lost'])
  const target = await build(hostId, databaseRef, ['authority-integration'])
  return {
    desired: target.desired, inspection: target.inspection, rollbackInspection: expected.inspection,
    completeOne: await expected.complete('r0000000001'), completeTwo: await target.complete('r0000000002'),
  }
}
