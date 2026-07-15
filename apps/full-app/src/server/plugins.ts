import type { CoreWorkspaceAgentServerPlugin } from '@hachej/boring-core/app/server'
import type { CoreConfig } from '@hachej/boring-core/shared'
import { createGovernance } from '@hachej/boring-governance/server'
import { createFullAppBoringMcpServerPlugins } from './boringMcp.js'
import {
  D1HostError,
  D1HostErrorCode,
} from './deployment/d1Plan.js'
import type { StableContributionDescriptor } from './deployment/workspaceComposition.js'

const FULL_APP_DEFAULT_PLUGIN_PACKAGE_COMPOSITION = Object.freeze([{
  packageName: '@hachej/boring-automation',
  descriptor: Object.freeze({
    id: 'boring-automation',
    version: '0.1.86',
    contentDigest: 'sha256:d6f43891e5c9c3d40beb0eb7953b53c12b92c7595c4ed54758f468687903d9ed',
  } satisfies StableContributionDescriptor),
}])

const FULL_APP_DEFAULT_PLUGIN_PACKAGES = Object.freeze(FULL_APP_DEFAULT_PLUGIN_PACKAGE_COMPOSITION.map((entry) => entry.packageName))
export const FULL_APP_DEFAULT_PLUGIN_PACKAGE_DESCRIPTORS = Object.freeze(FULL_APP_DEFAULT_PLUGIN_PACKAGE_COMPOSITION.map((entry) => entry.descriptor))

export const FULL_APP_GOVERNANCE_PLUGIN_DESCRIPTOR = Object.freeze({
  id: 'full-app-governance',
  version: '0.1.86',
  contentDigest: 'sha256:16dbe21ed64865213eb2f3b2258ab05d9e226e7865a4416e92f8010864afd313',
} satisfies StableContributionDescriptor)

export const FULL_APP_BORING_MCP_PLUGIN_DESCRIPTOR = Object.freeze({
  id: 'boring-mcp',
  version: '0.1.86',
  contentDigest: 'sha256:ec866b7c39a657ffd860e58ad759abf5a572cbed0e532eb8a60e179bb4bf2426',
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
    throw new D1HostError(D1HostErrorCode.PLAN_INVALID, { field: 'serverPlugins.descriptor.id' })
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
