import type { CoreWorkspaceAgentServerPlugin } from '@hachej/boring-core/app/server'
import type { CoreConfig } from '@hachej/boring-core/shared'
import { ErrorCode, type Sha256Digest } from '@hachej/boring-agent/shared'
import { createGovernance } from '@hachej/boring-governance/server'
import { createFullAppBoringMcpServerPlugins } from './boringMcp.js'

interface StableContributionDescriptor {
  readonly id: string
  readonly version: string
  readonly contentDigest: Sha256Digest
}

class FullAppPluginCompositionError extends Error {
  readonly code = ErrorCode.enum.PLUGIN_LOAD_FAILED
  readonly details: Readonly<Record<string, string>>

  constructor(details: Record<string, string>) {
    super(ErrorCode.enum.PLUGIN_LOAD_FAILED)
    this.name = 'FullAppPluginCompositionError'
    this.details = Object.freeze({ ...details })
  }
}

const FULL_APP_DEFAULT_PLUGIN_PACKAGE_COMPOSITION = Object.freeze([{
  packageName: '@hachej/boring-automation',
  descriptor: Object.freeze({
    id: 'boring-automation',
    version: '0.1.87',
    contentDigest: 'sha256:5fcd1c7d39c96709d8bff594b8b05a8f57560a820104d5d79242545f31ca23d2',
  } satisfies StableContributionDescriptor),
}])

const FULL_APP_DEFAULT_PLUGIN_PACKAGES = Object.freeze(FULL_APP_DEFAULT_PLUGIN_PACKAGE_COMPOSITION.map((entry) => entry.packageName))
export const FULL_APP_DEFAULT_PLUGIN_PACKAGE_DESCRIPTORS = Object.freeze(FULL_APP_DEFAULT_PLUGIN_PACKAGE_COMPOSITION.map((entry) => entry.descriptor))

export const FULL_APP_GOVERNANCE_PLUGIN_DESCRIPTOR = Object.freeze({
  id: 'full-app-governance',
  version: '0.1.87',
  contentDigest: 'sha256:16dbe21ed64865213eb2f3b2258ab05d9e226e7865a4416e92f8010864afd313',
} satisfies StableContributionDescriptor)

export const FULL_APP_BORING_MCP_PLUGIN_DESCRIPTOR = Object.freeze({
  id: 'boring-mcp',
  version: '0.1.87',
  contentDigest: 'sha256:38fef89ab1994e36425b9144e4280fe33b093a64985bd471814b43c99641cc81',
} satisfies StableContributionDescriptor)

// Freshness test: lexical tracked files -> SHA-256(bytes) per file ->
// SHA-256(each lowercase blob digest plus "\n"). Paths select files only.
interface LiveServerPluginContribution {
  readonly plugin: CoreWorkspaceAgentServerPlugin
  readonly descriptor: StableContributionDescriptor
}

function issueContribution(
  plugin: CoreWorkspaceAgentServerPlugin,
  descriptor: StableContributionDescriptor,
): LiveServerPluginContribution {
  if (plugin.id !== descriptor.id) {
    throw new FullAppPluginCompositionError({ field: 'serverPlugins.descriptor.id' })
  }
  return Object.freeze({ plugin, descriptor })
}

function createBoringMcpContributions(): LiveServerPluginContribution[] {
  return createFullAppBoringMcpServerPlugins().map((plugin) =>
    issueContribution(plugin, FULL_APP_BORING_MCP_PLUGIN_DESCRIPTOR))
}

function composeServerPlugins(
  contributions: readonly LiveServerPluginContribution[],
): Readonly<{ plugins: readonly CoreWorkspaceAgentServerPlugin[]; descriptors: readonly StableContributionDescriptor[] }> {
  return Object.freeze({
    plugins: Object.freeze(contributions.map((contribution) => contribution.plugin)),
    descriptors: Object.freeze(contributions.map((contribution) => contribution.descriptor)),
  })
}

export function createFullAppServerPluginComposition() {
  return composeServerPlugins(createBoringMcpContributions())
}

// Build tooling discovers static plugin assets through this named export.
export const serverPlugins: CoreWorkspaceAgentServerPlugin[] = [
  ...createFullAppServerPluginComposition().plugins,
]
Object.freeze(serverPlugins)

export async function createFullAppHostPluginComposition(config: CoreConfig) {
  const governance = await createGovernance(config)
  const composition = composeServerPlugins([
    ...createBoringMcpContributions(),
    issueContribution(governance.serverPlugin, FULL_APP_GOVERNANCE_PLUGIN_DESCRIPTOR),
  ])
  return Object.freeze({
    governance,
    ...composition,
    defaultPluginPackages: FULL_APP_DEFAULT_PLUGIN_PACKAGES,
    defaultPluginPackageDescriptors: FULL_APP_DEFAULT_PLUGIN_PACKAGE_DESCRIPTORS,
  })
}
