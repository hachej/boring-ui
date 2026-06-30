import {
  MCP_ERROR_CODES,
  McpError,
  redactMcpSecrets,
  type McpActor,
  type McpDiscoveredResource,
  type McpDiscoveredTool,
  type McpSource,
  type McpTransportClient,
} from "../shared"
import {
  type ManagedConnectorConfig,
  type ManagedConnectorProvider,
  type ManagedConnectorSecret,
} from "./managedConnectorAdapter"
import { createMcpSdkStreamableHttpTransport } from "./mcpSdkTransport"

export interface ComposioMcpSession {
  id: string
  mcp: {
    url: string
    headers?: Record<string, string>
  }
}

export interface ComposioManagedConnectorProviderOptions {
  /** Defaults to Composio production API. Override in tests or private deployments. */
  apiBaseUrl?: string
  /** Defaults to global fetch. */
  fetch?: typeof fetch
  /** Optional redirect URL Composio should use after hosted auth completes. */
  callbackUrl?: string
  /** Optional client metadata for the MCP SDK client used during probe/transport calls. */
  clientName?: string
  clientVersion?: string
}

interface CreateSessionInput {
  actor: McpActor
  config: ManagedConnectorConfig
  secret: ManagedConnectorSecret
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

function composioUserId(actor: McpActor): string {
  return `${actor.workspaceId}:${actor.userId}`
}

function providerError(message: string, details?: unknown): McpError {
  return new McpError(MCP_ERROR_CODES.PROVIDER_ERROR, message, redactMcpSecrets(details))
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    throw providerError("Composio returned non-JSON response", { status: response.status })
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function optionalHeaders(value: unknown): Record<string, string> | undefined {
  const candidate = record(value)
  const entries = Object.entries(candidate).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  return entries.length ? Object.fromEntries(entries) : undefined
}

function extractSession(payload: unknown): ComposioMcpSession {
  const root = record(payload)
  const session = record(root.session ?? root.data ?? root)
  const mcp = record(session.mcp)
  const id = optionalString(session.id) ?? optionalString(session.session_id) ?? optionalString(root.id) ?? optionalString(root.session_id)
  const url = optionalString(mcp.url)
  if (!id || !url) throw providerError("Composio session response did not include an MCP session", payload)
  return { id, mcp: { url, headers: optionalHeaders(mcp.headers) } }
}

function extractConnectUrl(payload: unknown): string | undefined {
  const root = record(payload)
  const nested = record(root.data ?? root.connection_request ?? root.link ?? root)
  return optionalString(root.redirect_url)
    ?? optionalString(root.redirectUrl)
    ?? optionalString(root.connect_url)
    ?? optionalString(root.connectUrl)
    ?? optionalString(root.url)
    ?? optionalString(nested.redirect_url)
    ?? optionalString(nested.redirectUrl)
    ?? optionalString(nested.connect_url)
    ?? optionalString(nested.connectUrl)
    ?? optionalString(nested.url)
}

function extractProviderAccountLabel(payload: unknown): string | undefined {
  const root = record(payload)
  const nested = record(root.data ?? root.connected_account ?? root.account ?? root)
  return optionalString(root.providerAccountLabel)
    ?? optionalString(root.provider_account_label)
    ?? optionalString(nested.label)
    ?? optionalString(nested.email)
    ?? optionalString(nested.name)
}

async function composioFetch(options: ComposioManagedConnectorProviderOptions, secret: ManagedConnectorSecret, path: string, body: unknown): Promise<unknown> {
  const fetchImpl = options.fetch ?? globalThis.fetch
  if (!fetchImpl) throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, "fetch is not available for Composio connector")
  const response = await fetchImpl(`${trimTrailingSlash(options.apiBaseUrl ?? "https://backend.composio.dev")}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": secret.value,
    },
    body: JSON.stringify(body),
  })
  const payload = await readJsonResponse(response)
  if (!response.ok) throw providerError("Composio request failed", { status: response.status, payload })
  return payload
}

async function createSession(options: ComposioManagedConnectorProviderOptions, input: CreateSessionInput): Promise<ComposioMcpSession> {
  const payload = await composioFetch(options, input.secret, "/api/v3.1/tool_router/session", {
    user_id: composioUserId(input.actor),
    mcp: true,
    toolkits: [input.config.toolkitId],
    manage_connections: {
      enable: true,
      wait_for_connections: false,
      callback_url: options.callbackUrl,
    },
  })
  return extractSession(payload)
}

async function createLink(options: ComposioManagedConnectorProviderOptions, secret: ManagedConnectorSecret, sessionId: string, config: ManagedConnectorConfig): Promise<unknown> {
  return composioFetch(options, secret, `/api/v3/tool_router/session/${encodeURIComponent(sessionId)}/link`, {
    toolkit: config.toolkitId,
    callback_url: options.callbackUrl,
  })
}

function transportForSession(options: ComposioManagedConnectorProviderOptions, session: ComposioMcpSession): McpTransportClient {
  return createMcpSdkStreamableHttpTransport({
    endpoint: { url: session.mcp.url, headers: session.mcp.headers },
    clientName: options.clientName ?? "boring-mcp-composio",
    clientVersion: options.clientVersion ?? "0.0.0",
  })
}

function safeTools(tools: McpDiscoveredTool[]): McpDiscoveredTool[] {
  return tools.filter((tool) => !tool.name.startsWith("COMPOSIO_"))
}

export function createComposioManagedConnectorProvider(options: ComposioManagedConnectorProviderOptions = {}): ManagedConnectorProvider {
  return {
    async startConnect({ actor, config, secret }) {
      const session = await createSession(options, { actor, config, secret })
      const link = await createLink(options, secret, session.id, config)
      return {
        connectorRef: { provider: config.provider, toolkitId: config.toolkitId, sessionId: session.id },
        status: "unconfigured",
        connectUrl: extractConnectUrl(link),
        providerAccountLabel: extractProviderAccountLabel(link),
      }
    },

    async refreshStatus({ actor, source, config, secret }) {
      const session = await createSession(options, { actor, config, secret })
      return {
        status: source.status === "revoked" ? "revoked" : "connected",
        providerAccountLabel: source.providerAccountLabel,
        lastVerifiedAt: new Date().toISOString(),
        connectorRef: { ...source.connectorRef, provider: config.provider, toolkitId: config.toolkitId, sessionId: session.id },
      }
    },

    async probe({ actor, config, secret }) {
      const session = await createSession(options, { actor, config, secret })
      const transport = transportForSession(options, session)
      const source: McpSource = {
        id: `composio-probe:${actor.workspaceId}:${actor.userId}:${config.provider}`,
        workspaceId: actor.workspaceId,
        userId: actor.userId,
        provider: config.provider,
        displayName: config.displayName,
        status: "connected",
        ownerKind: "user",
        credentialProvider: "composio-managed",
        connectorRef: { provider: config.provider, toolkitId: config.toolkitId, sessionId: session.id },
      }
      const [tools, resources] = await Promise.all([
        transport.listTools(source).then(safeTools),
        transport.listResources(source).catch((): McpDiscoveredResource[] => []),
      ])
      return { tools, resources }
    },
  }
}

export function createComposioMcpTransport(options: ComposioManagedConnectorProviderOptions & {
  secretResolver: { resolveSecret(provider: string): Promise<ManagedConnectorSecret> }
  configs: readonly ManagedConnectorConfig[]
}): McpTransportClient {
  const baseTransport = createMcpSdkStreamableHttpTransport({
    endpoint: async ({ source }) => {
      const config = options.configs.find((entry) => entry.provider === source.provider)
      if (!config) throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, "Unknown Composio MCP provider")
      const secret = await options.secretResolver.resolveSecret(source.provider)
      const session = await createSession(options, { actor: { userId: source.userId, workspaceId: source.workspaceId }, config, secret })
      return { url: session.mcp.url, headers: session.mcp.headers }
    },
    clientName: options.clientName ?? "boring-mcp-composio",
    clientVersion: options.clientVersion ?? "0.0.0",
  })
  return {
    ...baseTransport,
    async listTools(source) {
      return safeTools(await baseTransport.listTools(source))
    },
  }
}
