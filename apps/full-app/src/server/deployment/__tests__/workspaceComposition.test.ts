import {
  createAgentAssetDigest,
  createAgentDefinitionDigest,
  type AgentDefinition,
  type AgentDeployment,
  type CompiledAgentBundle,
  type Sha256Digest,
} from '@hachej/boring-agent/shared'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import { AgentHostErrorCode, parseAgentHostPlan } from '../agentHostPlan.js'
import { canonicalizeAgentHostWorkspaceAllocation } from '../agentHostRootDesiredResolver.js'
import {
  createFullAppServerPluginComposition,
  FULL_APP_BORING_MCP_PLUGIN_DESCRIPTOR,
  FULL_APP_DEFAULT_PLUGIN_PACKAGE_DESCRIPTORS,
  FULL_APP_GOVERNANCE_PLUGIN_DESCRIPTOR,
} from '../../plugins.js'
import {
  canonicalizeWorkspaceCompositionSnapshot,
  createWorkspaceCompositionSnapshot,
  resolveWorkspaceAgentDeployment,
  type StableContributionDescriptor,
  type WorkspaceCompositionInputV1,
} from '../workspaceComposition.js'

const hashes = {
  app: `sha256:${'a'.repeat(64)}` as Sha256Digest,
  profile: `sha256:${'b'.repeat(64)}` as Sha256Digest,
  attestation: `sha256:${'c'.repeat(64)}` as Sha256Digest,
  prompt: `sha256:${'d'.repeat(64)}` as Sha256Digest,
  pluginA: `sha256:${'e'.repeat(64)}` as Sha256Digest,
  pluginB: `sha256:${'f'.repeat(64)}` as Sha256Digest,
}

const definition: AgentDefinition = {
  schemaVersion: 1,
  definitionId: 'assurance-éclair',
  version: '1.0.0',
  instructionsRef: 'instructions.md',
  capabilityRequirements: ['filesystem:read'],
  toolRefs: ['quotes.compare'],
}

let compiledBundle: CompiledAgentBundle
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()

function descriptor(id: string, contentDigest: Sha256Digest): StableContributionDescriptor {
  return { id, version: '1.0.0', contentDigest }
}

function input(workspaceId = 'workspace-a'): WorkspaceCompositionInputV1 {
  return {
    workspaceId,
    bundle: compiledBundle,
    runtimeProfile: {
      ref: 'runsc-eu',
      id: 'runsc',
      version: '2026.07.11',
      contentDigest: hashes.profile,
      isolationAttestationDigest: hashes.attestation,
      workspaceRootPolicyRef: 'workspace-roots-eu',
      sessionRootPolicyRef: 'session-roots-eu',
    },
    hostAppImageDigest: hashes.app,
    serverPlugins: [descriptor('plugin-b', hashes.pluginB), descriptor('plugin-a', hashes.pluginA)],
    defaultPluginPackages: [descriptor('automation', hashes.pluginA)],
    staticSystemPromptDigest: hashes.prompt,
    inventories: {
      capabilities: ['filesystem:write', 'filesystem:read'],
      tools: ['quotes.compare'],
      skills: null,
      mcpServers: null,
    },
    provisioning: [descriptor('python-runtime', hashes.pluginB)],
    filesystemBindings: [
      { id: 'user', access: 'readwrite', policy: 'workspace-only' },
      { id: 'company-context', access: 'readonly', policy: 'policy-filtered' },
    ],
    externalPlugins: false,
    pluginAuthoring: false,
  }
}

async function bundle(sourceDefinition: AgentDefinition = definition): Promise<CompiledAgentBundle> {
  const asset = Object.freeze({
    path: 'instructions.md',
    content: 'Compare policies.',
    digest: await createAgentAssetDigest('Compare policies.'),
  })
  const compiledDefinition = Object.freeze({
    ...sourceDefinition,
    capabilityRequirements: Object.freeze([...sourceDefinition.capabilityRequirements ?? []]),
    toolRefs: Object.freeze([...sourceDefinition.toolRefs ?? []]),
  })
  return Object.freeze({
    definition: compiledDefinition,
    assets: Object.freeze([asset]),
    definitionDigest: await createAgentDefinitionDigest({ definition: compiledDefinition, assets: [asset] }),
  })
}

function sourceDigest(manifest: readonly string[]): Sha256Digest {
  const files = execFileSync('git', ['ls-files', '--', ...manifest], { cwd: repoRoot, encoding: 'utf8' })
    .trim().split('\n').filter(Boolean).sort()
  const blobDigests = files.map((file) =>
    createHash('sha256').update(readFileSync(path.join(repoRoot, file))).digest('hex'))
  return `sha256:${createHash('sha256').update(`${blobDigests.join('\n')}\n`).digest('hex')}`
}

function parsedResolverBinding(defaultDeploymentId: string) {
  return parseAgentHostPlan({
    schemaVersion: 1,
    hostId: 'eu-host-1',
    expectedHostRevision: null,
    hostAppImageDigest: hashes.app,
    runtimeProfileRef: 'runsc-eu',
    databaseRef: 'postgres-eu',
    workspaceRootPolicyRef: 'workspace-roots-eu',
    sessionRootPolicyRef: 'session-roots-eu',
    bindings: [{
      bindingId: 'insurance', hostname: 'insurance.example.test',
      workspaceId: 'espace:éclair', defaultDeploymentId,
      bundleRef: 'insurance-bundle', deploymentRef: 'insurance-deployment',
      workspaceAllocationRef: 'workspace-allocation', sessionAllocationRef: 'session-allocation',
      ownerPrincipalRef: 'owner', environmentRef: 'production', secretRefs: [],
      landing: { title: 'Insurance', summary: 'Compare policies.' },
    }],
  }).bindings[0]
}

describe('createWorkspaceCompositionSnapshot', () => {
  beforeAll(async () => {
    compiledBundle = await bundle()
  })

  it('couples live contribution ids to their descriptors', () => {
    const composition = createFullAppServerPluginComposition()
    expect(composition.plugins.map((plugin) => plugin.id))
      .toEqual(composition.descriptors.map((descriptor) => descriptor.id))
  })

  it('keeps contribution descriptors fresh against owned tracked sources', () => {
    expect(sourceDigest(['apps/full-app/src/server/boringMcp.ts', 'plugins/boring-mcp/src']))
      .toBe(FULL_APP_BORING_MCP_PLUGIN_DESCRIPTOR.contentDigest)
    expect(sourceDigest(['plugins/boring-governance/src']))
      .toBe(FULL_APP_GOVERNANCE_PLUGIN_DESCRIPTOR.contentDigest)
    expect(sourceDigest(['plugins/boring-automation/src']))
      .toBe(FULL_APP_DEFAULT_PLUGIN_PACKAGE_DESCRIPTORS[0].contentDigest)
    expect(JSON.parse(readFileSync(path.join(repoRoot, 'plugins/boring-mcp/package.json'), 'utf8')).version)
      .toBe(FULL_APP_BORING_MCP_PLUGIN_DESCRIPTOR.version)
    expect(JSON.parse(readFileSync(path.join(repoRoot, 'plugins/boring-governance/package.json'), 'utf8')).version)
      .toBe(FULL_APP_GOVERNANCE_PLUGIN_DESCRIPTOR.version)
    expect(JSON.parse(readFileSync(path.join(repoRoot, 'plugins/boring-automation/package.json'), 'utf8')).version)
      .toBe(FULL_APP_DEFAULT_PLUGIN_PACKAGE_DESCRIPTORS[0].version)
  })

  it('independently pins live composition bytes to the exact allocation revision', async () => {
    const binding = parsedResolverBinding('insurance:eu'); const identity = await createWorkspaceCompositionSnapshot(input(binding.workspaceId))
    const allocation = { schemaVersion: 1, domain: 'boring-agent-host-workspace-allocation:v1', hostId: 'eu-host-1', bindingId: binding.bindingId,
      workspaceAllocationRef: binding.workspaceAllocationRef, composition: { snapshot: identity.snapshot, workspaceCompositionDigest: identity.digest } }
    await expect(canonicalizeAgentHostWorkspaceAllocation(allocation, 'eu-host-1', binding)).resolves.toEqual(identity)
    await expect(canonicalizeAgentHostWorkspaceAllocation({ ...allocation, workspaceAllocationRef: 'stale' }, 'eu-host-1', binding)).rejects.toThrow()
    await expect(canonicalizeAgentHostWorkspaceAllocation({ ...allocation, composition: { ...allocation.composition, workspaceCompositionDigest: hashes.app } }, 'eu-host-1', binding)).rejects.toThrow()
  })

  it('is order-stable, deeply frozen, canonical, and redacted', async () => {
    const firstInput = input()
    const reversedBase = input()
    const reversed: WorkspaceCompositionInputV1 = {
      ...reversedBase,
      serverPlugins: [...reversedBase.serverPlugins].reverse(),
      inventories: {
        ...reversedBase.inventories,
        capabilities: [...reversedBase.inventories.capabilities!].reverse(),
      },
      filesystemBindings: [...reversedBase.filesystemBindings].reverse(),
    }

    const first = await createWorkspaceCompositionSnapshot(firstInput)
    const second = await createWorkspaceCompositionSnapshot(reversed)

    expect(second).toEqual(first)
    expect(canonicalizeWorkspaceCompositionSnapshot({
      ...first.snapshot,
      serverPlugins: [...first.snapshot.serverPlugins].reverse(),
    })).toEqual(first.snapshot)
    expect(first.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(Object.isFrozen(first.snapshot)).toBe(true)
    expect(Object.isFrozen(first.snapshot.runtimeProfile)).toBe(true)
    expect(Object.isFrozen(first.snapshot.serverPlugins[0])).toBe(true)
    const serialized = JSON.stringify(first.snapshot)
    expect(serialized).not.toMatch(/\/srv\/|secret|prompt text/i)
  })

  it('changes the digest when trusted composition identity changes', async () => {
    const first = await createWorkspaceCompositionSnapshot(input())
    const changedInput: WorkspaceCompositionInputV1 = {
      ...input(),
      serverPlugins: [descriptor('plugin-a', hashes.pluginB), descriptor('plugin-b', hashes.pluginB)],
    }
    const changed = await createWorkspaceCompositionSnapshot(changedInput)
    const sameCompositionOtherDefinition = await createWorkspaceCompositionSnapshot({
      ...input(),
      bundle: await bundle({ ...definition, definitionId: 'other:agent' }),
    })

    expect(changed.digest).not.toBe(first.digest)
    expect(sameCompositionOtherDefinition.digest).toBe(first.digest)
  })

  it.each([
    ['unavailable', null],
    ['available but missing', []],
  ])('fails closed when a required capability is %s', async (_name, capabilities) => {
    const candidate: WorkspaceCompositionInputV1 = {
      ...input(),
      inventories: { ...input().inventories, capabilities },
    }
    await expect(createWorkspaceCompositionSnapshot(candidate)).rejects.toMatchObject({
      code: AgentHostErrorCode.REQUIREMENT_UNSATISFIED,
      details: {
        definitionId: 'assurance-éclair',
        field: 'capabilityRequirements',
        ref: 'filesystem:read',
      },
    })
  })

  it('rejects duplicate inventory ids and undescribed path-bearing fields', async () => {
    const duplicate: WorkspaceCompositionInputV1 = {
      ...input(),
      inventories: { ...input().inventories, tools: ['quotes.compare', 'quotes.compare'] },
    }
    await expect(createWorkspaceCompositionSnapshot(duplicate)).rejects.toMatchObject({
      code: AgentHostErrorCode.PLAN_INVALID,
      details: { field: 'inventories.tools' },
    })

    const extra = { ...input(), sourcePath: '/srv/private/composition' } as WorkspaceCompositionInputV1
    await expect(createWorkspaceCompositionSnapshot(extra)).rejects.toMatchObject({
      code: AgentHostErrorCode.PLAN_INVALID,
      details: { field: 'composition.sourcePath' },
    })
    await expect(createWorkspaceCompositionSnapshot({ ...input(), bundle: null } as unknown as WorkspaceCompositionInputV1))
      .rejects.toMatchObject({ code: AgentHostErrorCode.PLAN_INVALID, details: { field: 'bundle' } })
  })

  it('produces independent exact P6-R binding inputs for two workspaces', async () => {
    const compiled = compiledBundle
    const deployment: AgentDeployment = {
      deploymentId: 'insurance:eu',
      version: '2026.07.12',
      agentId: 'default',
      definition: {
        definitionId: compiled.definition.definitionId,
        version: compiled.definition.version,
        digest: compiled.definitionDigest,
      },
    }
    const planned = parsedResolverBinding(deployment.deploymentId)
    const firstIdentity = await createWorkspaceCompositionSnapshot(input(planned.workspaceId))
    const secondIdentity = await createWorkspaceCompositionSnapshot(input('workspace-b'))
    const first = await resolveWorkspaceAgentDeployment(firstIdentity, compiled, deployment, planned.defaultDeploymentId)
    const second = await resolveWorkspaceAgentDeployment(secondIdentity, compiled, deployment, deployment.deploymentId)

    expect(first.workspace.workspaceId).toBe('espace:éclair')
    expect(second.workspace.workspaceId).toBe('workspace-b')
    expect(first.workspace.compositionDigest).not.toBe(second.workspace.compositionDigest)
    expect(first.resolvedDigest).not.toBe(second.resolvedDigest)
    const otherBundle = await bundle({ ...definition, definitionId: 'other:agent' })
    expect(() => resolveWorkspaceAgentDeployment(firstIdentity, otherBundle, deployment, planned.defaultDeploymentId))
      .toThrow(expect.objectContaining({ code: AgentHostErrorCode.PLAN_INVALID }))
    expect(() => resolveWorkspaceAgentDeployment({
      snapshot: firstIdentity.snapshot,
      digest: hashes.app,
    }, compiled, deployment, planned.defaultDeploymentId)).toThrow(expect.objectContaining({ code: AgentHostErrorCode.PLAN_INVALID }))
  })
})
