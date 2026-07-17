import {
  createBoringMcpAppBindings,
  createManagedConnectorSecretResolver,
  type BoringMcpAppBindingsConfig,
  type BoringMcpServerRuntimeConfig,
  type ManagedConnectorConfig,
  type ManagedConnectorSecretResolver,
  type McpTransportClient,
} from '@hachej/boring-mcp/server'

// full-app supplies only its deployment-specific configuration; all glue lives
// in @hachej/boring-mcp/server so tenant deployments import instead of copy.
const FULL_APP_MANAGED_CONNECTOR_CONFIGS: readonly ManagedConnectorConfig[] = [
  { provider: 'notion', displayName: 'Notion', toolkitId: 'notion', connectUrlOrigins: ['https://app.composio.dev', 'https://connect.composio.dev'] },
  { provider: 'airtable', displayName: 'Airtable', toolkitId: 'airtable', connectUrlOrigins: ['https://app.composio.dev', 'https://connect.composio.dev'] },
]

const FULL_APP_MCP_CONFIG: BoringMcpAppBindingsConfig = {
  connectorConfigs: FULL_APP_MANAGED_CONNECTOR_CONFIGS,
  redactionCanaries: ['cmp_full_app_canary'],
  clientName: 'boring-full-app-mcp',
  clientVersion: '0.0.0',
  whenDisabled: 'skip',
  systemPrompt:
    'MCP providers are available through the app-owned boring-mcp integration. Use governed read-only MCP calls only after search/describe confirms the tool is enabled.',
}

// A single factory call replaces the nine per-app forwarding wrappers full-app
// used to carry; the exports below preserve the names call sites already import.
const fullAppMcpBindings = createBoringMcpAppBindings(FULL_APP_MCP_CONFIG)

export type FullAppBoringMcpServerConfig = BoringMcpServerRuntimeConfig
export interface CreateFullAppBoringMcpAgentToolsOptions {
  env?: NodeJS.ProcessEnv
  transport?: McpTransportClient
}

export const readFullAppBoringMcpServerConfig = fullAppMcpBindings.readConfig
export const createFullAppManagedConnectorAdapter = fullAppMcpBindings.createConnectorAdapter
export const fullAppAgentSessionNamespace = fullAppMcpBindings.agentSessionNamespace
export const createFullAppMcpSourceRegistry = fullAppMcpBindings.createMcpSourceRegistry
export const createFullAppBoringMcpAgentTools = fullAppMcpBindings.createAgentTools
export const createFullAppBoringMcpAgentToolsForRequest = fullAppMcpBindings.createAgentToolsForRequest
export const registerFullAppBoringMcpRoutes = fullAppMcpBindings.registerRoutes
export const createFullAppBoringMcpServerPlugins = fullAppMcpBindings.createServerPlugins

// Retains the optional `configs` override that full-app tests exercise (deriving
// supported providers from an arbitrary connector set), which the pre-bound
// factory member intentionally does not expose.
export function createFullAppManagedConnectorSecretResolver(
  env: NodeJS.ProcessEnv = process.env,
  configs: readonly ManagedConnectorConfig[] = FULL_APP_MANAGED_CONNECTOR_CONFIGS,
): ManagedConnectorSecretResolver {
  return createManagedConnectorSecretResolver({ env, configs, secretEnvVars: FULL_APP_MCP_CONFIG.secretEnvVars })
}

export const boringMcpServerPlugins = createFullAppBoringMcpServerPlugins()
