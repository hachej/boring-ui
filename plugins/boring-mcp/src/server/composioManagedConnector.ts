import {
  MCP_ERROR_CODES,
  McpError,
  containsMcpSecretOrCanary,
  getMcpProviderTemplate,
  redactMcpSecrets,
  validateMcpToolName,
  type McpActor,
  type McpDiscoveredResource,
  type McpDiscoveredTool,
  type McpSource,
  type McpTransportClient,
} from "../shared"
import {
  isFullCatalogManagedConnectorConfig,
  type ManagedConnectorDefinition,
  type ManagedConnectorProvider,
  type ManagedConnectorSecret,
} from "./managedConnectorAdapter"
import type { McpManagedCatalogAdapter } from "./toolCatalog"
import { createMcpSdkStreamableHttpTransport } from "./mcpSdkTransport"

export interface ComposioMcpSession {
  id: string
  mcp: {
    url: string
    headers?: Record<string, string>
  }
  config?: Record<string, unknown>
}

export interface ComposioManagedConnectorProviderOptions {
  /** Defaults to Composio production API. Override in tests or private deployments. */
  apiBaseUrl?: string
  /** Defaults to global fetch and is used for Composio REST API calls. */
  fetch?: typeof fetch
  /** Defaults to global fetch and is used for guarded MCP transport calls. */
  mcpFetch?: typeof fetch
  /** Optional redirect URL Composio should use after hosted auth completes. */
  callbackUrl?: string
  /** Optional client metadata for the MCP SDK client used during probe/transport calls. */
  clientName?: string
  clientVersion?: string
  /** Exact approved Composio API origins that may receive the operator key. */
  apiUrlOrigins?: readonly string[]
  /** Exact approved MCP origins that may receive the Composio operator key. */
  mcpUrlOrigins?: readonly string[]
  requestTimeoutMs?: number
  maxResponseBytes?: number
  /** Test-only escape hatch for loopback fake MCP servers. Production Composio MCP URLs must be https. */
  allowInsecureMcpUrlsForTests?: boolean
}

export interface ComposioAccountPin {
  toolkitId: string
  connectedAccountId: string
}

export interface ResolveComposioMcpSessionInput {
  actor: McpActor
  config: ManagedConnectorDefinition
  secret: ManagedConnectorSecret
  accountPin?: ComposioAccountPin
}

export interface ComposioConnectedAccountSummary {
  id: string
  label?: string
  active: boolean
}

const DEFAULT_COMPOSIO_MCP_ORIGINS = ["https://backend.composio.dev"] as const
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024
const MAX_CONNECTED_ACCOUNT_RESULTS = 100

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

function composioUserId(actor: McpActor): string {
  return `${actor.workspaceId}:${actor.userId}`
}

function actorForSource(source: McpSource): McpActor {
  return { userId: source.userId, workspaceId: source.workspaceId }
}

function redactExactCanaries(value: unknown, canaries: readonly string[]): unknown {
  const exact = canaries.filter(Boolean)
  if (typeof value === "string") {
    return exact.reduce((result, canary) => result.split(canary).join("[REDACTED_MCP_SECRET]"), value)
  }
  if (Array.isArray(value)) return value.map((entry) => redactExactCanaries(entry, exact))
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    redactExactCanaries(key, exact) as string,
    redactExactCanaries(nested, exact),
  ]))
}

function providerError(message: string, details?: unknown, canaries: readonly string[] = []): McpError {
  const exactRedacted = containsMcpSecretOrCanary(details, canaries) ? redactExactCanaries(details, canaries) : details
  return new McpError(MCP_ERROR_CODES.PROVIDER_ERROR, message, redactMcpSecrets(exactRedacted))
}

function sanitizeMcpErrorWithCanaries(error: unknown, canaries: readonly string[], fallbackMessage: string): McpError {
  if (error instanceof McpError) {
    return new McpError(
      error.code,
      redactExactCanaries(error.message, canaries) as string,
      redactMcpSecrets(redactExactCanaries(error.details, canaries)),
    )
  }
  return providerError(fallbackMessage, error, canaries)
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

async function readJsonResponse(response: Response, maxBytes: number, controller: AbortController): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    controller.abort()
    throw providerError("Composio response exceeded the configured size limit", { status: response.status })
  }
  const reader = response.body?.getReader()
  if (!reader) return undefined
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > maxBytes) {
      await reader.cancel().catch(() => undefined)
      controller.abort()
      throw providerError("Composio response exceeded the configured size limit", { status: response.status })
    }
    chunks.push(value)
  }
  if (length === 0) return undefined
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw providerError("Composio returned non-JSON response", { status: response.status })
  }
}

function boundedResponseBody(response: Response, maxBytes: number, controller: AbortController): Response {
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    controller.abort()
    throw providerError("Composio MCP response exceeded the configured size limit", { status: response.status })
  }
  if (!response.body) return response
  const reader = response.body.getReader()
  let length = 0
  const body = new ReadableStream<Uint8Array>({
    async pull(streamController) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          streamController.close()
          return
        }
        length += value.byteLength
        if (length > maxBytes) {
          await reader.cancel().catch(() => undefined)
          controller.abort()
          streamController.error(providerError("Composio MCP response exceeded the configured size limit", { status: response.status }))
          return
        }
        streamController.enqueue(value)
      } catch (error) {
        streamController.error(controller.signal.aborted
          ? new McpError(MCP_ERROR_CODES.PROVIDER_TIMEOUT, "Composio MCP request timed out")
          : error)
      }
    },
    async cancel(reason) {
      controller.abort(reason)
      await reader.cancel(reason).catch(() => undefined)
    },
  })
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
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
  const approvedOrigins = options.mcpUrlOrigins ?? DEFAULT_COMPOSIO_MCP_ORIGINS
  if (!allowedInsecureLoopback && !approvedOrigins.includes(parsed.origin)) {
    throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, "Composio MCP URL origin is not approved")
  }
  return parsed.toString()
}

function rawSessionIdentity(payload: unknown): { id?: string; canaries: string[] } {
  const root = record(payload)
  const session = record(root.session ?? root.data ?? root)
  const mcp = record(session.mcp)
  const id = optionalString(session.id) ?? optionalString(session.session_id) ?? optionalString(root.id) ?? optionalString(root.session_id)
  const canaries = [id, optionalString(mcp.url), ...Object.values(optionalHeaders(mcp.headers) ?? {})]
    .filter((value): value is string => Boolean(value))
  return { id, canaries }
}

function extractSession(payload: unknown, options: ComposioManagedConnectorProviderOptions, canaries: readonly string[] = []): ComposioMcpSession {
  const root = record(payload)
  const session = record(root.session ?? root.data ?? root)
  const mcp = record(session.mcp)
  const id = optionalString(session.id) ?? optionalString(session.session_id) ?? optionalString(root.id) ?? optionalString(root.session_id)
  const url = optionalString(mcp.url)
  if (!id || !url) throw providerError("Composio session response did not include an MCP session", payload, canaries)
  return {
    id,
    mcp: { url: normalizeComposioMcpUrl(url, options), headers: optionalHeaders(mcp.headers) },
    config: record(session.config ?? root.config),
  }
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

function normalizeComposioApiBaseUrl(options: ComposioManagedConnectorProviderOptions): string {
  let parsed: URL
  try {
    parsed = new URL(options.apiBaseUrl ?? "https://backend.composio.dev")
  } catch {
    throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, "Composio API base URL is invalid")
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, "Composio API base URL must be credential-free https")
  }
  const approvedOrigins = options.apiUrlOrigins ?? ["https://backend.composio.dev"]
  if (!approvedOrigins.includes(parsed.origin)) {
    throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, "Composio API origin is not approved")
  }
  return trimTrailingSlash(parsed.toString())
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
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)
  try {
    const response = await fetchImpl(`${normalizeComposioApiBaseUrl(options)}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-api-key": secret.value,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: controller.signal,
    })
    const payload = await readJsonResponse(response, options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, controller)
    if (!response.ok) throw providerError("Composio request failed", { status: response.status, payload }, [secret.value])
    return payload
  } catch (error) {
    if (controller.signal.aborted && !(error instanceof McpError && error.code === MCP_ERROR_CODES.PROVIDER_ERROR)) {
      throw new McpError(MCP_ERROR_CODES.PROVIDER_TIMEOUT, "Composio request timed out")
    }
    if (error instanceof McpError) throw error
    throw providerError("Composio request failed", error, [secret.value])
  } finally {
    clearTimeout(timeout)
  }
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

async function deleteComposioSessionVerified(
  options: ComposioManagedConnectorProviderOptions,
  secret: ManagedConnectorSecret,
  sessionId: string,
): Promise<void> {
  const path = `/api/v3.1/tool_router/session/${encodeURIComponent(sessionId)}`
  const canaries = [secret.value, sessionId]
  try {
    try {
      await composioDelete(options, secret, path)
    } catch (error) {
      if (providerErrorStatus(error) !== 404) throw error
    }
    try {
      await composioGet(options, secret, path)
    } catch (error) {
      if (providerErrorStatus(error) === 404) return
      throw error
    }
    throw providerError("Composio Session deletion could not be verified")
  } catch (error) {
    throw sanitizeMcpErrorWithCanaries(error, canaries, "Composio Session cleanup failed")
  }
}

async function deleteResolvedComposioSessionVerified(
  options: ComposioManagedConnectorProviderOptions,
  secret: ManagedConnectorSecret,
  session: ComposioMcpSession,
): Promise<void> {
  try {
    await deleteComposioSessionVerified(options, secret, session.id)
  } catch (error) {
    const canaries = [secret.value, session.id, session.mcp.url, ...Object.values(session.mcp.headers ?? {})]
    throw sanitizeMcpErrorWithCanaries(error, canaries, "Composio Session cleanup failed")
  }
}

function curatedToolkitId(config: ManagedConnectorDefinition): string | undefined {
  return isFullCatalogManagedConnectorConfig(config) ? undefined : config.toolkitId
}

function optionsForConnector(
  options: ComposioManagedConnectorProviderOptions,
  config: ManagedConnectorDefinition,
): ComposioManagedConnectorProviderOptions {
  return config.mcpUrlOrigins?.length ? { ...options, mcpUrlOrigins: config.mcpUrlOrigins } : options
}

function verifySessionConfig(session: ComposioMcpSession, input: ResolveComposioMcpSessionInput): void {
  const sessionConfig = record(session.config)
  const workbench = record(sessionConfig.workbench)
  if (workbench.enable !== false) throw providerError("Composio Session did not preserve disabled workbench configuration")
  if (Object.prototype.hasOwnProperty.call(sessionConfig, "toolkits") && (typeof sessionConfig.toolkits !== "object" || sessionConfig.toolkits === null || Array.isArray(sessionConfig.toolkits))) {
    throw providerError("Composio Session returned malformed toolkit configuration")
  }
  const toolkits = record(sessionConfig.toolkits)
  if (Object.prototype.hasOwnProperty.call(toolkits, "enable") && !Array.isArray(toolkits.enable)) {
    throw providerError("Composio Session returned malformed toolkit configuration")
  }
  if (Object.keys(toolkits).some((key) => key !== "enable")) {
    throw providerError("Composio Session returned unexpected toolkit configuration")
  }
  const rawEnabledToolkits = array(toolkits.enable)
  if (rawEnabledToolkits.some((value) => typeof value !== "string" || !value.trim())) {
    throw providerError("Composio Session returned malformed toolkit configuration")
  }
  const enabledToolkits = rawEnabledToolkits as string[]
  const expectedToolkit = curatedToolkitId(input.config)
  if (expectedToolkit) {
    if (enabledToolkits.length !== 1 || enabledToolkits[0] !== expectedToolkit) throw providerError("Composio Session did not preserve toolkit restriction")
  } else if (enabledToolkits.length > 0) {
    throw providerError("Composio Session unexpectedly restricted the full catalog")
  }
  if (!input.accountPin && Object.prototype.hasOwnProperty.call(sessionConfig, "connected_accounts")) {
    if (typeof sessionConfig.connected_accounts !== "object" || sessionConfig.connected_accounts === null || Array.isArray(sessionConfig.connected_accounts) || Object.keys(record(sessionConfig.connected_accounts)).length > 0) {
      throw providerError("Composio Session unexpectedly selected connected accounts")
    }
  }
  if (input.accountPin) {
    const connectedAccounts = record(sessionConfig.connected_accounts)
    const rawIds = connectedAccounts[input.accountPin.toolkitId]
    if (!Array.isArray(rawIds) || rawIds.some((value) => typeof value !== "string" || !value.trim())) {
      throw providerError("Composio Session returned malformed connected-account configuration")
    }
    const ids = rawIds as string[]
    if (ids.length !== 1 || ids[0] !== input.accountPin.connectedAccountId || Object.keys(connectedAccounts).length !== 1) {
      throw providerError("Composio Session did not preserve the exact connected-account pin")
    }
  }
}

export async function resolveComposioMcpSession(options: ComposioManagedConnectorProviderOptions, input: ResolveComposioMcpSessionInput): Promise<ComposioMcpSession> {
  const toolkitId = curatedToolkitId(input.config)
  const body: Record<string, unknown> = {
    user_id: composioUserId(input.actor),
    mcp: true,
    manage_connections: {
      enable: true,
      enable_wait_for_connections: false,
      callback_url: options.callbackUrl,
    },
    workbench: { enable: false },
  }
  if (toolkitId) body.toolkits = { enable: [toolkitId] }
  if (input.accountPin) body.connected_accounts = { [input.accountPin.toolkitId]: [input.accountPin.connectedAccountId] }
  const payload = await composioPost(options, input.secret, "/api/v3.1/tool_router/session", body)
  const rawIdentity = rawSessionIdentity(payload)
  const canaries = [input.secret.value, ...rawIdentity.canaries]
  try {
    const session = extractSession(payload, optionsForConnector(options, input.config), canaries)
    verifySessionConfig(session, input)
    return session
  } catch (error) {
    if (rawIdentity.id) {
      try {
        await deleteComposioSessionVerified(options, input.secret, rawIdentity.id)
      } catch (cleanupError) {
        throw sanitizeMcpErrorWithCanaries(cleanupError, canaries, "Composio Session cleanup failed")
      }
    }
    throw sanitizeMcpErrorWithCanaries(error, canaries, "Composio Session validation failed")
  }
}

async function createLink(options: ComposioManagedConnectorProviderOptions, secret: ManagedConnectorSecret, sessionId: string, toolkitId: string): Promise<unknown> {
  return composioPost(options, secret, `/api/v3/tool_router/session/${encodeURIComponent(sessionId)}/link`, {
    toolkit: toolkitId,
    callback_url: options.callbackUrl,
  })
}

function accountIsForToolkit(account: Record<string, unknown>, actor: McpActor, toolkitId: string): boolean {
  const toolkit = record(account.toolkit)
  return optionalString(toolkit.slug) === toolkitId && optionalString(account.user_id) === composioUserId(actor)
}

function summarizeAccount(account: Record<string, unknown>): ComposioConnectedAccountSummary | undefined {
  const id = optionalString(account.id) ?? optionalString(account.nanoid) ?? optionalString(account.word_id)
  if (!id) return undefined
  const status = optionalString(account.status)?.toUpperCase()
  const disabled = account.is_disabled === true || record(account.auth_config).is_disabled === true
  return {
    id,
    label: extractProviderAccountLabel(account),
    active: !disabled && (status === "ACTIVE" || status === "CONNECTED" || status === "ENABLED"),
  }
}

async function listOwnedConnectedAccounts(
  options: ComposioManagedConnectorProviderOptions,
  input: Pick<ResolveComposioMcpSessionInput, "actor" | "secret"> & { toolkitId: string },
): Promise<ComposioConnectedAccountSummary[]> {
  const params = new URLSearchParams({ user_id: composioUserId(input.actor), toolkit_slug: input.toolkitId, limit: String(MAX_CONNECTED_ACCOUNT_RESULTS) })
  const payload = await composioGet(options, input.secret, `/api/v3.1/connected_accounts?${params}`)
  const page = record(payload)
  if (!Array.isArray(page.items)) throw providerError("Composio connected-account response did not include an item list")
  if (Object.prototype.hasOwnProperty.call(page, "has_more") && typeof page.has_more !== "boolean") {
    throw providerError("Composio connected-account pagination was malformed")
  }
  for (const key of ["next_cursor", "nextCursor"] as const) {
    const value = page[key]
    if (value !== undefined && value !== null && typeof value !== "string") throw providerError("Composio connected-account pagination was malformed")
  }
  const rawItems = page.items
  if (rawItems.length >= MAX_CONNECTED_ACCOUNT_RESULTS || page.has_more === true || optionalString(page.next_cursor) || optionalString(page.nextCursor)) {
    throw providerError("Composio connected-account result was not provably complete")
  }
  const accounts = rawItems.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw providerError("Composio connected-account row was malformed")
    const account = value as Record<string, unknown>
    const userId = optionalString(account.user_id)
    const toolkitSlug = optionalString(record(account.toolkit).slug)
    if (!userId || !toolkitSlug) throw providerError("Composio connected-account ownership fields were malformed")
    return account
  })
  const matching = accounts.filter((account) => accountIsForToolkit(account, input.actor, input.toolkitId))
  return matching.map((account) => {
    const summary = summarizeAccount(account)
    if (!summary) throw providerError("Composio returned a matching connected account without a stable ID")
    return summary
  })
}

export async function requireExactlyOneComposioConnectedAccount(
  options: ComposioManagedConnectorProviderOptions,
  input: Pick<ResolveComposioMcpSessionInput, "actor" | "secret"> & { toolkitId: string },
): Promise<ComposioConnectedAccountSummary> {
  const accounts = await listOwnedConnectedAccounts(options, input)
  if (accounts.length > 1) throw new McpError(MCP_ERROR_CODES.CONNECTED_ACCOUNT_CONFLICT, "Multiple connected accounts require revoke-then-connect replacement")
  const account = accounts[0]
  if (!account?.active) throw new McpError(MCP_ERROR_CODES.CONNECTED_ACCOUNT_REQUIRED, "Exactly one active connected account is required")
  return account
}

function composioMcpHeaders(session: ComposioMcpSession, secret: ManagedConnectorSecret): Record<string, string> {
  requireServerSecret(secret)
  return { ...(session.mcp.headers ?? {}), "x-api-key": secret.value }
}

function createGuardedComposioMcpFetch(options: ComposioManagedConnectorProviderOptions): typeof fetch {
  const fetchImpl = options.mcpFetch ?? globalThis.fetch
  if (!fetchImpl) throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, "fetch is not available for Composio MCP transport")
  return async (input, init) => {
    const request = new Request(input, init)
    normalizeComposioMcpUrl(request.url, options)
    const controller = new AbortController()
    const timeoutSignal = AbortSignal.timeout(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)
    timeoutSignal.addEventListener("abort", () => controller.abort(), { once: true })
    const signal = AbortSignal.any([request.signal, controller.signal, timeoutSignal])
    try {
      const response = await fetchImpl(request, { redirect: "error", signal })
      return boundedResponseBody(response, options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, controller)
    } catch (error) {
      if (timeoutSignal.aborted) throw new McpError(MCP_ERROR_CODES.PROVIDER_TIMEOUT, "Composio MCP request timed out")
      throw error
    }
  }
}

function transportForSession(
  options: ComposioManagedConnectorProviderOptions,
  session: ComposioMcpSession,
  secret: ManagedConnectorSecret,
  config: ManagedConnectorDefinition,
): McpTransportClient {
  const connectorOptions = optionsForConnector(options, config)
  return createMcpSdkStreamableHttpTransport({
    endpoint: { url: session.mcp.url, headers: composioMcpHeaders(session, secret) },
    clientName: connectorOptions.clientName ?? "boring-mcp-composio",
    clientVersion: connectorOptions.clientVersion ?? "0.0.0",
    fetch: createGuardedComposioMcpFetch(connectorOptions),
  })
}

const COMPOSIO_SEARCH_TOOLS = "COMPOSIO_SEARCH_TOOLS"
const COMPOSIO_GET_TOOL_SCHEMAS = "COMPOSIO_GET_TOOL_SCHEMAS"
const COMPOSIO_MULTI_EXECUTE_TOOL = "COMPOSIO_MULTI_EXECUTE_TOOL"
const COMPOSIO_TOOL_NAME_MAX_LENGTH = 256
const COMPOSIO_TOOL_DESCRIPTION_MAX_LENGTH = 4_000
const COMPOSIO_TOOL_SCHEMA_MAX_BYTES = 128 * 1024
const COMPOSIO_TOOL_SCHEMA_MAX_DEPTH = 20

function isComposioMetaTool(toolName: string): boolean {
  return toolName.startsWith("COMPOSIO_")
}

function safeTools(tools: McpDiscoveredTool[]): McpDiscoveredTool[] {
  return tools.filter((tool) => !isComposioMetaTool(tool.name))
}

function jsonDepth(value: unknown, depth = 0): number {
  if (!value || typeof value !== "object") return depth
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)
  return children.reduce((max, child) => Math.max(max, jsonDepth(child, depth + 1)), depth)
}

function assertBoundedToolMetadata(tool: McpDiscoveredTool): void {
  validateMcpToolName(tool.name)
  if (
    tool.name.length > COMPOSIO_TOOL_NAME_MAX_LENGTH
    || (tool.description?.length ?? 0) > COMPOSIO_TOOL_DESCRIPTION_MAX_LENGTH
    || (tool.toolkit?.length ?? 0) > 128
    || (tool.version?.length ?? 0) > 128
  ) {
    throw providerError("Composio tool metadata exceeded configured length limits")
  }
  for (const value of [tool.inputSchema, tool.outputSchema, tool.annotations]) {
    if (value === undefined) continue
    const encoded = new TextEncoder().encode(JSON.stringify(value))
    if (encoded.byteLength > COMPOSIO_TOOL_SCHEMA_MAX_BYTES || jsonDepth(value) > COMPOSIO_TOOL_SCHEMA_MAX_DEPTH) {
      throw providerError("Composio tool schema exceeded configured complexity limits")
    }
  }
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

interface ComposioToolSlug {
  slug: string
  toolkit?: string
}

function collectComposioToolSlugs(payload: unknown, limit: number, toolkitId?: string): ComposioToolSlug[] {
  const root = record(jsonFromTextContent(payload) ?? payload)
  const data = record(root.data ?? root)
  const seen = new Map<string, ComposioToolSlug>()
  const results = array(data.results)
  if (results.length > 100) throw providerError("Composio tool search returned too many result groups")
  for (const item of results) {
    const result = record(item)
    const toolkits = array(result.toolkits).filter((toolkit): toolkit is string => typeof toolkit === "string" && Boolean(toolkit.trim()))
    if (toolkitId && toolkits.length > 0 && !toolkits.some((toolkit) => toolkit.toLowerCase() === toolkitId.toLowerCase())) continue
    const candidateSlugs = [...array(result.primary_tool_slugs), ...array(result.related_tool_slugs)]
    if (candidateSlugs.length > 0 && toolkits.length !== 1) throw providerError("Composio tool search did not return exact toolkit provenance")
    for (const slug of candidateSlugs) {
      if (typeof slug !== "string" || !slug.trim() || isComposioMetaTool(slug)) continue
      try {
        validateMcpToolName(slug)
      } catch {
        throw providerError("Composio tool search returned an invalid tool slug")
      }
      if (slug.length > COMPOSIO_TOOL_NAME_MAX_LENGTH || toolkits.some((toolkit) => toolkit.length > 128)) {
        throw providerError("Composio tool search returned oversized identifiers")
      }
      const existing = seen.get(slug)
      if (existing?.toolkit && toolkits[0] && existing.toolkit !== toolkits[0]) {
        throw providerError("Composio tool search returned ambiguous toolkit provenance")
      }
      if (!existing) seen.set(slug, { slug, toolkit: toolkits[0] })
      if (seen.size >= limit) return [...seen.values()]
    }
  }
  return [...seen.values()]
}

function toolsFromComposioSchemas(payload: unknown, slugs: readonly ComposioToolSlug[]): McpDiscoveredTool[] {
  const root = record(jsonFromTextContent(payload) ?? payload)
  const data = record(root.data ?? root)
  const schemas = record(data.tool_schemas ?? root.tool_schemas)
  const tools: McpDiscoveredTool[] = []
  for (const item of slugs) {
    const rawSchema = schemas[item.slug]
    if (!rawSchema || typeof rawSchema !== "object" || Array.isArray(rawSchema)) continue
    const schema = rawSchema as Record<string, unknown>
    const name = optionalString(schema.tool_slug) ?? item.slug
    const schemaToolkit = optionalString(schema.toolkit_slug)
    if (name !== item.slug || (schemaToolkit && item.toolkit && schemaToolkit !== item.toolkit)) {
      throw providerError("Composio tool schema contradicted searched tool identity")
    }
    if (isComposioMetaTool(name)) continue
    const tool: McpDiscoveredTool = {
      name,
      description: optionalString(schema.description),
      inputSchema: schema.input_schema ?? {},
      outputSchema: schema.output_schema,
      toolkit: schemaToolkit ?? item.toolkit,
      version: optionalString(schema.version),
      annotations: Object.keys(record(schema.annotations)).length ? record(schema.annotations) : undefined,
    }
    assertBoundedToolMetadata(tool)
    tools.push(tool)
  }
  return tools
}

function concreteAllowedToolSlugs(provider: string): string[] {
  return getMcpProviderTemplate(provider)?.allowedTools.filter((toolName) => !toolName.includes("*")) ?? []
}

async function searchComposioTools(input: {
  transport: McpTransportClient
  source: McpSource
  session: ComposioMcpSession
  query: string
  limit: number
  toolkitId?: string
  additionalToolSlugs?: readonly string[]
}): Promise<McpDiscoveredTool[]> {
  const searchResult = await input.transport.callTool(input.source, COMPOSIO_SEARCH_TOOLS, {
    queries: [input.query],
    session: input.session.id,
  })
  const searchedSlugs = collectComposioToolSlugs(searchResult, input.limit, input.toolkitId)
  const slugs: ComposioToolSlug[] = []
  const known = new Set<string>()
  for (const slug of input.additionalToolSlugs ?? []) {
    if (known.has(slug) || isComposioMetaTool(slug) || slugs.length >= input.limit) continue
    slugs.push({ slug, toolkit: input.toolkitId })
    known.add(slug)
  }
  for (const item of searchedSlugs) {
    if (known.has(item.slug) || slugs.length >= input.limit) continue
    slugs.push(item)
    known.add(item.slug)
  }
  if (slugs.length === 0) return []
  const schemaResult = await input.transport.callTool(input.source, COMPOSIO_GET_TOOL_SCHEMAS, {
    tool_slugs: slugs.map(({ slug }) => slug),
    session_id: input.session.id,
  })
  return toolsFromComposioSchemas(schemaResult, slugs)
}

async function describeComposioTool(input: {
  transport: McpTransportClient
  source: McpSource
  session: ComposioMcpSession
  toolName: string
}): Promise<McpDiscoveredTool> {
  if (isComposioMetaTool(input.toolName)) throw new McpError(MCP_ERROR_CODES.TOOL_NOT_ALLOWED, "Composio MCP management tools are not exposed")
  const searchResult = await input.transport.callTool(input.source, COMPOSIO_SEARCH_TOOLS, {
    queries: [input.toolName],
    session: input.session.id,
  })
  const matches = collectComposioToolSlugs(searchResult, COMPOSIO_SEARCH_MAX_TOOLS).filter(({ slug }) => slug === input.toolName)
  if (matches.length !== 1 || !matches[0]?.toolkit) throw providerError("Composio could not prove exact toolkit provenance for the requested tool")
  const schemaResult = await input.transport.callTool(input.source, COMPOSIO_GET_TOOL_SCHEMAS, {
    tool_slugs: [input.toolName],
    session_id: input.session.id,
  })
  const [tool] = toolsFromComposioSchemas(schemaResult, matches)
  if (!tool || tool.name !== input.toolName || !tool.toolkit) throw new McpError(MCP_ERROR_CODES.TOOL_NOT_FOUND, "MCP tool was not found")
  return tool
}

function connectorToolkitId(config: ManagedConnectorDefinition, source?: McpSource): string | undefined {
  return curatedToolkitId(config) || source?.connectorRef?.toolkitId
}

export function createComposioManagedConnectorProvider(options: ComposioManagedConnectorProviderOptions = {}): ManagedConnectorProvider<ManagedConnectorDefinition> {
  return {
    async startConnect({ actor, config, secret }) {
      const toolkitId = connectorToolkitId(config)
      if (!toolkitId) {
        requireServerSecret(secret)
        return { connectorRef: { provider: config.provider }, status: "connected" }
      }
      const session = await resolveComposioMcpSession(options, { actor, config, secret })
      let link: unknown
      try {
        link = await createLink(options, secret, session.id, toolkitId)
      } catch (error) {
        await deleteResolvedComposioSessionVerified(options, secret, session)
        throw error
      }
      return {
        connectorRef: { provider: config.provider, toolkitId, sessionId: session.id },
        status: "unconfigured",
        connectUrl: extractConnectUrl(link),
        providerAccountLabel: extractProviderAccountLabel(link),
      }
    },

    async abortConnect({ secret, response }) {
      if (response.connectorRef.sessionId) {
        await deleteComposioSessionVerified(options, secret, response.connectorRef.sessionId)
      }
    },

    async refreshStatus({ actor, source, config, secret }) {
      if (source.status === "revoked") {
        return { status: "revoked", providerAccountLabel: source.providerAccountLabel, lastVerifiedAt: source.lastVerifiedAt, connectorRef: source.connectorRef }
      }
      const toolkitId = connectorToolkitId(config, source)
      if (!toolkitId && isFullCatalogManagedConnectorConfig(config)) {
        return {
          status: "connected",
          providerAccountLabel: source.providerAccountLabel,
          lastVerifiedAt: new Date().toISOString(),
          connectorRef: { ...source.connectorRef, provider: config.provider },
        }
      }
      if (!toolkitId) throw new McpError(MCP_ERROR_CODES.INPUT_INVALID, "Connected source does not identify a toolkit")
      const accounts = await listOwnedConnectedAccounts(options, { actor, secret, toolkitId })
      if (accounts.length > 1) throw new McpError(MCP_ERROR_CODES.CONNECTED_ACCOUNT_CONFLICT, "Multiple connected accounts require revoke-then-connect replacement")
      const account = accounts[0]
      if (!account?.active) {
        return {
          status: source.status === "connected" ? "expired" : source.status,
          providerAccountLabel: account?.label ?? source.providerAccountLabel,
          lastVerifiedAt: new Date().toISOString(),
          connectorRef: { ...source.connectorRef, provider: config.provider, toolkitId, connectedAccountId: account?.id },
        }
      }
      const session = await resolveComposioMcpSession(options, {
        actor,
        config,
        secret,
        accountPin: { toolkitId, connectedAccountId: account.id },
      })
      await deleteResolvedComposioSessionVerified(options, secret, session)
      if (source.connectorRef?.sessionId && source.connectorRef.sessionId !== session.id) {
        await deleteComposioSessionVerified(options, secret, source.connectorRef.sessionId)
      }
      return {
        status: "connected",
        providerAccountLabel: account.label ?? source.providerAccountLabel,
        lastVerifiedAt: new Date().toISOString(),
        connectorRef: { ...source.connectorRef, provider: config.provider, toolkitId, sessionId: undefined, connectedAccountId: account.id },
      }
    },

    async probe({ actor, source, config, secret }) {
      const toolkitId = connectorToolkitId(config, source)
      const account = toolkitId ? await requireExactlyOneComposioConnectedAccount(options, { actor, secret, toolkitId }) : undefined
      const session = await resolveComposioMcpSession(options, {
        actor,
        config,
        secret,
        accountPin: account && toolkitId ? { toolkitId, connectedAccountId: account.id } : undefined,
      })
      const transport = transportForSession(options, session, secret, config)
      const probeSource: McpSource = {
        id: `composio-probe:${actor.workspaceId}:${actor.userId}:${config.provider}`,
        workspaceId: actor.workspaceId,
        userId: actor.userId,
        provider: config.provider,
        displayName: config.displayName,
        status: "connected",
        ownerKind: "user",
        credentialProvider: "composio-managed",
        connectorRef: { provider: config.provider, toolkitId, sessionId: session.id, connectedAccountId: account?.id },
      }
      try {
        const [tools, resources] = await Promise.all([
          transport.listTools(probeSource).then(safeTools),
          transport.listResources(probeSource).catch((): McpDiscoveredResource[] => []),
        ])
        return { tools, resources }
      } catch (error) {
        throw sanitizeComposioTransportError(error, { secret, session })
      } finally {
        await deleteResolvedComposioSessionVerified(options, secret, session)
      }
    },

    async revoke({ actor, source, config, secret }) {
      const toolkitId = connectorToolkitId(config, source)
      try {
        if (!toolkitId) return
        const accounts = await listOwnedConnectedAccounts(options, { actor, secret, toolkitId })
        if (accounts.length === 0) return
        if (accounts.length > 1) throw new McpError(MCP_ERROR_CODES.CONNECTED_ACCOUNT_CONFLICT, "Multiple connected accounts require revoke-then-connect replacement")
        const account = accounts[0]!
        try {
          await composioDelete(options, secret, `/api/v3.1/connected_accounts/${encodeURIComponent(account.id)}`)
        } catch (error) {
          if (providerErrorStatus(error) !== 404) throw error
        }
        const remaining = await listOwnedConnectedAccounts(options, { actor, secret, toolkitId })
        if (remaining.some((candidate) => candidate.id === account.id)) {
          throw providerError("Composio connected-account revocation could not be verified")
        }
      } finally {
        if (source.connectorRef?.sessionId) await deleteComposioSessionVerified(options, secret, source.connectorRef.sessionId)
      }
    },
  }
}

const COMPOSIO_TRANSPORT_SESSION_TTL_MS = 5 * 60_000
const COMPOSIO_TRANSPORT_CLEANUP_RETRY_MS = 60_000
const COMPOSIO_TRANSPORT_MAX_SESSIONS = 128
const COMPOSIO_SEARCH_QUERY_MAX_LENGTH = 256
const COMPOSIO_SEARCH_MAX_TOOLS = 20

interface ComposioTransportCacheEntry {
  expiresAt: number
  config: ManagedConnectorDefinition
  secret: ManagedConnectorSecret
  session: ComposioMcpSession
  rawTools?: McpDiscoveredTool[]
  toolkitTools?: McpDiscoveredTool[]
  executionAccountId?: string
  executionSession?: ComposioMcpSession
  cleanupTimer?: ReturnType<typeof setTimeout>
}

function composioSessionCanaries(entry: Pick<ComposioTransportCacheEntry, "secret" | "session"> & { executionSession?: ComposioMcpSession }): string[] {
  const sessions = [entry.session, entry.executionSession].filter((value): value is ComposioMcpSession => Boolean(value))
  return [
    entry.secret.value,
    ...sessions.flatMap((session) => [session.id, session.mcp.url, ...Object.values(session.mcp.headers ?? {})]),
  ]
}

function assertComposioToolMetadataSecretFree(entry: ComposioTransportCacheEntry, tools: readonly McpDiscoveredTool[]): void {
  if (containsMcpSecretOrCanary(tools, composioSessionCanaries(entry))) {
    throw new McpError(MCP_ERROR_CODES.SECRET_LEAK_GUARD, "Composio tool metadata contained server-only material")
  }
}

function assertComposioToolResultSecretFree(entry: ComposioTransportCacheEntry, result: unknown): void {
  if (containsMcpSecretOrCanary(result, composioSessionCanaries(entry))) {
    throw new McpError(MCP_ERROR_CODES.SECRET_LEAK_GUARD, "Composio tool result contained server-only material")
  }
}

function sanitizeComposioTransportError(error: unknown, entry: Pick<ComposioTransportCacheEntry, "secret" | "session"> & { executionSession?: ComposioMcpSession }): McpError {
  return sanitizeMcpErrorWithCanaries(error, composioSessionCanaries(entry), "Composio MCP request failed")
}

export interface ComposioMcpAdapter {
  transport: McpTransportClient
  catalog: McpManagedCatalogAdapter
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

export interface CreateComposioMcpAdapterOptions extends ComposioManagedConnectorProviderOptions {
  secretResolver: { resolveSecret(provider: string): Promise<ManagedConnectorSecret> }
  configs: readonly ManagedConnectorDefinition[]
}

export function createComposioMcpAdapter(options: CreateComposioMcpAdapterOptions): ComposioMcpAdapter {
  const cache = new Map<string, ComposioTransportCacheEntry>()
  const pendingSessions = new Map<string, Promise<ComposioTransportCacheEntry>>()
  const pendingCleanup = new Map<string, Promise<void>>()

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

  async function cleanupEntry(entry: ComposioTransportCacheEntry): Promise<void> {
    const sessions = [entry.session, entry.executionSession].filter((value): value is ComposioMcpSession => Boolean(value))
    const unique = sessions.filter((session, index) => sessions.findIndex((candidate) => candidate.id === session.id) === index)
    let failures = 0
    for (const session of unique) {
      try {
        await deleteResolvedComposioSessionVerified(options, entry.secret, session)
      } catch {
        failures += 1
      }
    }
    if (failures > 0) throw providerError("One or more Composio Sessions could not be cleaned up", { failures })
  }

  function scheduleCleanup(key: string, entry: ComposioTransportCacheEntry, delayMs: number): void {
    if (entry.cleanupTimer) clearTimeout(entry.cleanupTimer)
    entry.cleanupTimer = setTimeout(() => void evictCacheEntry(key).catch(() => undefined), delayMs)
    entry.cleanupTimer.unref?.()
  }

  async function evictCacheEntry(key: string): Promise<void> {
    const entry = cache.get(key)
    if (!entry) return
    const cleanup = pendingCleanup.get(key) ?? cleanupEntry(entry).catch((error) => {
      scheduleCleanup(key, entry, COMPOSIO_TRANSPORT_CLEANUP_RETRY_MS)
      throw sanitizeComposioTransportError(error, entry)
    }).then(() => {
      if (entry.cleanupTimer) clearTimeout(entry.cleanupTimer)
      cache.delete(key)
    }).finally(() => pendingCleanup.delete(key))
    pendingCleanup.set(key, cleanup)
    await cleanup
  }

  async function createCacheEntry(source: McpSource): Promise<ComposioTransportCacheEntry> {
    const config = options.configs.find((entry) => entry.provider === source.provider)
    if (!config) throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, "Unknown Composio MCP provider", { reason: "unsupported_provider" })
    const secret = await options.secretResolver.resolveSecret(source.provider)
    const session = await resolveComposioMcpSession(options, { actor: actorForSource(source), config, secret })
    const key = keyForSource(source)
    const entry: ComposioTransportCacheEntry = { config, secret, session, expiresAt: Date.now() + COMPOSIO_TRANSPORT_SESSION_TTL_MS }
    scheduleCleanup(key, entry, COMPOSIO_TRANSPORT_SESSION_TTL_MS)
    cache.set(key, entry)
    return entry
  }

  async function pruneExpiredEntries(now = Date.now()): Promise<void> {
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) await evictCacheEntry(key)
    }
    while (cache.size >= COMPOSIO_TRANSPORT_MAX_SESSIONS) {
      const oldestKey = cache.keys().next().value as string | undefined
      if (!oldestKey) break
      await evictCacheEntry(oldestKey)
    }
  }

  async function cachedContext(source: McpSource): Promise<{ key: string; entry: ComposioTransportCacheEntry; transport: McpTransportClient }> {
    const key = keyForSource(source)
    const now = Date.now()
    await pruneExpiredEntries(now)
    const cached = cache.get(key)
    if (cached && cached.expiresAt > now) {
      return { key, entry: cached, transport: transportForSession(options, cached.session, cached.secret, cached.config) }
    }
    const pending = pendingSessions.get(key) ?? createCacheEntry(source).finally(() => pendingSessions.delete(key))
    pendingSessions.set(key, pending)
    const entry = await pending
    return { key, entry, transport: transportForSession(options, entry.session, entry.secret, entry.config) }
  }

  async function rawToolsFor(source: McpSource, entry: ComposioTransportCacheEntry, transport: McpTransportClient): Promise<McpDiscoveredTool[]> {
    if (entry.rawTools) return entry.rawTools
    const tools = await transport.listTools(source)
    tools.forEach(assertBoundedToolMetadata)
    assertComposioToolMetadataSecretFree(entry, tools)
    entry.rawTools = tools
    return tools
  }

  async function executionTransportFor(source: McpSource, entry: ComposioTransportCacheEntry): Promise<McpTransportClient> {
    const toolkitId = connectorToolkitId(entry.config, source)
    if (!toolkitId) throw new McpError(MCP_ERROR_CODES.INPUT_INVALID, "Tool execution requires an exact toolkit")
    const account = await requireExactlyOneComposioConnectedAccount(options, {
      actor: actorForSource(source),
      secret: entry.secret,
      toolkitId,
    })
    if (!entry.executionSession || entry.executionAccountId !== account.id) {
      if (entry.executionSession) await deleteResolvedComposioSessionVerified(options, entry.secret, entry.executionSession)
      entry.executionSession = await resolveComposioMcpSession(options, {
        actor: actorForSource(source),
        config: entry.config,
        secret: entry.secret,
        accountPin: { toolkitId, connectedAccountId: account.id },
      })
      entry.executionAccountId = account.id
    }
    return transportForSession(options, entry.executionSession, entry.secret, entry.config)
  }

  const transport: McpTransportClient = {
    async listTools(source, input) {
      if (input?.forceProviderRefresh) await evictCacheEntry(keyForSource(source))
      const { key, entry, transport } = await cachedContext(source)
      try {
        const rawTools = await rawToolsFor(source, entry, transport)
        const directTools = safeTools(rawTools)
        if (directTools.length > 0 || !rawTools.some((tool) => tool.name === COMPOSIO_SEARCH_TOOLS) || !rawTools.some((tool) => tool.name === COMPOSIO_GET_TOOL_SCHEMAS)) {
          return directTools
        }
        const toolkitId = curatedToolkitId(entry.config)
        if (!toolkitId) return directTools
        entry.toolkitTools ??= await searchComposioTools({
          transport,
          source,
          session: entry.session,
          query: toolkitId,
          limit: COMPOSIO_SEARCH_MAX_TOOLS,
          toolkitId,
          additionalToolSlugs: concreteAllowedToolSlugs(source.provider),
        })
        assertComposioToolMetadataSecretFree(entry, entry.toolkitTools)
        return entry.toolkitTools
      } catch (error) {
        await evictCacheEntry(key)
        throw sanitizeComposioTransportError(error, entry)
      }
    },

    async listResources(source) {
      const { key, entry, transport } = await cachedContext(source)
      try {
        return await transport.listResources(source)
      } catch (error) {
        if (isUnsupportedResourcesError(error)) return []
        await evictCacheEntry(key)
        throw sanitizeComposioTransportError(error, entry)
      }
    },

    async readResource(source, uri) {
      const { key, entry, transport } = await cachedContext(source)
      try {
        return await transport.readResource(source, uri)
      } catch (error) {
        await evictCacheEntry(key)
        throw sanitizeComposioTransportError(error, entry)
      }
    },

    async callTool(source, toolName, input) {
      if (isComposioMetaTool(toolName)) throw new McpError(MCP_ERROR_CODES.TOOL_NOT_ALLOWED, "Composio MCP management tools are not exposed")
      const config = options.configs.find((entry) => entry.provider === source.provider)
      if (config && isFullCatalogManagedConnectorConfig(config)) {
        throw new McpError(MCP_ERROR_CODES.TOOL_NOT_ALLOWED, "Full-catalog execution requires the approval-gated provider dispatch")
      }
      const { key, entry, transport: metadataTransport } = await cachedContext(source)
      try {
        const rawTools = await rawToolsFor(source, entry, metadataTransport)
        const transport = await executionTransportFor(source, entry)
        let result
        if (rawTools.some((tool) => tool.name === toolName) || !rawTools.some((tool) => tool.name === COMPOSIO_MULTI_EXECUTE_TOOL)) {
          result = await transport.callTool(source, toolName, input)
        } else {
          result = await transport.callTool(source, COMPOSIO_MULTI_EXECUTE_TOOL, {
            tools: [{ tool_slug: toolName, arguments: input && typeof input === "object" ? input : {} }],
            sync_response_to_workbench: false,
            thought: `Execute ${toolName} through governed boring-mcp`,
            current_step: "MCP_READONLY_CALL",
            current_step_metric: "1/1 tools",
            session_id: entry.executionSession!.id,
          })
        }
        assertComposioToolResultSecretFree(entry, result)
        return result
      } catch (error) {
        await evictCacheEntry(key)
        throw sanitizeComposioTransportError(error, entry)
      }
    },
  }

  const catalog: McpManagedCatalogAdapter = {
    supports(source) {
      const config = options.configs.find((entry) => entry.provider === source.provider)
      return Boolean(config && isFullCatalogManagedConnectorConfig(config))
    },

    async searchTools(source, input) {
      const query = input.query.trim()
      if (!query || query.length > COMPOSIO_SEARCH_QUERY_MAX_LENGTH) {
        throw new McpError(MCP_ERROR_CODES.INPUT_INVALID, "Composio tool search query must be between 1 and 256 characters")
      }
      const limit = Math.min(Math.max(input.limit, 1), COMPOSIO_SEARCH_MAX_TOOLS)
      if (input.forceProviderRefresh) await evictCacheEntry(keyForSource(source))
      const { key, entry, transport } = await cachedContext(source)
      try {
        const rawTools = await rawToolsFor(source, entry, transport)
        if (!rawTools.some((tool) => tool.name === COMPOSIO_SEARCH_TOOLS) || !rawTools.some((tool) => tool.name === COMPOSIO_GET_TOOL_SCHEMAS)) {
          throw providerError("Composio Session did not expose the required managed catalog tools")
        }
        const tools = await searchComposioTools({ transport, source, session: entry.session, query, limit })
        assertComposioToolMetadataSecretFree(entry, tools)
        return tools
      } catch (error) {
        await evictCacheEntry(key)
        throw sanitizeComposioTransportError(error, entry)
      }
    },

    async describeTool(source, toolName, input) {
      if (!toolName.trim() || toolName.length > 256 || isComposioMetaTool(toolName)) {
        throw new McpError(MCP_ERROR_CODES.TOOL_NOT_ALLOWED, "Composio MCP management tools are not exposed")
      }
      if (input?.forceProviderRefresh) await evictCacheEntry(keyForSource(source))
      const { key, entry, transport } = await cachedContext(source)
      try {
        const rawTools = await rawToolsFor(source, entry, transport)
        if (!rawTools.some((tool) => tool.name === COMPOSIO_SEARCH_TOOLS) || !rawTools.some((tool) => tool.name === COMPOSIO_GET_TOOL_SCHEMAS)) {
          throw providerError("Composio Session did not expose the required managed catalog tools")
        }
        const tool = await describeComposioTool({ transport, source, session: entry.session, toolName })
        assertComposioToolMetadataSecretFree(entry, [tool])
        return tool
      } catch (error) {
        await evictCacheEntry(key)
        throw sanitizeComposioTransportError(error, entry)
      }
    },

    async disposeSource(source) {
      await evictCacheEntry(keyForSource(source))
    },
  }

  return { transport, catalog }
}

export function createComposioMcpTransport(options: CreateComposioMcpAdapterOptions): McpTransportClient {
  return createComposioMcpAdapter(options).transport
}
