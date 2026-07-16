import { readdir, realpath } from 'node:fs/promises'
import path from 'node:path'

import {
  AgentDefinitionValidationError,
  AgentDeploymentValidationError,
  validateAgentDefinition,
  validateAgentDeployment,
  type AgentDeployment,
  type CompiledAgentBundle,
  type Sha256Digest,
} from '@hachej/boring-agent/shared'
import { resolveAgentDeployment } from '@hachej/boring-agent/server'

import { assertAgentHostExactKeys, agentHostDigest, AgentHostError, AgentHostErrorCode, strictAgentHostId, strictAgentHostRef, type AgentHostSiteBindingV1 } from './agentHostPlan.js'
import { openAgentHostSecureDirectory, openAgentHostSecureRoot, readAgentHostSecureFile } from './agentHostFileRuntimeInputsProvider.js'
import type { AgentHostResolvedBindingV1 } from './agentHostRevisionCodec.js'

export const AGENT_HOST_AGENT_ARTIFACT_INPUT_ROOT = '/etc/boring/agent-host/agent-artifacts'
const DOMAIN = 'boring-agent-host-agent-artifact:v1'

export interface AgentHostAgentArtifactEnvelopeV1 {
  readonly schemaVersion: 1
  readonly domain: typeof DOMAIN
  readonly hostId: string
  readonly bindingId: string
  readonly bundleRef: string
  readonly deploymentRef: string
  readonly workspaceAllocationRef: string
  readonly workspaceCompositionDigest: Sha256Digest
  readonly bundle: CompiledAgentBundle
  readonly deployment: AgentDeployment
}
export interface AgentHostLoadedAgentArtifact {
  readonly envelope: AgentHostAgentArtifactEnvelopeV1
}
export interface AgentHostAgentArtifactInput {
  readonly binding: AgentHostSiteBindingV1
  readonly compositionDigest: Sha256Digest
}
export interface AgentHostAgentArtifactLimits {
  readonly maxBindings: number
  readonly maxBundleBytes: number
  readonly maxTotalBundleBytes: number
}

function failed(field = 'agentArtifacts'): AgentHostError {
  return new AgentHostError(AgentHostErrorCode.PUBLICATION_FAILED, { field })
}
/** Internal revision-store parser; callers should use the fixed inbox/revision readers. */
export function canonicalizeAgentHostAgentArtifactEnvelope(raw: unknown, hostId: string, binding: AgentHostSiteBindingV1): AgentHostAgentArtifactEnvelopeV1 {
  if (binding.bindingId.length > 250) throw failed()
  assertAgentHostExactKeys(raw, ['schemaVersion', 'domain', 'hostId', 'bindingId', 'bundleRef', 'deploymentRef', 'workspaceAllocationRef', 'workspaceCompositionDigest', 'bundle', 'deployment'], 'agentArtifacts')
  if (raw.schemaVersion !== 1 || raw.domain !== DOMAIN || strictAgentHostId(raw.hostId, 'hostId') !== hostId
    || strictAgentHostRef(raw.bindingId, 'bindingId') !== binding.bindingId || strictAgentHostRef(raw.bundleRef, 'bundleRef') !== binding.bundleRef
    || strictAgentHostRef(raw.deploymentRef, 'deploymentRef') !== binding.deploymentRef
    || strictAgentHostRef(raw.workspaceAllocationRef, 'workspaceAllocationRef') !== binding.workspaceAllocationRef) throw failed()
  assertAgentHostExactKeys(raw.bundle, ['definition', 'definitionDigest', 'assets'], 'agentArtifacts.bundle')
  const definition = validateAgentDefinition(raw.bundle.definition)
  const deployment = validateAgentDeployment(raw.deployment)
  if (!definition.valid) throw new AgentDefinitionValidationError(definition.issues[0])
  if (!deployment.valid) throw new AgentDeploymentValidationError(deployment.issues[0])
  if (!Array.isArray(raw.bundle.assets)) throw failed()
  const bundle = Object.freeze({
    definition: Object.freeze(definition.value), definitionDigest: raw.bundle.definitionDigest as Sha256Digest,
    assets: Object.freeze(raw.bundle.assets.map((asset) => asset as CompiledAgentBundle['assets'][number])
      .map(({ path, digest, content }) => Object.freeze({ path, digest, content })).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
  })
  return Object.freeze({ schemaVersion: 1, domain: DOMAIN, hostId, bindingId: binding.bindingId, bundleRef: binding.bundleRef,
    deploymentRef: binding.deploymentRef, workspaceAllocationRef: binding.workspaceAllocationRef,
    workspaceCompositionDigest: agentHostDigest(raw.workspaceCompositionDigest, 'workspaceCompositionDigest'), bundle, deployment: Object.freeze(deployment.value) })
}

export async function validateAgentHostAgentArtifact(envelope: AgentHostAgentArtifactEnvelopeV1, binding: AgentHostSiteBindingV1,
  expected: AgentHostResolvedBindingV1): Promise<void> {
  if (envelope.workspaceAllocationRef !== binding.workspaceAllocationRef || envelope.workspaceCompositionDigest !== expected.composition.digest) throw failed()
  const resolved = await resolveAgentDeployment(envelope.bundle, envelope.deployment, { workspaceId: binding.workspaceId,
    defaultDeploymentId: binding.defaultDeploymentId, workspaceCompositionDigest: expected.composition.digest })
  if (JSON.stringify({ workspace: resolved.workspace, deployment: resolved.deployment, definition: resolved.definition, resolvedDigest: resolved.resolvedDigest })
    !== JSON.stringify({ workspace: expected.workspace, deployment: expected.deployment, definition: expected.definition, resolvedDigest: expected.resolvedDigest })) throw failed()
}

export async function loadAgentHostAgentArtifactInputs(options: {
  readonly hostId: string
  readonly ownerUid: number
  readonly inputs: readonly AgentHostAgentArtifactInput[]
  readonly limits: AgentHostAgentArtifactLimits
  readonly root?: string
  readonly fault?: (point: 'after-directory-open' | 'after-file-open', bindingId: string) => void | Promise<void>
}): Promise<readonly AgentHostLoadedAgentArtifact[]> {
  try {
    const hostId = strictAgentHostId(options.hostId, 'hostId')
    if (process.geteuid?.() !== options.ownerUid || !Number.isSafeInteger(options.ownerUid) || options.ownerUid < 0
      || !Number.isSafeInteger(options.limits.maxBindings) || options.inputs.length > options.limits.maxBindings
      || !Number.isSafeInteger(options.limits.maxBundleBytes) || options.limits.maxBundleBytes <= 0
      || !Number.isSafeInteger(options.limits.maxTotalBundleBytes) || options.limits.maxTotalBundleBytes <= 0) throw failed()
    const root = path.resolve(options.root ?? AGENT_HOST_AGENT_ARTIFACT_INPUT_ROOT)
    const handles = []
    try {
      const policy = { uid: options.ownerUid, gid: process.getegid!() }
      const rootHandle = await openAgentHostSecureRoot(root, policy, false); handles.push(rootHandle.handle)
      const hostHandle = await openAgentHostSecureDirectory(path.join(rootHandle.path, hostId), rootHandle, rootHandle, policy); handles.push(hostHandle.handle)
      let total = 0; const loaded: AgentHostLoadedAgentArtifact[] = []
      for (const input of options.inputs) {
        const handle = await openAgentHostSecureDirectory(path.join(hostHandle.path, input.binding.bindingId), hostHandle, rootHandle, policy); handles.push(handle.handle)
        await options.fault?.('after-directory-open', input.binding.bindingId)
        const expectedPath = path.join(root, hostId, input.binding.bindingId, 'artifact.json')
        if (JSON.stringify((await readdir(handle.path)).sort()) !== '["artifact.json"]') throw failed()
        const bytes = await readAgentHostSecureFile(path.join(handle.path, 'artifact.json'), rootHandle, policy, options.limits.maxBundleBytes,
          () => options.fault?.('after-file-open', input.binding.bindingId), expectedPath)
        if (await realpath(handle.path) !== path.dirname(expectedPath)) throw failed()
        total += bytes.byteLength
        if (total > options.limits.maxTotalBundleBytes) throw failed()
        const envelope = canonicalizeAgentHostAgentArtifactEnvelope(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown, hostId, input.binding)
        if (envelope.workspaceCompositionDigest !== input.compositionDigest) throw failed()
        await resolveAgentDeployment(envelope.bundle, envelope.deployment, { workspaceId: input.binding.workspaceId,
          defaultDeploymentId: input.binding.defaultDeploymentId, workspaceCompositionDigest: input.compositionDigest })
        loaded.push(Object.freeze({ envelope }))
      }
      return Object.freeze(loaded)
    } finally { await Promise.allSettled(handles.map((handle) => handle.close())) }
  } catch (error) {
    if (error instanceof AgentDefinitionValidationError || error instanceof AgentDeploymentValidationError) throw error
    if (error instanceof AgentHostError && error.code === AgentHostErrorCode.PUBLICATION_FAILED) throw error
    throw failed()
  }
}
