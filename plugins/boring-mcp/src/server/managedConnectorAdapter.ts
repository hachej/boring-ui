import {
  MCP_ERROR_CODES,
  McpError,
  classifyMcpTool,
  containsMcpSecret,
  getMcpProviderTemplate,
  type McpActor,
  type McpConnectorRef,
  type McpDiscoveredResource,
  type McpDiscoveredTool,
  type McpErrorCode,
  type McpProviderId,
  type McpProviderTemplate,
  type McpProbeResult,
  type McpSource,
  type McpSourceRegistry,
  type McpSourceStatus,
  type McpSourceStatusPayload,
} from "../shared"
import type {
  ManagedConnectorPreflightEvidence,
  ManagedConnectorSecretStorage,
} from "./managedConnectorPreflight"
import { createMcpSourceStatusPayload, requireActorOwnedMcpSource, validateMcpSourceId } from "./sourceAccess"

export interface ManagedConnectorSecret {
  storage: ManagedConnectorSecretStorage
  value: string
}

export interface ManagedConnectorSecretResolver {
  resolveSecret(provider: McpProviderId): Promise<ManagedConnectorSecret>
}

export interface ManagedConnectorConfig {
  provider: McpProviderId
  displayName: string
  toolkitId: string
  scopes?: readonly string[]
  connectUrlOrigins?: readonly string[]
}

export interface ManagedConnectorSourceRegistry extends McpSourceRegistry {
  upsertSource(actor: McpActor, source: McpSource): Promise<McpSource>
}

export interface ManagedConnectorStartInput {
  provider: McpProviderId
  displayName?: string
}

export interface ManagedConnectorStartResponse {
  connectorRef: McpConnectorRef
  status?: McpSourceStatus
  connectUrl?: string
  providerAccountLabel?: string
}

export interface ManagedConnectorStatusResponse {
  status: McpSourceStatus
  providerAccountLabel?: string
  lastVerifiedAt?: string
  connectorRef?: McpConnectorRef
}

export interface ManagedConnectorProbeResponse {
  tools: McpDiscoveredTool[]
  resources: McpDiscoveredResource[]
}

export interface ManagedConnectorProvider {
  startConnect(args: { actor: McpActor; config: ManagedConnectorConfig; secret: ManagedConnectorSecret; sourceId: string }): Promise<ManagedConnectorStartResponse>
  refreshStatus(args: { actor: McpActor; source: McpSource; config: ManagedConnectorConfig; secret: ManagedConnectorSecret }): Promise<ManagedConnectorStatusResponse>
  probe(args: { actor: McpActor; source: McpSource; config: ManagedConnectorConfig; secret: ManagedConnectorSecret }): Promise<ManagedConnectorProbeResponse>
}

export interface ManagedConnectorAdapterOptions {
  registry: ManagedConnectorSourceRegistry
  provider: ManagedConnectorProvider
  secretResolver: ManagedConnectorSecretResolver
  configs: readonly ManagedConnectorConfig[]
  preflightEvidence?: ManagedConnectorPreflightEvidence
  templates?: readonly McpProviderTemplate[]
  redactionCanaries?: readonly string[]
  sourceIdFactory?: (actor: McpActor, config: ManagedConnectorConfig) => string
}

export interface ManagedConnectorAdapter {
  startConnect(actor: McpActor, input: ManagedConnectorStartInput): Promise<ManagedConnectorStartResult>
  refreshStatus(actor: McpActor, sourceId: string): Promise<McpSourceStatusPayload>
  probeSource(actor: McpActor, sourceId: string): Promise<McpProbeResult>
}

export interface ManagedConnectorStartResult extends McpSourceStatusPayload {
  connectUrl?: string
}

function findConfig(configs: readonly ManagedConnectorConfig[], provider: McpProviderId): ManagedConnectorConfig | undefined {
  return configs.find((config) => config.provider === provider)
}

function defaultSourceId(actor: McpActor, config: ManagedConnectorConfig): string {
  return validateMcpSourceId(`managed:${actor.workspaceId}:${actor.userId}:${config.provider}`)
}

function containsCanary(value: unknown, canaries: readonly string[]): boolean {
  if (typeof value === "string") return canaries.some((canary) => canary.trim() && value.includes(canary))
  if (Array.isArray(value)) return value.some((item) => containsCanary(item, canaries))
  if (!value || typeof value !== "object") return false
  return Object.entries(value).some(([key, nested]) => containsCanary(key, canaries) || containsCanary(nested, canaries))
}

function assertSecretFree(value: unknown, canaries: readonly string[], code: McpErrorCode = MCP_ERROR_CODES.SECRET_LEAK_GUARD): void {
  if (containsMcpSecret(value) || containsCanary(value, canaries)) {
    throw new McpError(code, "Managed connector response contained secret material")
  }
}

function safeConnectUrl(rawUrl: string | undefined, config: ManagedConnectorConfig): string | undefined {
  if (!rawUrl) return undefined
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, "Managed connector returned an invalid connect URL")
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, "Managed connector returned an unsafe connect URL")
  }
  if (config.connectUrlOrigins?.length && !config.connectUrlOrigins.includes(parsed.origin)) {
    throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, "Managed connector returned an unapproved connect URL origin")
  }
  return parsed.toString()
}

export function createManagedConnectorAdapter(options: ManagedConnectorAdapterOptions): ManagedConnectorAdapter {
  const canaries = [...(options.preflightEvidence?.redactionCanaries ?? []), ...(options.redactionCanaries ?? [])]
  const templates = options.templates

  async function getSecret(provider: McpProviderId): Promise<ManagedConnectorSecret> {
    const secret = await options.secretResolver.resolveSecret(provider)
    if ((secret.storage !== "server-env" && secret.storage !== "server-vault") || !secret.value) {
      throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, "Managed connector secret is not configured")
    }
    return secret
  }

  function requireConfig(provider: McpProviderId): ManagedConnectorConfig {
    const config = findConfig(options.configs, provider)
    const template = getMcpProviderTemplate(provider, templates)
    if (!config || !template) throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, "Unknown managed connector provider")
    return config
  }

  return {
    async startConnect(actor, input) {
      const config = requireConfig(input.provider)
      const sourceId = validateMcpSourceId((options.sourceIdFactory ?? defaultSourceId)(actor, config))
      const secret = await getSecret(config.provider)
      const secretCanaries = [...canaries, secret.value]
      const response = await options.provider.startConnect({ actor, config, secret, sourceId })
      const connectUrl = safeConnectUrl(response.connectUrl, config)
      assertSecretFree({ ...response, connectUrl }, secretCanaries)
      const source: McpSource = {
        id: sourceId,
        workspaceId: actor.workspaceId,
        userId: actor.userId,
        provider: config.provider,
        displayName: input.displayName ?? config.displayName,
        status: response.status === "connected" ? "unconfigured" : (response.status ?? "unconfigured"),
        ownerKind: "user",
        credentialProvider: "composio-managed",
        scopes: config.scopes ? [...config.scopes] : undefined,
        providerAccountLabel: response.providerAccountLabel,
        connectorRef: response.connectorRef,
      }
      assertSecretFree(source, secretCanaries)
      const saved = await options.registry.upsertSource(actor, source)
      assertSecretFree(saved, secretCanaries)
      return { ...createMcpSourceStatusPayload(saved), connectUrl }
    },

    async refreshStatus(actor, sourceId) {
      const source = await requireActorOwnedMcpSource(options.registry, actor, sourceId)
      const config = requireConfig(source.provider)
      const secret = await getSecret(config.provider)
      const secretCanaries = [...canaries, secret.value]
      const response = await options.provider.refreshStatus({ actor, source, config, secret })
      assertSecretFree(response, secretCanaries)
      const saved = await options.registry.upsertSource(actor, {
        ...source,
        status: response.status,
        providerAccountLabel: response.providerAccountLabel ?? source.providerAccountLabel,
        connectorRef: response.connectorRef ?? source.connectorRef,
        lastVerifiedAt: response.lastVerifiedAt,
      })
      assertSecretFree(saved, secretCanaries)
      return createMcpSourceStatusPayload(saved)
    },

    async probeSource(actor, sourceId) {
      const source = await requireActorOwnedMcpSource(options.registry, actor, sourceId)
      if (source.status !== "connected") throw new McpError(MCP_ERROR_CODES.SOURCE_UNAVAILABLE, "MCP source is not connected")
      const config = requireConfig(source.provider)
      const template = getMcpProviderTemplate(source.provider, templates)
      if (!template) throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, "Unknown managed connector provider")
      const secret = await getSecret(config.provider)
      const response = await options.provider.probe({ actor, source, config, secret })
      assertSecretFree(response, [...canaries, secret.value])
      const result = {
        sourceId: source.id,
        provider: source.provider,
        tools: response.tools.map((tool) => ({ ...tool, decision: classifyMcpTool(template, tool.name) })),
        resources: response.resources,
      }
      assertSecretFree(result, [...canaries, secret.value])
      return result
    },
  }
}
