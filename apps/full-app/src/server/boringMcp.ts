import {
  BORING_MCP_PLUGIN_ID,
  DEFAULT_MCP_PROVIDER_TEMPLATES,
  InMemoryMcpRateBudgetGate,
  createBoringMcpAgentBridgeRegistry,
  createBoringMcpServerPlugin,
  createBoringMcpSourceHandlers,
  createComposioManagedConnectorProvider,
  createManagedConnectorAdapter,
  evaluateBoringMcpLaunchGate,
  type BoringMcpLaunchGateResult,
  type ManagedConnectorAdapter,
  type ManagedConnectorProvider,
  type ManagedConnectorSecret,
  type ManagedConnectorSecretResolver,
  type ManagedConnectorSourceRegistry,
  type McpActor,
  type McpProviderId,
  type McpSource,
  type McpSourceRegistry,
  type McpTransportClient,
} from '@hachej/boring-mcp/server'

const DEFAULT_MAX_READONLY_INPUT_BYTES = 64 * 1024
const MAX_READONLY_INPUT_BYTES = 1024 * 1024

export interface FullAppBoringMcpServerConfig {
  enabled: boolean
  composioApiKeyConfigured: boolean
  maxReadonlyInputBytes: number
}

function parseReadonlyInputLimit(value: string | undefined): number {
  if (!value) return DEFAULT_MAX_READONLY_INPUT_BYTES
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_READONLY_INPUT_BYTES) return DEFAULT_MAX_READONLY_INPUT_BYTES
  return parsed
}

export function readFullAppBoringMcpServerConfig(env: NodeJS.ProcessEnv = process.env): FullAppBoringMcpServerConfig {
  return {
    enabled: env.BORING_MCP_ENABLED !== '0',
    composioApiKeyConfigured: Boolean(env.COMPOSIO_API_KEY?.trim()),
    maxReadonlyInputBytes: parseReadonlyInputLimit(env.BORING_MCP_MAX_READONLY_INPUT_BYTES),
  }
}

export function createFullAppManagedConnectorSecretResolver(env: NodeJS.ProcessEnv = process.env): ManagedConnectorSecretResolver {
  return {
    async resolveSecret(provider: McpProviderId): Promise<ManagedConnectorSecret> {
      if (provider !== 'notion' && provider !== 'airtable') throw new Error(`Unsupported MCP provider: ${provider}`)
      const value = env.COMPOSIO_API_KEY?.trim()
      if (!value) throw new Error('COMPOSIO_API_KEY is not configured')
      return { storage: 'server-env', value }
    },
  }
}

const FULL_APP_MCP_REDACTION_CANARIES = ['cmp_full_app_canary'] as const

export function createFullAppManagedConnectorAdapter(options: {
  env?: NodeJS.ProcessEnv
  registry: ManagedConnectorSourceRegistry
  provider?: ManagedConnectorProvider
}): ManagedConnectorAdapter {
  return createManagedConnectorAdapter({
    registry: options.registry,
    provider: options.provider ?? createComposioManagedConnectorProvider(),
    secretResolver: createFullAppManagedConnectorSecretResolver(options.env),
    templates: DEFAULT_MCP_PROVIDER_TEMPLATES,
    redactionCanaries: FULL_APP_MCP_REDACTION_CANARIES,
    configs: [
      { provider: 'notion', displayName: 'Notion', toolkitId: 'notion', connectUrlOrigins: ['https://app.composio.dev'] },
      { provider: 'airtable', displayName: 'Airtable', toolkitId: 'airtable', connectUrlOrigins: ['https://app.composio.dev'] },
    ],
  })
}

export function createFullAppBoringMcpServerPlugins(env: NodeJS.ProcessEnv = process.env) {
  const config = readFullAppBoringMcpServerConfig(env)
  if (!config.enabled) return []
  return [createBoringMcpServerPlugin({
    systemPrompt: 'Sources are available through the app-owned boring-mcp integration. Use governed read-only MCP calls only after search/describe confirms the tool is enabled.',
  })]
}

export const boringMcpServerPlugins = createFullAppBoringMcpServerPlugins()

export function evaluateFullAppBoringMcpLaunchGate(): BoringMcpLaunchGateResult {
  const config = readFullAppBoringMcpServerConfig()
  const actor: McpActor = { workspaceId: 'smoke-workspace', userId: 'smoke-user' }
  const source: McpSource = {
    id: 'source:notion:smoke-user',
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    provider: 'notion',
    displayName: 'Fake Notion',
    status: 'connected',
    ownerKind: 'user',
    credentialProvider: 'composio-managed',
  }
  const registry: McpSourceRegistry = {
    async listSources(requestActor) {
      return requestActor.workspaceId === actor.workspaceId && requestActor.userId === actor.userId ? [source] : []
    },
    async getSource(sourceId) {
      return sourceId === source.id ? source : undefined
    },
    async disconnectSource(_actor, sourceId) {
      return sourceId === source.id ? { ...source, status: 'revoked' } : undefined
    },
  }
  const transport: McpTransportClient = {
    async listTools() {
      return [{ name: 'NOTION_SEARCH_NOTION_PAGE', description: 'Search fake Notion pages', inputSchema: { type: 'object' } }]
    },
    async listResources() {
      return []
    },
    async readResource() {
      return { content: '' }
    },
    async callTool() {
      return { content: [{ type: 'text', text: 'fake ok' }] }
    },
  }
  const hardening = {
    gate: new InMemoryMcpRateBudgetGate({ maxCalls: 100, maxToolCalls: 10, windowMs: 60_000 }),
    timeoutMs: 1000,
  }
  const handlers = createBoringMcpSourceHandlers({
    registry,
    transport,
    templates: DEFAULT_MCP_PROVIDER_TEMPLATES,
    hardening,
    maxReadonlyInputBytes: config.maxReadonlyInputBytes,
  })

  return evaluateBoringMcpLaunchGate({
    pluginId: BORING_MCP_PLUGIN_ID,
    registry,
    transport,
    bridge: createBoringMcpAgentBridgeRegistry(handlers),
    templates: DEFAULT_MCP_PROVIDER_TEMPLATES,
    hardening,
    maxReadonlyInputBytes: config.maxReadonlyInputBytes,
    docsReviewed: true,
  })
}
