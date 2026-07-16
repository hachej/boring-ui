import type { Sha256Digest } from '@hachej/boring-agent/shared'

import { validateAgentHostAgentArtifact } from './agentHostAgentArtifactSnapshot.js'
import type { AgentHostActiveCollection, AgentHostActiveCollectionReader, AgentHostAgentArtifactReader } from './activeCollectionReader.js'
import { AgentHostError, AgentHostErrorCode } from './agentHostPlan.js'

export interface WorkspaceAgentRuntimeRecipe {
  readonly workspaceId: string
  readonly defaultDeploymentId: string
  readonly resolvedDigest: Sha256Digest
  readonly instructions: Readonly<{ ref: string; content: string }>
}

export interface WorkspaceAgentRuntimeIdentity {
  readonly workspaceId: string
  readonly defaultDeploymentId: string
  readonly resolvedDigest: Sha256Digest
  readonly activeRevision: string
}

export type AgentHostAgentRuntimeIdentityResolver = (
  workspaceId: string,
  activeRevision?: string,
) => Promise<WorkspaceAgentRuntimeIdentity>

export type AgentHostAgentRuntimeRecipeResolver = (
  workspaceId: string,
  activeRevision?: string,
) => Promise<WorkspaceAgentRuntimeRecipe>

function unavailable(): never {
  throw new AgentHostError(AgentHostErrorCode.PUBLICATION_FAILED, { field: 'agentArtifacts' })
}

export interface AgentHostAgentRuntimeRecipeSource extends AgentHostActiveCollectionReader {
  readRecipe(workspaceId: string, activeRevision?: string): Promise<WorkspaceAgentRuntimeRecipe>
}

async function selectWorkspaceAgent(activeReader: AgentHostActiveCollectionReader, workspaceId: string, activeRevision?: string) {
  const collection = await activeReader.read()
  if (!collection || (activeRevision !== undefined && collection.active.revisionId !== activeRevision)) unavailable()
  const matches = collection.desired.plan.bindings.filter((binding) => binding.workspaceId === workspaceId)
  if (matches.length !== 1) unavailable()
  const binding = matches[0]!
  const expected = collection.desired.resolvedBindings.find((value) => value.bindingId === binding.bindingId)
  if (!expected) unavailable()
  return { collection, binding, expected }
}

export function createAgentHostAgentRuntimeIdentityResolver(
  activeReader: AgentHostActiveCollectionReader,
): AgentHostAgentRuntimeIdentityResolver {
  return async (workspaceId, activeRevision) => {
    const selected = await selectWorkspaceAgent(activeReader, workspaceId, activeRevision)
    return Object.freeze({
      workspaceId: selected.binding.workspaceId,
      defaultDeploymentId: selected.binding.defaultDeploymentId,
      resolvedDigest: selected.expected.resolvedDigest,
      activeRevision: selected.collection.active.revisionId,
    })
  }
}

export async function loadAgentHostValidatedAgentArtifactRecipe(
  envelope: Parameters<typeof validateAgentHostAgentArtifact>[0],
  binding: AgentHostActiveCollection['desired']['plan']['bindings'][number],
  expected: AgentHostActiveCollection['desired']['resolvedBindings'][number],
): Promise<WorkspaceAgentRuntimeRecipe> {
  await validateAgentHostAgentArtifact(envelope, binding, expected)
  const instructions = envelope.bundle.assets.find((asset) => asset.path === expected.definition.instructionsRef)
  if (!instructions) unavailable()
  return Object.freeze({
    workspaceId: binding.workspaceId,
    defaultDeploymentId: binding.defaultDeploymentId,
    resolvedDigest: expected.resolvedDigest,
    instructions: Object.freeze({ ref: instructions.path, content: instructions.content }),
  })
}

export function createAgentHostAgentRuntimeRecipeResolver(
  activeReader: AgentHostAgentArtifactReader,
  source?: AgentHostAgentRuntimeRecipeSource,
): AgentHostAgentRuntimeRecipeResolver {
  return async (workspaceId, activeRevision) => {
    if (source) return source.readRecipe(workspaceId, activeRevision)
    const { collection, binding, expected } = await selectWorkspaceAgent(activeReader, workspaceId, activeRevision)
    return loadAgentHostValidatedAgentArtifactRecipe(await activeReader.readAgentArtifact(collection, binding), binding, expected)
  }
}
