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
const SNAPSHOT_KEYS = ['schemaVersion', 'domain', 'workspaceId', 'runtimeProfile', 'hostAppImageDigest', 'serverPlugins', 'defaultPluginPackages', 'staticSystemPromptDigest', 'inventories', 'provisioning', 'filesystemBindings', 'policies'] as const
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

function descriptors(values: unknown, field: string): readonly StableContributionDescriptor[] {
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

export function canonicalizeWorkspaceCompositionSnapshot(raw: unknown): WorkspaceCompositionSnapshotV1 {
  exactKeys(raw, SNAPSHOT_KEYS, 'compositionSnapshot')
  if (raw.schemaVersion !== 1 || raw.domain !== 'boring-workspace-composition:v1') fail('compositionSnapshot')
  exactKeys(raw.runtimeProfile, PROFILE_KEYS, 'compositionSnapshot.runtimeProfile')
  exactKeys(raw.inventories, INVENTORY_KEYS, 'compositionSnapshot.inventories')
  exactKeys(raw.policies, ['externalPlugins', 'pluginAuthoring'], 'compositionSnapshot.policies')
  if (typeof raw.policies.externalPlugins !== 'boolean') fail('compositionSnapshot.policies.externalPlugins')
  if (typeof raw.policies.pluginAuthoring !== 'boolean') fail('compositionSnapshot.policies.pluginAuthoring')
  if (!Array.isArray(raw.filesystemBindings)) fail('compositionSnapshot.filesystemBindings')
  const filesystemBindings = raw.filesystemBindings.map((binding, index) => {
    exactKeys(binding, ['id', 'access', 'policy'], `compositionSnapshot.filesystemBindings[${index}]`)
    return Object.freeze({
      id: checkedRef(binding.id, `compositionSnapshot.filesystemBindings[${index}].id`),
      access: checkedRef(binding.access, `compositionSnapshot.filesystemBindings[${index}].access`),
      policy: checkedRef(binding.policy, `compositionSnapshot.filesystemBindings[${index}].policy`),
    })
  }).sort(compareId)
  if (new Set(filesystemBindings.map((binding) => binding.id)).size !== filesystemBindings.length) fail('compositionSnapshot.filesystemBindings')
  const profile = raw.runtimeProfile
  const inventories = raw.inventories
  return Object.freeze({
    schemaVersion: 1,
    domain: 'boring-workspace-composition:v1',
    workspaceId: opaqueRef(raw.workspaceId, 'compositionSnapshot.workspaceId'),
    runtimeProfile: Object.freeze({
      ref: checkedRef(profile.ref, 'compositionSnapshot.runtimeProfile.ref'),
      id: checkedRef(profile.id, 'compositionSnapshot.runtimeProfile.id'),
      version: checkedRef(profile.version, 'compositionSnapshot.runtimeProfile.version'),
      contentDigest: checkedDigest(profile.contentDigest, 'compositionSnapshot.runtimeProfile.contentDigest'),
      isolationAttestationDigest: checkedDigest(profile.isolationAttestationDigest, 'compositionSnapshot.runtimeProfile.isolationAttestationDigest'),
      workspaceRootPolicyRef: checkedRef(profile.workspaceRootPolicyRef, 'compositionSnapshot.runtimeProfile.workspaceRootPolicyRef'),
      sessionRootPolicyRef: checkedRef(profile.sessionRootPolicyRef, 'compositionSnapshot.runtimeProfile.sessionRootPolicyRef'),
    }),
    hostAppImageDigest: checkedDigest(raw.hostAppImageDigest, 'compositionSnapshot.hostAppImageDigest'),
    serverPlugins: descriptors(raw.serverPlugins, 'compositionSnapshot.serverPlugins'),
    defaultPluginPackages: descriptors(raw.defaultPluginPackages, 'compositionSnapshot.defaultPluginPackages'),
    staticSystemPromptDigest: checkedDigest(raw.staticSystemPromptDigest, 'compositionSnapshot.staticSystemPromptDigest'),
    inventories: Object.freeze({
      capabilities: inventory(inventories.capabilities as readonly string[] | null, 'compositionSnapshot.inventories.capabilities'),
      tools: inventory(inventories.tools as readonly string[] | null, 'compositionSnapshot.inventories.tools'),
      skills: inventory(inventories.skills as readonly string[] | null, 'compositionSnapshot.inventories.skills'),
      mcpServers: inventory(inventories.mcpServers as readonly string[] | null, 'compositionSnapshot.inventories.mcpServers'),
    }),
    provisioning: descriptors(raw.provisioning, 'compositionSnapshot.provisioning'),
    filesystemBindings: Object.freeze(filesystemBindings),
    policies: Object.freeze({ externalPlugins: raw.policies.externalPlugins, pluginAuthoring: raw.policies.pluginAuthoring }),
  })
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
  const snapshot = canonicalizeWorkspaceCompositionSnapshot({
    schemaVersion: 1,
    domain: 'boring-workspace-composition:v1',
    workspaceId: input.workspaceId,
    runtimeProfile: input.runtimeProfile,
    hostAppImageDigest: input.hostAppImageDigest,
    serverPlugins: input.serverPlugins,
    defaultPluginPackages: input.defaultPluginPackages,
    staticSystemPromptDigest: input.staticSystemPromptDigest,
    inventories,
    provisioning: input.provisioning,
    filesystemBindings: input.filesystemBindings,
    policies: { externalPlugins: input.externalPlugins, pluginAuthoring: input.pluginAuthoring },
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
