import type { FastifyRequest } from 'fastify'
import type { CoreWorkspaceAgentServer } from '@hachej/boring-core/app/server'
import {
  boringMcpAgentSessionNamespace,
  createBoringMcpAppAgentTools,
  createBoringMcpAppAgentToolsForRequest,
  createBoringMcpManagedConnectorAdapter,
  createBoringMcpServerPlugin,
  createManagedConnectorSecretResolver,
  createUserSettingsMcpSourceRegistry,
  readBoringMcpServerConfig,
  registerBoringMcpRoutes,
  type BoringMcpBindingConfig,
  type BoringMcpServerRuntimeConfig,
  type ManagedConnectorAdapter,
  type ManagedConnectorConfig,
  type ManagedConnectorProvider,
  type ManagedConnectorSecretResolver,
  type ManagedConnectorSourceRegistry,
  type McpActor,
  type McpTransportClient,
} from '@hachej/boring-mcp/server'
import type { AgentTool } from '@hachej/boring-workspace'

// full-app supplies only its deployment-specific configuration; all glue lives
// in @hachej/boring-mcp/server so tenant deployments import instead of copy.
const FULL_APP_MANAGED_CONNECTOR_CONFIGS: readonly ManagedConnectorConfig[] = [
  { provider: 'notion', displayName: 'Notion', toolkitId: 'notion', connectUrlOrigins: ['https://app.composio.dev', 'https://connect.composio.dev'] },
  { provider: 'airtable', displayName: 'Airtable', toolkitId: 'airtable', connectUrlOrigins: ['https://app.composio.dev', 'https://connect.composio.dev'] },
]

const FULL_APP_BORING_MCP_CONFIG: BoringMcpBindingConfig = {
  connectorConfigs: FULL_APP_MANAGED_CONNECTOR_CONFIGS,
  redactionCanaries: ['cmp_full_app_canary'],
  clientName: 'boring-full-app-mcp',
  clientVersion: '0.0.0',
}

export type FullAppBoringMcpServerConfig = BoringMcpServerRuntimeConfig

export function readFullAppBoringMcpServerConfig(env: NodeJS.ProcessEnv = process.env): FullAppBoringMcpServerConfig {
  return readBoringMcpServerConfig(env, { secretEnvVars: FULL_APP_BORING_MCP_CONFIG.secretEnvVars })
}

export function createFullAppManagedConnectorSecretResolver(
  env: NodeJS.ProcessEnv = process.env,
  configs: readonly ManagedConnectorConfig[] = FULL_APP_MANAGED_CONNECTOR_CONFIGS,
): ManagedConnectorSecretResolver {
  return createManagedConnectorSecretResolver({ env, configs, secretEnvVars: FULL_APP_BORING_MCP_CONFIG.secretEnvVars })
}

export function createFullAppManagedConnectorAdapter(options: {
  env?: NodeJS.ProcessEnv
  registry: ManagedConnectorSourceRegistry
  provider?: ManagedConnectorProvider
}): ManagedConnectorAdapter {
  return createBoringMcpManagedConnectorAdapter({
    config: FULL_APP_BORING_MCP_CONFIG,
    registry: options.registry,
    provider: options.provider,
    env: options.env,
  })
}

export function fullAppAgentSessionNamespace(ctx: { workspaceId: string; request?: FastifyRequest; userId?: string }): string {
  return boringMcpAgentSessionNamespace(ctx)
}

export function createFullAppMcpSourceRegistry(
  app: Pick<CoreWorkspaceAgentServer, 'userStore' | 'config'>,
  actorScope: McpActor,
): ManagedConnectorSourceRegistry {
  return createUserSettingsMcpSourceRegistry(app, actorScope)
}

export interface CreateFullAppBoringMcpAgentToolsOptions {
  env?: NodeJS.ProcessEnv
  transport?: McpTransportClient
}

export function createFullAppBoringMcpAgentTools(
  app: Pick<CoreWorkspaceAgentServer, 'userStore' | 'config'>,
  actor: McpActor,
  options: CreateFullAppBoringMcpAgentToolsOptions = {},
): AgentTool[] {
  return createBoringMcpAppAgentTools(app, actor, { config: FULL_APP_BORING_MCP_CONFIG, ...options })
}

export function createFullAppBoringMcpAgentToolsForRequest(
  app: Pick<CoreWorkspaceAgentServer, 'userStore' | 'config'>,
  ctx: { workspaceId: string; authSubject?: string },
  options: CreateFullAppBoringMcpAgentToolsOptions = {},
): AgentTool[] {
  return createBoringMcpAppAgentToolsForRequest(app, ctx, { config: FULL_APP_BORING_MCP_CONFIG, ...options })
}

export function registerFullAppBoringMcpRoutes(
  app: CoreWorkspaceAgentServer,
  options: { provider?: ManagedConnectorProvider; env?: NodeJS.ProcessEnv; transport?: McpTransportClient } = {},
): void {
  registerBoringMcpRoutes(app, {
    config: FULL_APP_BORING_MCP_CONFIG,
    resolveTrustedWorkspaceId: (request) => request.requestScope?.workspaceId,
    ...options,
  })
}

export function createFullAppBoringMcpServerPlugins(env: NodeJS.ProcessEnv = process.env) {
  const config = readFullAppBoringMcpServerConfig(env)
  if (!config.enabled) return []
  return [createBoringMcpServerPlugin({
    systemPrompt: 'MCP providers are available through the app-owned boring-mcp integration. Use governed read-only MCP calls only after search/describe confirms the tool is enabled.',
  })]
}

export const boringMcpServerPlugins = createFullAppBoringMcpServerPlugins()
