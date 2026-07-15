import type { Sha256Digest } from '@hachej/boring-agent/shared'

import { validateD1AgentArtifact } from './d1AgentArtifactSnapshot.js'
import type { D1ActiveCollection, D1ActiveCollectionReader, D1AgentArtifactReader } from './activeCollectionReader.js'
import { D1HostError, D1HostErrorCode } from './d1Plan.js'

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

export type D1AgentRuntimeIdentityResolver = (
  workspaceId: string,
  activeRevision?: string,
) => Promise<WorkspaceAgentRuntimeIdentity>

export type D1AgentRuntimeRecipeResolver = (
  workspaceId: string,
  activeRevision?: string,
) => Promise<WorkspaceAgentRuntimeRecipe>

function unavailable(): never {
  throw new D1HostError(D1HostErrorCode.PUBLICATION_FAILED, { field: 'agentArtifacts' })
}

export interface D1AgentRuntimeRecipeSource extends D1ActiveCollectionReader {
  readRecipe(workspaceId: string, activeRevision?: string): Promise<WorkspaceAgentRuntimeRecipe>
}

async function selectWorkspaceAgent(activeReader: D1ActiveCollectionReader, workspaceId: string, activeRevision?: string) {
  const collection = await activeReader.read()
  if (!collection || (activeRevision !== undefined && collection.active.revisionId !== activeRevision)) unavailable()
  const matches = collection.desired.plan.bindings.filter((binding) => binding.workspaceId === workspaceId)
  if (matches.length !== 1) unavailable()
  const binding = matches[0]!
  const expected = collection.desired.resolvedBindings.find((value) => value.bindingId === binding.bindingId)
  if (!expected) unavailable()
  return { collection, binding, expected }
}

export function createD1AgentRuntimeIdentityResolver(
  activeReader: D1ActiveCollectionReader,
): D1AgentRuntimeIdentityResolver {
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

export async function loadD1ValidatedAgentArtifactRecipe(
  envelope: Parameters<typeof validateD1AgentArtifact>[0],
  binding: D1ActiveCollection['desired']['plan']['bindings'][number],
  expected: D1ActiveCollection['desired']['resolvedBindings'][number],
): Promise<WorkspaceAgentRuntimeRecipe> {
  await validateD1AgentArtifact(envelope, binding, expected)
  const instructions = envelope.bundle.assets.find((asset) => asset.path === expected.definition.instructionsRef)
  if (!instructions) unavailable()
  return Object.freeze({
    workspaceId: binding.workspaceId,
    defaultDeploymentId: binding.defaultDeploymentId,
    resolvedDigest: expected.resolvedDigest,
    instructions: Object.freeze({ ref: instructions.path, content: instructions.content }),
  })
}

export function createD1AgentRuntimeRecipeResolver(
  activeReader: D1AgentArtifactReader,
  source?: D1AgentRuntimeRecipeSource,
): D1AgentRuntimeRecipeResolver {
  return async (workspaceId, activeRevision) => {
    if (source) return source.readRecipe(workspaceId, activeRevision)
    const { collection, binding, expected } = await selectWorkspaceAgent(activeReader, workspaceId, activeRevision)
    return loadD1ValidatedAgentArtifactRecipe(await activeReader.readAgentArtifact(collection, binding), binding, expected)
  }
}
