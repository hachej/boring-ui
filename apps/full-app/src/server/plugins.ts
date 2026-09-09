import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { createFactoryAutomationSeedProvider } from './factoryAutomationSeeds.js'
import type { Automation } from '@hachej/boring-automation/server'
import type { CoreWorkspaceAgentServerPlugin, CoreWorkspacePluginEntry } from '@hachej/boring-core/app/server'
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

// Automation is composed explicitly below because its host-owned seed provider
// cannot be represented by a package-name default without double registration.
const FULL_APP_DEFAULT_PLUGIN_PACKAGE_COMPOSITION: readonly {
  packageName: string
  descriptor: StableContributionDescriptor
}[] = Object.freeze([])

const FULL_APP_DEFAULT_PLUGIN_PACKAGES = Object.freeze(FULL_APP_DEFAULT_PLUGIN_PACKAGE_COMPOSITION.map((entry) => entry.packageName))
const require = createRequire(import.meta.url)
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

export function resolveFullAppFactoryPolicyRoot(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  return env.BORING_FACTORY_POLICY_ROOT?.trim() || cwd
}

export function isFullAppFactoryAutomation(automation: Automation): boolean {
  return automation.promptRef === '.agents/automation/orchestrator-tick.md'
    || automation.promptRef === '.agents/automation/triage.md'
    || /^\.agents\/automation\/worker-slot-[1-9][0-9]*\.md$/.test(automation.promptRef)
}

export function createFullAppAutomationPluginEntry(
  policyRoot: string = resolveFullAppFactoryPolicyRoot(),
): CoreWorkspacePluginEntry {
  return {
    dir: dirname(require.resolve('@hachej/boring-automation/package.json')),
    hotReload: false,
    trust: 'internal',
    options: {
      seedProvider: createFactoryAutomationSeedProvider({
        policyRoot,
        warn: (message) => console.warn(message),
      }),
      canUpdateAutomationModel: (automation: Automation) => !isFullAppFactoryAutomation(automation),
    },
  }
}

export async function createFullAppHostPluginComposition(config: CoreConfig) {
  // Blaxel/current hosted modes have no qualified dedicated-identity private
  // channel. App-level enablement therefore fails at boot rather than composing
  // a shared-namespace browser or silently downgrading isolation.
  if (process.env.BORING_BROWSER_ENABLED === '1') {
    throw new FullAppPluginCompositionError({
      field: 'browser.trusted-service-v1',
      reason: 'hosted-provider-unqualified',
    })
  }
  const governance = await createGovernance(config)
  const composition = composeServerPlugins([
    ...createBoringMcpContributions(),
    issueContribution(governance.serverPlugin, FULL_APP_GOVERNANCE_PLUGIN_DESCRIPTOR),
  ])
  const automationPlugin = createFullAppAutomationPluginEntry()
  return Object.freeze({
    governance,
    ...composition,
    plugins: Object.freeze([...composition.plugins, automationPlugin]),
    defaultPluginPackages: FULL_APP_DEFAULT_PLUGIN_PACKAGES,
    defaultPluginPackageDescriptors: FULL_APP_DEFAULT_PLUGIN_PACKAGE_DESCRIPTORS,
  })
}
