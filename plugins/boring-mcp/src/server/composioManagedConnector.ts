import {
  MCP_ERROR_CODES,
  McpError,
  getMcpProviderTemplate,
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
  /** Test-only escape hatch for loopback fake MCP servers. Production Composio MCP URLs must be https. */
  allowInsecureMcpUrlsForTests?: boolean
}

export interface ResolveComposioMcpSessionInput {
  actor: McpActor
  config: ManagedConnectorConfig
  secret: ManagedConnectorSecret
}

interface ComposioConnectedAccountSummary {
  id?: string
  label?: string
  active: boolean
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

function composioUserId(actor: McpActor): string {
  return `${actor.workspaceId}:${actor.userId}`
}

function actorForSource(source: McpSource): McpActor {
  return { userId: source.userId, workspaceId: source.workspaceId }
}

function providerError(message: string, details?: unknown): McpError {
  return new McpError(MCP_ERROR_CODES.PROVIDER_ERROR, message, redactMcpSecrets(details))
}

function providerErrorStatus(error: unknown): number | undefined {
  if (!(error instanceof McpError) || error.code !== MCP_ERROR_CODES.PROVIDER_ERROR) return undefined
  const details = record(error.details)
  return typeof details.status === "number" ? details.status : undefined
}

function requireServerSecret(secret: ManagedConnectorSecret): void {
  if ((secret.storage !== "server-env" && secret.storage !== "server-vault") || !secret.value) {
    throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, "Composio connector secret is not configured server-side")
  }
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

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function optionalHeaders(value: unknown): Record<string, string> | undefined {
  const entries = Object.entries(record(value)).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  return entries.length ? Object.fromEntries(entries) : undefined
}

function normalizeComposioMcpUrl(rawUrl: string, options: ComposioManagedConnectorProviderOptions): string {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw providerError("Composio session response included an invalid MCP URL")
  }
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1"
  const allowedInsecureLoopback = options.allowInsecureMcpUrlsForTests && parsed.protocol === "http:" && loopback
  if ((parsed.protocol !== "https:" && !allowedInsecureLoopback) || parsed.username || parsed.password) {
    throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, "Composio MCP URL must be https and must not include credentials")
  }
  return parsed.toString()
}

function extractSession(payload: unknown, options: ComposioManagedConnectorProviderOptions): ComposioMcpSession {
  const root = record(payload)
  const session = record(root.session ?? root.data ?? root)
  const mcp = record(session.mcp)
  const id = optionalString(session.id) ?? optionalString(session.session_id) ?? optionalString(root.id) ?? optionalString(root.session_id)
  const url = optionalString(mcp.url)
  if (!id || !url) throw providerError("Composio session response did not include an MCP session", payload)
  return { id, mcp: { url: normalizeComposioMcpUrl(url, options), headers: optionalHeaders(mcp.headers) } }
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
    ?? optionalString(nested.alias)
}

async function composioRequest(
  options: ComposioManagedConnectorProviderOptions,
  secret: ManagedConnectorSecret,
  method: "DELETE" | "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<unknown> {
  requireServerSecret(secret)
  const fetchImpl = options.fetch ?? globalThis.fetch
  if (!fetchImpl) throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, "fetch is not available for Composio connector")
  const response = await fetchImpl(`${trimTrailingSlash(options.apiBaseUrl ?? "https://backend.composio.dev")}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-api-key": secret.value,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await readJsonResponse(response)
  if (!response.ok) throw providerError("Composio request failed", { status: response.status, payload })
  return payload
}

function composioPost(options: ComposioManagedConnectorProviderOptions, secret: ManagedConnectorSecret, path: string, body: unknown): Promise<unknown> {
  return composioRequest(options, secret, "POST", path, body)
}

function composioGet(options: ComposioManagedConnectorProviderOptions, secret: ManagedConnectorSecret, path: string): Promise<unknown> {
  return composioRequest(options, secret, "GET", path)
}

function composioDelete(options: ComposioManagedConnectorProviderOptions, secret: ManagedConnectorSecret, path: string): Promise<unknown> {
  return composioRequest(options, secret, "DELETE", path)
}

export async function resolveComposioMcpSession(options: ComposioManagedConnectorProviderOptions, input: ResolveComposioMcpSessionInput): Promise<ComposioMcpSession> {
  const payload = await composioPost(options, input.secret, "/api/v3.1/tool_router/session", {
    user_id: composioUserId(input.actor),
    mcp: true,
    toolkits: { enable: [input.config.toolkitId] },
    manage_connections: {
      enable: true,
      enable_wait_for_connections: false,
      callback_url: options.callbackUrl,
    },
  })
  return extractSession(payload, options)
}

async function createLink(options: ComposioManagedConnectorProviderOptions, secret: ManagedConnectorSecret, sessionId: string, config: ManagedConnectorConfig): Promise<unknown> {
  return composioPost(options, secret, `/api/v3/tool_router/session/${encodeURIComponent(sessionId)}/link`, {
    toolkit: config.toolkitId,
    callback_url: options.callbackUrl,
  })
}

function accountIsForConfig(account: Record<string, unknown>, actor: McpActor, config: ManagedConnectorConfig): boolean {
  const toolkit = record(account.toolkit)
  return optionalString(toolkit.slug) === config.toolkitId && optionalString(account.user_id) === composioUserId(actor)
}

function summarizeAccount(account: Record<string, unknown>): ComposioConnectedAccountSummary {
  const status = optionalString(account.status)?.toUpperCase()
  const disabled = account.is_disabled === true || record(account.auth_config).is_disabled === true
  return {
    id: optionalString(account.id) ?? optionalString(account.nanoid) ?? optionalString(account.word_id),
    label: extractProviderAccountLabel(account),
    active: !disabled && (status === "ACTIVE" || status === "CONNECTED" || status === "ENABLED"),
  }
}

async function findConnectedAccount(options: ComposioManagedConnectorProviderOptions, input: ResolveComposioMcpSessionInput): Promise<ComposioConnectedAccountSummary | undefined> {
  const params = new URLSearchParams({ user_id: composioUserId(input.actor), toolkit_slug: input.config.toolkitId })
  const payload = await composioGet(options, input.secret, `/api/v3.1/connected_accounts?${params}`)
  const items = array(record(payload).items)
    .map(record)
    .filter((account) => accountIsForConfig(account, input.actor, input.config))
    .map(summarizeAccount)
  return items.find((account) => account.active) ?? items[0]
}

function composioMcpHeaders(session: ComposioMcpSession, secret: ManagedConnectorSecret): Record<string, string> {
  requireServerSecret(secret)
  return { ...(session.mcp.headers ?? {}), "x-api-key": secret.value }
}

function transportForSession(options: ComposioManagedConnectorProviderOptions, session: ComposioMcpSession, secret: ManagedConnectorSecret): McpTransportClient {
  return createMcpSdkStreamableHttpTransport({
    endpoint: { url: session.mcp.url, headers: composioMcpHeaders(session, secret) },
    clientName: options.clientName ?? "boring-mcp-composio",
    clientVersion: options.clientVersion ?? "0.0.0",
  })
}

const COMPOSIO_SEARCH_TOOLS = "COMPOSIO_SEARCH_TOOLS"
const COMPOSIO_GET_TOOL_SCHEMAS = "COMPOSIO_GET_TOOL_SCHEMAS"
const COMPOSIO_MULTI_EXECUTE_TOOL = "COMPOSIO_MULTI_EXECUTE_TOOL"

function isComposioMetaTool(toolName: string): boolean {
  return toolName.startsWith("COMPOSIO_")
}

function safeTools(tools: McpDiscoveredTool[]): McpDiscoveredTool[] {
  return tools.filter((tool) => !isComposioMetaTool(tool.name))
}

function jsonFromTextContent(value: unknown): unknown {
  const root = record(value)
  const content = array(root.content)
  for (const item of content) {
    const text = optionalString(record(item).text)
    if (!text) continue
    try {
      return JSON.parse(text)
    } catch {
      // Keep scanning: some providers can mix human text and JSON chunks.
    }
  }
  return undefined
}

function concreteAllowedToolSlugs(provider: string): string[] {
  return getMcpProviderTemplate(provider)?.allowedTools.filter((toolName) => !toolName.includes("*")) ?? []
}

function collectComposioToolSlugs(payload: unknown, toolkitId: string): string[] {
  const root = record(jsonFromTextContent(payload) ?? payload)
  const data = record(root.data ?? root)
  const seen = new Set<string>()
  for (const item of array(data.results)) {
    const result = record(item)
    const toolkits = array(result.toolkits).filter((toolkit): toolkit is string => typeof toolkit === "string")
    if (toolkits.length > 0 && !toolkits.some((toolkit) => toolkit.toLowerCase() === toolkitId.toLowerCase())) continue
    for (const slug of [...array(result.primary_tool_slugs), ...array(result.related_tool_slugs)]) {
      if (typeof slug === "string" && slug.trim() && !isComposioMetaTool(slug)) seen.add(slug)
    }
  }
  return [...seen].slice(0, 50)
}

function toolsFromComposioSchemas(payload: unknown, slugs: readonly string[]): McpDiscoveredTool[] {
  const root = record(jsonFromTextContent(payload) ?? payload)
  const data = record(root.data ?? root)
  const schemas = record(data.tool_schemas ?? root.tool_schemas)
  const tools: McpDiscoveredTool[] = []
  for (const slug of slugs) {
    const rawSchema = schemas[slug]
    if (!rawSchema || typeof rawSchema !== "object" || Array.isArray(rawSchema)) continue
    const schema = rawSchema as Record<string, unknown>
    tools.push({
      name: optionalString(schema.tool_slug) ?? slug,
      description: optionalString(schema.description),
      inputSchema: schema.input_schema ?? {},
    })
  }
  return tools
}

async function discoverComposioToolkitTools(input: {
  transport: McpTransportClient
  source: McpSource
  config: ManagedConnectorConfig
  session: ComposioMcpSession
}): Promise<McpDiscoveredTool[]> {
  // Composio's MCP meta tools intentionally use `session` for search and
  // `session_id` for schema/execute; keep these argument names pinned by tests.
  const searchResult = await input.transport.callTool(input.source, COMPOSIO_SEARCH_TOOLS, {
    queries: [input.config.toolkitId],
    session: input.session.id,
  })
  const slugs = [...new Set([
    ...collectComposioToolSlugs(searchResult, input.config.toolkitId),
    ...concreteAllowedToolSlugs(input.source.provider),
  ].filter((toolName) => !isComposioMetaTool(toolName)))]
  if (slugs.length === 0) return []
  const schemaResult = await input.transport.callTool(input.source, COMPOSIO_GET_TOOL_SCHEMAS, {
    tool_slugs: slugs,
    session_id: input.session.id,
  })
  return toolsFromComposioSchemas(schemaResult, slugs)
}

export function createComposioManagedConnectorProvider(options: ComposioManagedConnectorProviderOptions = {}): ManagedConnectorProvider {
  return {
    async startConnect({ actor, config, secret }) {
      const session = await resolveComposioMcpSession(options, { actor, config, secret })
      const link = await createLink(options, secret, session.id, config)
      return {
        connectorRef: { provider: config.provider, toolkitId: config.toolkitId, sessionId: session.id },
        status: "unconfigured",
        connectUrl: extractConnectUrl(link),
        providerAccountLabel: extractProviderAccountLabel(link),
      }
    },

    async refreshStatus({ actor, source, config, secret }) {
      if (source.status === "revoked") {
        return { status: "revoked", providerAccountLabel: source.providerAccountLabel, lastVerifiedAt: source.lastVerifiedAt, connectorRef: source.connectorRef }
      }
      const account = await findConnectedAccount(options, { actor, config, secret })
      if (!account?.active) {
        return {
          status: source.status === "connected" ? "expired" : source.status,
          providerAccountLabel: account?.label ?? source.providerAccountLabel,
          lastVerifiedAt: new Date().toISOString(),
          connectorRef: { ...source.connectorRef, provider: config.provider, toolkitId: config.toolkitId, connectedAccountId: account?.id },
        }
      }
      const session = await resolveComposioMcpSession(options, { actor, config, secret })
      return {
        status: "connected",
        providerAccountLabel: account.label ?? source.providerAccountLabel,
        lastVerifiedAt: new Date().toISOString(),
        connectorRef: { ...source.connectorRef, provider: config.provider, toolkitId: config.toolkitId, sessionId: session.id, connectedAccountId: account.id },
      }
    },

    async probe({ actor, config, secret }) {
      const session = await resolveComposioMcpSession(options, { actor, config, secret })
      const transport = transportForSession(options, session, secret)
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

    async revoke({ actor, source, config, secret }) {
      const connectedAccountId = source.connectorRef?.connectedAccountId ?? (await findConnectedAccount(options, { actor, config, secret }))?.id
      if (!connectedAccountId) return
      try {
        await composioDelete(options, secret, `/api/v3.1/connected_accounts/${encodeURIComponent(connectedAccountId)}`)
      } catch (error) {
        if (providerErrorStatus(error) === 404) return
        throw error
      }
    },
  }
}

const COMPOSIO_TRANSPORT_SESSION_TTL_MS = 5 * 60_000

interface ComposioTransportCacheEntry {
  expiresAt: number
  config: ManagedConnectorConfig
  secret: ManagedConnectorSecret
  session: ComposioMcpSession
  rawTools?: McpDiscoveredTool[]
  toolkitTools?: McpDiscoveredTool[]
}

function providerErrorText(error: unknown): string {
  if (error instanceof McpError) {
    const details = error.details
    if (details && typeof details === "object" && typeof (details as { message?: unknown }).message === "string") return (details as { message: string }).message
  }
  return error instanceof Error ? error.message : String(error)
}

function isUnsupportedResourcesError(error: unknown): boolean {
  const message = providerErrorText(error).toLowerCase()
  return (
    message.includes("does not support resources")
    || message.includes("method not found")
    || (message.includes("resources/list") && (message.includes("not found") || message.includes("unsupported")))
  )
}

export function createComposioMcpTransport(options: ComposioManagedConnectorProviderOptions & {
  secretResolver: { resolveSecret(provider: string): Promise<ManagedConnectorSecret> }
  configs: readonly ManagedConnectorConfig[]
}): McpTransportClient {
  const cache = new Map<string, ComposioTransportCacheEntry>()
  const pendingSessions = new Map<string, Promise<ComposioTransportCacheEntry>>()

  function keyForSource(source: McpSource): string {
    const connector = source.connectorRef
    return [
      source.workspaceId,
      source.userId,
      source.provider,
      source.id,
      source.updatedAt,
      connector?.sessionId ?? "",
      connector?.connectedAccountId ?? "",
      connector?.externalSourceId ?? "",
    ].join(":")
  }

  async function createCacheEntry(source: McpSource): Promise<ComposioTransportCacheEntry> {
    const config = options.configs.find((entry) => entry.provider === source.provider)
    if (!config) throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, "Unknown Composio MCP provider", { reason: "unsupported_provider" })
    const secret = await options.secretResolver.resolveSecret(source.provider)
    const session = await resolveComposioMcpSession(options, { actor: actorForSource(source), config, secret })
    const entry = { config, secret, session, expiresAt: Date.now() + COMPOSIO_TRANSPORT_SESSION_TTL_MS }
    cache.set(keyForSource(source), entry)
    return entry
  }

  function pruneExpiredEntries(now = Date.now()): void {
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(key)
    }
  }

  async function cachedContext(source: McpSource): Promise<{ key: string; entry: ComposioTransportCacheEntry; transport: McpTransportClient }> {
    const key = keyForSource(source)
    const now = Date.now()
    pruneExpiredEntries(now)
    const cached = cache.get(key)
    if (cached && cached.expiresAt > now) {
      return { key, entry: cached, transport: transportForSession(options, cached.session, cached.secret) }
    }
    const pending = pendingSessions.get(key) ?? createCacheEntry(source).finally(() => pendingSessions.delete(key))
    pendingSessions.set(key, pending)
    const entry = await pending
    return { key, entry, transport: transportForSession(options, entry.session, entry.secret) }
  }

  async function rawToolsFor(source: McpSource, entry: ComposioTransportCacheEntry, transport: McpTransportClient): Promise<McpDiscoveredTool[]> {
    if (entry.rawTools) return entry.rawTools
    const tools = await transport.listTools(source)
    entry.rawTools = tools
    return tools
  }

  return {
    async listTools(source, input) {
      const { key, entry, transport } = await cachedContext(source)
      if (input?.forceProviderRefresh) {
        entry.rawTools = undefined
        entry.toolkitTools = undefined
      }
      try {
        const rawTools = await rawToolsFor(source, entry, transport)
        const directTools = safeTools(rawTools)
        if (directTools.length > 0 || !rawTools.some((tool) => tool.name === COMPOSIO_SEARCH_TOOLS) || !rawTools.some((tool) => tool.name === COMPOSIO_GET_TOOL_SCHEMAS)) {
          return directTools
        }
        entry.toolkitTools ??= await discoverComposioToolkitTools({ transport, source, config: entry.config, session: entry.session })
        return entry.toolkitTools
      } catch (error) {
        cache.delete(key)
        throw error
      }
    },

    async listResources(source) {
      const { key, transport } = await cachedContext(source)
      try {
        return await transport.listResources(source)
      } catch (error) {
        if (isUnsupportedResourcesError(error)) return []
        cache.delete(key)
        throw error
      }
    },

    async readResource(source, uri) {
      const { key, transport } = await cachedContext(source)
      try {
        return await transport.readResource(source, uri)
      } catch (error) {
        cache.delete(key)
        throw error
      }
    },

    async callTool(source, toolName, input) {
      if (isComposioMetaTool(toolName)) throw new McpError(MCP_ERROR_CODES.TOOL_NOT_ALLOWED, "Composio MCP management tools are not exposed")
      const { key, entry, transport } = await cachedContext(source)
      try {
        const rawTools = await rawToolsFor(source, entry, transport)
        if (rawTools.some((tool) => tool.name === toolName)) return await transport.callTool(source, toolName, input)
        if (!rawTools.some((tool) => tool.name === COMPOSIO_MULTI_EXECUTE_TOOL)) return await transport.callTool(source, toolName, input)
        return await transport.callTool(source, COMPOSIO_MULTI_EXECUTE_TOOL, {
          tools: [{ tool_slug: toolName, arguments: input && typeof input === "object" ? input : {} }],
          sync_response_to_workbench: false,
          thought: `Execute ${toolName} through governed boring-mcp`,
          current_step: "MCP_READONLY_CALL",
          current_step_metric: "1/1 tools",
          session_id: entry.session.id,
        })
      } catch (error) {
        cache.delete(key)
        throw error
      }
    },
  }
}
