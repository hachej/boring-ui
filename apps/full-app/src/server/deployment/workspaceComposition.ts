import {
  createAgentAssetDigest,
  createAgentDefinitionDigest,
  OpaqueRefSchema,
  type AgentDeployment,
  type CompiledAgentBundle,
  type Sha256Digest,
} from '@hachej/boring-agent/shared'
import { resolveAgentDeployment, type ResolvedAgent } from '@hachej/boring-agent/server'

import {
  assertD1ExactKeys as exactKeys,
  assertD1Record as assertRecord,
  d1Digest as checkedDigest,
  D1HostError,
  D1HostErrorCode,
  invalidD1Field as fail,
  strictD1Ref as checkedRef,
} from './d1Plan.js'

export interface StableContributionDescriptor {
  readonly id: string
  readonly version: string
  readonly contentDigest: Sha256Digest
}

export interface WorkspaceCompositionInputV1 {
  readonly workspaceId: string
  readonly bundle: CompiledAgentBundle
  readonly runtimeProfile: Readonly<{
    ref: string
    id: string
    version: string
    contentDigest: Sha256Digest
    isolationAttestationDigest: Sha256Digest
    workspaceRootPolicyRef: string
    sessionRootPolicyRef: string
  }>
  readonly hostAppImageDigest: Sha256Digest
  readonly serverPlugins: readonly StableContributionDescriptor[]
  readonly defaultPluginPackages: readonly StableContributionDescriptor[]
  readonly staticSystemPromptDigest: Sha256Digest
  readonly inventories: Readonly<{
    capabilities: readonly string[] | null
    tools: readonly string[] | null
    skills: readonly string[] | null
    mcpServers: readonly string[] | null
  }>
  readonly provisioning: readonly StableContributionDescriptor[]
  readonly filesystemBindings: readonly Readonly<{ id: string; access: string; policy: string }>[]
  readonly externalPlugins: boolean
  readonly pluginAuthoring: boolean
}

export interface WorkspaceCompositionSnapshotV1 {
  readonly schemaVersion: 1
  readonly domain: 'boring-workspace-composition:v1'
  readonly workspaceId: string
  readonly runtimeProfile: WorkspaceCompositionInputV1['runtimeProfile']
  readonly hostAppImageDigest: Sha256Digest
  readonly serverPlugins: readonly StableContributionDescriptor[]
  readonly defaultPluginPackages: readonly StableContributionDescriptor[]
  readonly staticSystemPromptDigest: Sha256Digest
  readonly inventories: WorkspaceCompositionInputV1['inventories']
  readonly provisioning: readonly StableContributionDescriptor[]
  readonly filesystemBindings: WorkspaceCompositionInputV1['filesystemBindings']
  readonly policies: Readonly<{ externalPlugins: boolean; pluginAuthoring: boolean }>
}

export interface WorkspaceCompositionIdentityV1 {
  readonly snapshot: WorkspaceCompositionSnapshotV1
  readonly digest: Sha256Digest
}

type BundleDefinitionIdentity = Readonly<{ definitionId: string; version: string; digest: Sha256Digest }>
const issuedCompositionIdentities = new WeakMap<WorkspaceCompositionIdentityV1, BundleDefinitionIdentity>()

const INPUT_KEYS = ['workspaceId', 'bundle', 'runtimeProfile', 'hostAppImageDigest', 'serverPlugins', 'defaultPluginPackages', 'staticSystemPromptDigest', 'inventories', 'provisioning', 'filesystemBindings', 'externalPlugins', 'pluginAuthoring'] as const
const PROFILE_KEYS = ['ref', 'id', 'version', 'contentDigest', 'isolationAttestationDigest', 'workspaceRootPolicyRef', 'sessionRootPolicyRef'] as const
const INVENTORY_KEYS = ['capabilities', 'tools', 'skills', 'mcpServers'] as const

function compareId(left: { id: string }, right: { id: string }): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function opaqueRef(value: unknown, field: string): string {
  const parsed = OpaqueRefSchema.safeParse(value)
  if (!parsed.success) fail(field)
  return parsed.data
}

function sortedUnique(values: unknown, field: string): readonly string[] {
  if (!Array.isArray(values)) fail(field)
  const sorted = [...values].map((value, index) => opaqueRef(value, `${field}[${index}]`)).sort()
  if (new Set(sorted).size !== sorted.length) fail(field)
  return Object.freeze(sorted)
}

function descriptors(values: readonly StableContributionDescriptor[], field: string): readonly StableContributionDescriptor[] {
  if (!Array.isArray(values)) fail(field)
  const sorted = values.map((value, index) => {
    exactKeys(value, ['id', 'version', 'contentDigest'], `${field}[${index}]`)
    return Object.freeze({
      id: checkedRef(value.id, `${field}[${index}].id`),
      version: checkedRef(value.version, `${field}[${index}].version`),
      contentDigest: checkedDigest(value.contentDigest, `${field}[${index}].contentDigest`),
    })
  }).sort(compareId)
  if (new Set(sorted.map((value) => value.id)).size !== sorted.length) fail(field)
  return Object.freeze(sorted)
}

function inventory(values: readonly string[] | null, field: string): readonly string[] | null {
  return values === null ? null : sortedUnique(values, field)
}

function verifyRequirements(
  bundle: CompiledAgentBundle,
  inventories: WorkspaceCompositionSnapshotV1['inventories'],
): void {
  const definition = bundle.definition
  const definitionId = opaqueRef(definition.definitionId, 'bundle.definition.definitionId')
  for (const [field, required, available] of [
    ['capabilityRequirements', definition.capabilityRequirements, inventories.capabilities],
    ['toolRefs', definition.toolRefs, inventories.tools],
    ['skillRefs', definition.skillRefs, inventories.skills],
    ['mcpServerRefs', definition.mcpServerRefs, inventories.mcpServers],
  ] as const) {
    if (required !== undefined && !Array.isArray(required)) fail(`bundle.definition.${field}`)
    for (const [index, rawRef] of (required ?? []).entries()) {
      const ref = opaqueRef(rawRef, `bundle.definition.${field}[${index}]`)
      if (available === null || !available.includes(ref)) {
        throw new D1HostError(D1HostErrorCode.REQUIREMENT_UNSATISFIED, {
          definitionId,
          field,
          ref,
        })
      }
    }
  }
}

export async function createWorkspaceCompositionSnapshot(
  input: WorkspaceCompositionInputV1,
): Promise<WorkspaceCompositionIdentityV1> {
  exactKeys(input, INPUT_KEYS, 'composition')
  exactKeys(input.bundle, ['definition', 'definitionDigest', 'assets'], 'bundle')
  assertRecord(input.bundle.definition, 'bundle.definition')
  exactKeys(input.runtimeProfile, PROFILE_KEYS, 'runtimeProfile')
  exactKeys(input.inventories, INVENTORY_KEYS, 'inventories')
  if (!Array.isArray(input.filesystemBindings)) fail('filesystemBindings')
  if (typeof input.externalPlugins !== 'boolean') fail('externalPlugins')
  if (typeof input.pluginAuthoring !== 'boolean') fail('pluginAuthoring')
  const definitionDigest = await createAgentDefinitionDigest({
    definition: input.bundle.definition,
    assets: input.bundle.assets,
  }).catch(() => fail('bundle'))
  if (definitionDigest !== input.bundle.definitionDigest) fail('bundle.definitionDigest')
  const inventories = Object.freeze({
    capabilities: inventory(input.inventories.capabilities, 'inventories.capabilities'),
    tools: inventory(input.inventories.tools, 'inventories.tools'),
    skills: inventory(input.inventories.skills, 'inventories.skills'),
    mcpServers: inventory(input.inventories.mcpServers, 'inventories.mcpServers'),
  })
  verifyRequirements(input.bundle, inventories)
  const filesystemBindings = input.filesystemBindings.map((binding, index) => {
    exactKeys(binding, ['id', 'access', 'policy'], `filesystemBindings[${index}]`)
    return Object.freeze({
      id: checkedRef(binding.id, `filesystemBindings[${index}].id`),
      access: checkedRef(binding.access, `filesystemBindings[${index}].access`),
      policy: checkedRef(binding.policy, `filesystemBindings[${index}].policy`),
    })
  }).sort(compareId)
  if (new Set(filesystemBindings.map((binding) => binding.id)).size !== filesystemBindings.length) fail('filesystemBindings')

  const snapshot: WorkspaceCompositionSnapshotV1 = Object.freeze({
    schemaVersion: 1,
    domain: 'boring-workspace-composition:v1',
    workspaceId: opaqueRef(input.workspaceId, 'workspaceId'),
    runtimeProfile: Object.freeze({
      ref: checkedRef(input.runtimeProfile.ref, 'runtimeProfile.ref'),
      id: checkedRef(input.runtimeProfile.id, 'runtimeProfile.id'),
      version: checkedRef(input.runtimeProfile.version, 'runtimeProfile.version'),
      contentDigest: checkedDigest(input.runtimeProfile.contentDigest, 'runtimeProfile.contentDigest'),
      isolationAttestationDigest: checkedDigest(input.runtimeProfile.isolationAttestationDigest, 'runtimeProfile.isolationAttestationDigest'),
      workspaceRootPolicyRef: checkedRef(input.runtimeProfile.workspaceRootPolicyRef, 'runtimeProfile.workspaceRootPolicyRef'),
      sessionRootPolicyRef: checkedRef(input.runtimeProfile.sessionRootPolicyRef, 'runtimeProfile.sessionRootPolicyRef'),
    }),
    hostAppImageDigest: checkedDigest(input.hostAppImageDigest, 'hostAppImageDigest'),
    serverPlugins: descriptors(input.serverPlugins, 'serverPlugins'),
    defaultPluginPackages: descriptors(input.defaultPluginPackages, 'defaultPluginPackages'),
    staticSystemPromptDigest: checkedDigest(input.staticSystemPromptDigest, 'staticSystemPromptDigest'),
    inventories,
    provisioning: descriptors(input.provisioning, 'provisioning'),
    filesystemBindings: Object.freeze(filesystemBindings),
    policies: Object.freeze({ externalPlugins: input.externalPlugins, pluginAuthoring: input.pluginAuthoring }),
  })
  const identity = Object.freeze({ snapshot, digest: await createAgentAssetDigest(JSON.stringify(snapshot)) })
  issuedCompositionIdentities.set(identity, Object.freeze({
    definitionId: opaqueRef(input.bundle.definition.definitionId, 'bundle.definition.definitionId'),
    version: opaqueRef(input.bundle.definition.version, 'bundle.definition.version'),
    digest: definitionDigest,
  }))
  return identity
}

export function resolveWorkspaceAgentDeployment(
  identity: WorkspaceCompositionIdentityV1,
  bundle: CompiledAgentBundle,
  deployment: AgentDeployment,
  configuredDefaultDeploymentId: string,
): Promise<ResolvedAgent> {
  const issuedDefinition = issuedCompositionIdentities.get(identity)
  if (!issuedDefinition) fail('workspaceCompositionIdentity')
  exactKeys(bundle, ['definition', 'definitionDigest', 'assets'], 'bundle')
  assertRecord(bundle.definition, 'bundle.definition')
  if (
    bundle.definition.definitionId !== issuedDefinition.definitionId ||
    bundle.definition.version !== issuedDefinition.version ||
    bundle.definitionDigest !== issuedDefinition.digest
  ) fail('bundle.definition')
  return resolveAgentDeployment(bundle, deployment, {
    workspaceId: identity.snapshot.workspaceId,
    defaultDeploymentId: opaqueRef(configuredDefaultDeploymentId, 'defaultDeploymentId'),
    workspaceCompositionDigest: identity.digest,
  })
}
