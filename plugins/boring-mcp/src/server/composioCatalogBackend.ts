import { createHash } from "node:crypto"
import {
  MCP_ERROR_CODES,
  McpError,
  containsMcpSecretOrCanary,
  validateMcpToolName,
  type McpActor,
  type McpSource,
} from "../shared"
import type { ManagedConnectorSecret, ManagedConnectorSecretResolver } from "./managedConnectorAdapter"
import { createMcpSdkStreamableHttpTransport } from "./mcpSdkTransport"
import { createMcpSourceRevision, type McpManagedCatalogBackend, type McpManagedCatalogTool } from "./toolCatalog"

export const COMPOSIO_CATALOG_PROVIDER_ID = "composio" as const

const COMPOSIO_API_ORIGIN = "https://backend.composio.dev"
const COMPOSIO_SEARCH_TOOLS = "COMPOSIO_SEARCH_TOOLS"
const COMPOSIO_GET_TOOL_SCHEMAS = "COMPOSIO_GET_TOOL_SCHEMAS"
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024
const MAX_ACCOUNT_RESULTS = 100
const MAX_ACCOUNT_PAGES = 5
const MAX_TOTAL_ACCOUNTS = MAX_ACCOUNT_RESULTS * MAX_ACCOUNT_PAGES
const MAX_QUERY_LENGTH = 256
const MAX_DESCRIPTION_LENGTH = 4_000
const MAX_SCHEMA_BYTES = 64 * 1024
const DEFAULT_CACHE_ENTRIES = 128
const DEFAULT_CACHE_TTL_MS = 60_000
const COMPOSIO_ACCOUNT_STATUSES = new Set(["INITIALIZING", "INITIATED", "ACTIVE", "FAILED", "EXPIRED", "INACTIVE", "REVOKED"])
const COMPOSIO_STATE_STATUSES = new Set(["INITIALIZING", "INITIATED", "ACTIVE", "FAILED", "EXPIRED", "INACTIVE"])
const COMPOSIO_AUTH_SCHEMES = new Set([
  "OAUTH2", "OAUTH1", "API_KEY", "BASIC", "BILLCOM_AUTH", "BEARER_TOKEN",
  "GOOGLE_SERVICE_ACCOUNT", "NO_AUTH", "BASIC_WITH_JWT", "CALCOM_AUTH",
  "SERVICE_ACCOUNT", "SAML", "DCR_OAUTH", "S2S_OAUTH2",
])

export interface ComposioCatalogSession {
  id: string
  mcp: { url: string; headers?: Record<string, string> }
}

export interface ComposioAccountPin {
  toolkitId: string
  connectedAccountId: string
}

export interface ComposioCatalogBackendOptions {
  secretResolver: ManagedConnectorSecretResolver
  fetch?: typeof fetch
  mcpFetch?: typeof fetch
  clientName?: string
  clientVersion?: string
  requestTimeoutMs?: number
  maxResponseBytes?: number
  cacheEntries?: number
  cacheTtlMs?: number
  /** Loopback-only fake MCP seam. Never enables arbitrary production origins. */
  allowInsecureLoopbackForTests?: boolean
  maxConcurrentRequests?: number
  maxRequestsPerMinute?: number
}

interface CacheEntry<T> {
  expiresAt: number
  value: T
}

class BoundedTtlCache<T> {
  private readonly values = new Map<string, CacheEntry<T>>()

  constructor(private readonly maxEntries: number, private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.values.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) {
      this.values.delete(key)
      return undefined
    }
    this.values.delete(key)
    this.values.set(key, entry)
    return entry.value
  }

  delete(key: string): void {
    this.values.delete(key)
  }

  deletePrefix(prefix: string): void {
    for (const key of this.values.keys()) {
      if (key.startsWith(prefix)) this.values.delete(key)
    }
  }

  set(key: string, value: T): void {
    this.values.delete(key)
    this.values.set(key, { expiresAt: Date.now() + this.ttlMs, value })
    while (this.values.size > this.maxEntries) {
      const oldest = this.values.keys().next().value as string | undefined
      if (!oldest) break
      this.values.delete(oldest)
    }
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function optionalHeaders(value: unknown): Record<string, string> | undefined {
  const entries = Object.entries(record(value)).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function composioUserId(actor: McpActor): string {
  const digest = createHash("sha256").update(`${actor.workspaceId}\0${actor.userId}`).digest("hex")
  return `boring_${digest}`
}

function actorForSource(source: McpSource): McpActor {
  return { workspaceId: source.workspaceId, userId: source.userId }
}

export function createComposioCatalogSource(actor: McpActor): McpSource {
  const digest = createHash("sha256").update(`${actor.workspaceId}\0${actor.userId}\0composio`).digest("hex").slice(0, 32)
  return {
    id: `managed:composio:${digest}`,
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    provider: COMPOSIO_CATALOG_PROVIDER_ID,
    displayName: "Composio",
    status: "connected",
    ownerKind: "user",
    credentialProvider: "composio-managed",
  }
}

function requireServerSecret(secret: ManagedConnectorSecret): void {
  if ((secret.storage !== "server-env" && secret.storage !== "server-vault") || !secret.value) {
    throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, "Composio catalog secret is not configured server-side")
  }
}

function safeProviderError(message: string, status?: number): McpError {
  return new McpError(MCP_ERROR_CODES.PROVIDER_ERROR, message, status === undefined ? undefined : { status })
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > maxBytes) throw safeProviderError("Composio response exceeded the size limit", response.status)
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
      throw safeProviderError("Composio response exceeded the size limit", response.status)
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
    throw safeProviderError("Composio returned a non-JSON response", response.status)
  }
}

async function composioRequest(
  options: ComposioCatalogBackendOptions,
  secret: ManagedConnectorSecret,
  method: "DELETE" | "GET" | "POST",
  path: string,
  body?: unknown,
  allowSessionEnvelope = false,
): Promise<unknown> {
  requireServerSecret(secret)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)
  try {
    const response = await (options.fetch ?? globalThis.fetch)(`${COMPOSIO_API_ORIGIN}${path}`, {
      method,
      headers: { "content-type": "application/json", "x-api-key": secret.value },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: controller.signal,
    })
    const payload = await readBoundedJson(response, options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES)
    if (!response.ok) throw safeProviderError("Composio request failed", response.status)
    if (!allowSessionEnvelope && containsMcpSecretOrCanary(payload, [secret.value])) {
      throw new McpError(MCP_ERROR_CODES.SECRET_LEAK_GUARD, "Composio response contained server-only material")
    }
    return payload
  } catch (error) {
    if (controller.signal.aborted) throw new McpError(MCP_ERROR_CODES.PROVIDER_TIMEOUT, "Composio request timed out")
    if (error instanceof McpError) throw error
    throw safeProviderError("Composio request failed")
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeMcpUrl(rawUrl: string, options: ComposioCatalogBackendOptions): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw safeProviderError("Composio Session included an invalid MCP URL")
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1"
  const testLoopback = options.allowInsecureLoopbackForTests === true && url.protocol === "http:" && loopback
  if ((!testLoopback && (url.protocol !== "https:" || url.origin !== COMPOSIO_API_ORIGIN)) || url.username || url.password) {
    throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, "Composio MCP URL origin is not approved")
  }
  return url
}

function sessionEnvelope(payload: unknown): Record<string, unknown> {
  const root = record(payload)
  return record(root.session ?? root.data ?? root)
}

function extractSession(payload: unknown, options: ComposioCatalogBackendOptions, accountPin?: ComposioAccountPin): ComposioCatalogSession {
  const root = record(payload)
  const session = sessionEnvelope(payload)
  const mcp = record(session.mcp)
  const id = optionalString(session.id) ?? optionalString(session.session_id)
  const rawUrl = optionalString(mcp.url)
  if (!id || !rawUrl) throw safeProviderError("Composio response did not include an MCP Session")
  const echoed = record(session.config ?? root.config)
  const workbench = record(echoed.workbench)
  if (workbench.enable !== false) {
    throw safeProviderError("Composio did not confirm disabled workbench")
  }
  if (Object.prototype.hasOwnProperty.call(echoed, "toolkits")) {
    throw safeProviderError("Composio unexpectedly filtered the full toolkit catalog")
  }
  if (accountPin && Object.keys(echoed).length > 0) {
    const connectedAccounts = record(echoed.connected_accounts)
    const pinned = array(connectedAccounts[accountPin.toolkitId])
    if (Object.keys(connectedAccounts).length !== 1 || pinned.length !== 1 || pinned[0] !== accountPin.connectedAccountId) {
      throw safeProviderError("Composio did not preserve the exact connected-account pin")
    }
  }
  return { id, mcp: { url: normalizeMcpUrl(rawUrl, options).toString(), headers: optionalHeaders(mcp.headers) } }
}

export async function deleteComposioCatalogSession(
  options: ComposioCatalogBackendOptions,
  secret: ManagedConnectorSecret,
  sessionId: string,
): Promise<void> {
  const path = `/api/v3.1/tool_router/session/${encodeURIComponent(sessionId)}`
  try {
    await composioRequest(options, secret, "DELETE", path)
  } catch (error) {
    if (!(error instanceof McpError && record(error.details).status === 404)) throw error
  }
  try {
    await composioRequest(options, secret, "GET", path)
  } catch (error) {
    if (error instanceof McpError && record(error.details).status === 404) return
    throw error
  }
  throw safeProviderError("Composio Session cleanup could not be verified")
}

export async function resolveComposioCatalogSession(
  options: ComposioCatalogBackendOptions,
  input: {
    actor: McpActor
    secret: ManagedConnectorSecret
    accountPin?: ComposioAccountPin
    retainFailedCleanup?: (lease: { secret: ManagedConnectorSecret; sessionId: string }) => void
  },
): Promise<ComposioCatalogSession> {
  const body: Record<string, unknown> = {
    user_id: composioUserId(input.actor),
    mcp: true,
    manage_connections: { enable: true, enable_wait_for_connections: false },
    workbench: { enable: false },
  }
  if (input.accountPin) {
    body.connected_accounts = { [input.accountPin.toolkitId]: [input.accountPin.connectedAccountId] }
  }
  const payload = await composioRequest(options, input.secret, "POST", "/api/v3.1/tool_router/session", body, true)
  const sessionId = optionalString(sessionEnvelope(payload).id) ?? optionalString(sessionEnvelope(payload).session_id)
  try {
    if (JSON.stringify(payload).includes(input.secret.value)) {
      throw new McpError(MCP_ERROR_CODES.SECRET_LEAK_GUARD, "Composio Session response echoed the operator key")
    }
    return extractSession(payload, options, input.accountPin)
  } catch (error) {
    if (sessionId) {
      try {
        await deleteComposioCatalogSession(options, input.secret, sessionId)
      } catch {
        input.retainFailedCleanup?.({ secret: input.secret, sessionId })
      }
    }
    throw error
  }
}

export async function requireExactlyOneComposioAccount(
  options: ComposioCatalogBackendOptions,
  input: { actor: McpActor; secret: ManagedConnectorSecret; toolkitId: string },
): Promise<ComposioAccountPin> {
  const toolkitId = input.toolkitId.trim().toLowerCase()
  if (!toolkitId) throw new McpError(MCP_ERROR_CODES.INPUT_INVALID, "Composio toolkit is required")
  const items: unknown[] = []
  let cursor: string | undefined
  let expectedTotalItems: number | undefined

  for (let requestedPage = 1; requestedPage <= MAX_ACCOUNT_PAGES; requestedPage += 1) {
    const params = new URLSearchParams({ user_ids: composioUserId(input.actor), toolkit_slugs: toolkitId, limit: String(MAX_ACCOUNT_RESULTS) })
    if (cursor) params.set("cursor", cursor)
    const payload = await composioRequest(options, input.secret, "GET", `/api/v3.1/connected_accounts?${params}`)
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw safeProviderError("Composio connected-account response was malformed")
    }
    const root = payload as Record<string, unknown>
    if (!Array.isArray(root.items)) throw safeProviderError("Composio connected-account items were malformed")
    const totalPages = root.total_pages
    const currentPage = root.current_page
    const totalItems = root.total_items
    if (!Number.isInteger(totalPages) || !Number.isInteger(currentPage) || !Number.isInteger(totalItems)) {
      throw safeProviderError("Composio connected-account pagination was malformed")
    }
    if (root.items.length === 0 && totalPages === 0 && currentPage === 0 && totalItems === 0) {
      if (root.next_cursor != null) throw safeProviderError("Composio connected-account pagination was inconsistent")
      break
    }
    if (
      currentPage !== requestedPage
      || (totalPages as number) < requestedPage
      || (totalPages as number) > MAX_ACCOUNT_PAGES
      || (totalItems as number) < root.items.length
      || (totalItems as number) > MAX_TOTAL_ACCOUNTS
      || (expectedTotalItems !== undefined && totalItems !== expectedTotalItems)
    ) {
      throw safeProviderError("Composio connected-account pagination was malformed")
    }
    expectedTotalItems = totalItems as number
    items.push(...root.items)
    if (items.length > MAX_TOTAL_ACCOUNTS) throw safeProviderError("Composio connected-account result exceeded the size limit")

    const nextCursor = root.next_cursor
    const hasNextPage = requestedPage < (totalPages as number)
    if (hasNextPage) {
      if (typeof nextCursor !== "string" || !nextCursor.trim()) {
        throw safeProviderError("Composio connected-account continuation cursor was malformed")
      }
      cursor = nextCursor.trim()
      continue
    }
    if (nextCursor != null && (typeof nextCursor !== "string" || nextCursor.trim())) {
      throw safeProviderError("Composio connected-account pagination was inconsistent")
    }
    break
  }
  if (expectedTotalItems !== undefined && items.length !== expectedTotalItems) {
    throw safeProviderError("Composio connected-account result was incomplete")
  }

  const accounts = items.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw safeProviderError("Composio connected-account row was malformed")
    }
    const account = value as Record<string, unknown>
    const authConfig = record(account.auth_config)
    const id = optionalString(account.id)
    const userId = optionalString(account.user_id)
    const accountToolkit = optionalString(record(account.toolkit).slug)?.toLowerCase()
    const status = optionalString(account.status)
    const requiredNullableStrings = ["word_id", "alias", "status_reason"]
    const nullableStringsValid = requiredNullableStrings.every((key) => Object.prototype.hasOwnProperty.call(account, key) && (account[key] === null || typeof account[key] === "string"))
    const state = record(account.state)
    const stateValue = record(state.val)
    const statusAllowed = COMPOSIO_ACCOUNT_STATUSES.has(status ?? "")
    const authSchemeAllowed = COMPOSIO_AUTH_SCHEMES.has(optionalString(authConfig.auth_scheme) ?? "")
      && COMPOSIO_AUTH_SCHEMES.has(optionalString(state.authScheme) ?? "")
    const stateStatusAllowed = COMPOSIO_STATE_STATUSES.has(optionalString(stateValue.status) ?? "")
    if (
      !id || !userId || !accountToolkit || !statusAllowed
      || !nullableStringsValid
      || typeof account.created_at !== "string"
      || typeof account.updated_at !== "string"
      || !authSchemeAllowed
      || !stateStatusAllowed
      || !account.data || typeof account.data !== "object" || Array.isArray(account.data)
      || typeof account.is_disabled !== "boolean"
      || !optionalString(authConfig.id)
      || typeof authConfig.is_disabled !== "boolean"
      || typeof authConfig.is_composio_managed !== "boolean"
    ) {
      throw safeProviderError("Composio connected-account row was incomplete")
    }
    return { account, authConfig, id, userId, accountToolkit, status }
  })
  const active = accounts.flatMap(({ account, authConfig, id, userId, accountToolkit, status }): ComposioAccountPin[] => {
    const disabled = account.is_disabled || authConfig.is_disabled
    if (userId !== composioUserId(input.actor) || accountToolkit !== toolkitId || disabled) return []
    return status === "ACTIVE" ? [{ connectedAccountId: id, toolkitId }] : []
  })
  if (active.length === 0) {
    throw new McpError(MCP_ERROR_CODES.CONNECTED_ACCOUNT_REQUIRED, "Exactly one active connected account is required")
  }
  if (active.length > 1) {
    throw new McpError(MCP_ERROR_CODES.CONNECTED_ACCOUNT_CONFLICT, "Multiple active connected accounts require revoke-then-connect replacement")
  }
  return active[0]!
}

function mcpFetchForSession(options: ComposioCatalogBackendOptions, session: ComposioCatalogSession): typeof fetch {
  const expectedOrigin = new URL(session.mcp.url).origin
  const fetchImpl = options.mcpFetch ?? globalThis.fetch
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.origin !== expectedOrigin) throw safeProviderError("Composio MCP request changed origin")
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const signals = [controller.signal, init?.signal].filter((value): value is AbortSignal => Boolean(value))
    try {
      const response = await fetchImpl(input, { ...init, redirect: "error", signal: AbortSignal.any(signals) })
      const declared = Number(response.headers.get("content-length"))
      if (Number.isFinite(declared) && declared > maxBytes) {
        controller.abort()
        throw new McpError(MCP_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED, "Composio MCP response exceeded the size limit")
      }
      const reader = response.body?.getReader()
      if (!reader) {
        clearTimeout(timeout)
        return response
      }
      let length = 0
      const body = new ReadableStream<Uint8Array>({
        async pull(stream) {
          try {
            const { done, value } = await reader.read()
            if (done) {
              clearTimeout(timeout)
              stream.close()
              return
            }
            length += value.byteLength
            if (length > maxBytes) {
              await reader.cancel().catch(() => undefined)
              controller.abort()
              stream.error(new McpError(MCP_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED, "Composio MCP response exceeded the size limit"))
              return
            }
            stream.enqueue(value)
          } catch (error) {
            clearTimeout(timeout)
            stream.error(controller.signal.aborted
              ? new McpError(MCP_ERROR_CODES.PROVIDER_TIMEOUT, "Composio MCP request timed out")
              : error)
          }
        },
        async cancel(reason) {
          clearTimeout(timeout)
          controller.abort(reason)
          await reader.cancel(reason).catch(() => undefined)
        },
      })
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
    } catch (error) {
      clearTimeout(timeout)
      if (controller.signal.aborted && !(error instanceof McpError && error.code === MCP_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED)) {
        throw new McpError(MCP_ERROR_CODES.PROVIDER_TIMEOUT, "Composio MCP request timed out")
      }
      throw error
    }
  }) as typeof fetch
}

function jsonContent(value: unknown): unknown {
  for (const item of array(record(value).content)) {
    const text = optionalString(record(item).text)
    if (!text) continue
    try {
      return JSON.parse(text)
    } catch {
      // Ignore provider prose and continue to the bounded JSON payload.
    }
  }
  return undefined
}

function boundedSchema(value: unknown): unknown {
  const schema = value ?? {}
  if (Buffer.byteLength(JSON.stringify(schema), "utf8") > MAX_SCHEMA_BYTES) {
    throw new McpError(MCP_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED, "Composio tool schema exceeded the size limit")
  }
  return schema
}

function normalizeSchema(slug: string, value: unknown, fallbackToolkit?: string): McpManagedCatalogTool | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const schema = value as Record<string, unknown>
  const name = optionalString(schema.tool_slug)
  if (!name || name !== slug || name.startsWith("COMPOSIO_")) return undefined
  validateMcpToolName(name)
  const inputSchema = schema.input_schema
  if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema) || record(inputSchema).type !== "object") return undefined
  const toolkit = optionalString(schema.toolkit_slug)?.toLowerCase()
  if (!toolkit || (fallbackToolkit && toolkit !== fallbackToolkit)) return undefined
  const description = optionalString(schema.description)
  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    throw new McpError(MCP_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED, "Composio tool description exceeded the size limit")
  }
  return {
    name,
    description,
    inputSchema: boundedSchema(inputSchema),
    outputSchema: schema.output_schema === undefined ? undefined : boundedSchema(schema.output_schema),
    toolkit,
    version: optionalString(schema.version) ?? optionalString(schema.tool_version),
  }
}

function searchSlugs(payload: unknown, limit: number): Array<{ slug: string; toolkit?: string }> {
  const root = record(jsonContent(payload) ?? payload)
  const data = record(root.data ?? root)
  const results: Array<{ slug: string; toolkit?: string }> = []
  const seen = new Set<string>()
  for (const item of array(data.results)) {
    const result = record(item)
    const toolkits = [...new Set(array(result.toolkits).map(optionalString).filter((value): value is string => Boolean(value)).map((value) => value.toLowerCase()))]
    if (toolkits.length !== 1) continue
    const toolkit = toolkits[0]!
    for (const value of [...array(result.primary_tool_slugs), ...array(result.related_tool_slugs)]) {
      const slug = optionalString(value)
      if (!slug || slug.startsWith("COMPOSIO_") || seen.has(slug)) continue
      validateMcpToolName(slug)
      seen.add(slug)
      results.push({ slug, toolkit })
      if (results.length >= limit) return results
    }
  }
  return results
}

function schemasFromPayload(payload: unknown): Record<string, unknown> {
  const root = record(jsonContent(payload) ?? payload)
  const data = record(root.data ?? root)
  return record(data.tool_schemas ?? root.tool_schemas)
}

export interface ComposioCatalogBackend extends McpManagedCatalogBackend {
  /** Retry and verify every retained failed Session cleanup lease. */
  drain(): Promise<void>
}

function sanitizeCatalogError(error: unknown): McpError {
  if (error instanceof McpError) {
    return new McpError(error.code, error.code === MCP_ERROR_CODES.SECRET_LEAK_GUARD
      ? error.message
      : "Composio MCP catalog request failed")
  }
  return safeProviderError("Composio MCP catalog request failed")
}

async function withCatalogSession<T>(
  options: ComposioCatalogBackendOptions,
  source: McpSource,
  release: (secret: ManagedConnectorSecret, sessionId: string) => Promise<void>,
  retainFailedCleanup: (lease: { secret: ManagedConnectorSecret; sessionId: string }) => void,
  run: (session: ComposioCatalogSession, transport: ReturnType<typeof createMcpSdkStreamableHttpTransport>) => Promise<T>,
): Promise<T> {
  const secret = await options.secretResolver.resolveSecret(COMPOSIO_CATALOG_PROVIDER_ID)
  requireServerSecret(secret)
  const session = await resolveComposioCatalogSession(options, { actor: actorForSource(source), secret, retainFailedCleanup })
  const canaries = [secret.value, session.id, session.mcp.url, ...Object.values(session.mcp.headers ?? {})]
  const transport = createMcpSdkStreamableHttpTransport({
    endpoint: { url: session.mcp.url, headers: { ...(session.mcp.headers ?? {}), "x-api-key": secret.value } },
    clientName: options.clientName ?? "boring-mcp-composio-catalog",
    clientVersion: options.clientVersion ?? "0.0.0",
    fetch: mcpFetchForSession(options, session),
  })
  let outcome: { ok: true; value: T } | { ok: false; error: McpError }
  try {
    const sessionTools = await transport.listTools(source)
    const names = new Set(sessionTools.map((tool) => tool.name))
    if (!names.has(COMPOSIO_SEARCH_TOOLS) || !names.has(COMPOSIO_GET_TOOL_SCHEMAS)) {
      throw safeProviderError("Composio Session is missing controlled catalog tools")
    }
    if (names.has("COMPOSIO_REMOTE_BASH_TOOL") || names.has("COMPOSIO_REMOTE_WORKBENCH")) {
      throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, "Composio Session exposed disabled workbench capabilities")
    }
    const value = await run(session, transport)
    if (containsMcpSecretOrCanary(value, canaries)) {
      throw new McpError(MCP_ERROR_CODES.SECRET_LEAK_GUARD, "Composio catalog metadata contained server-only material")
    }
    outcome = { ok: true, value }
  } catch (error) {
    outcome = { ok: false, error: sanitizeCatalogError(error) }
  }

  try {
    await release(secret, session.id)
  } catch (cleanupError) {
    if (outcome.ok) throw cleanupError
  }
  if (!outcome.ok) throw outcome.error
  return outcome.value
}

function sourceCacheKey(source: McpSource): string {
  return `${source.workspaceId}:${source.userId}:${source.id}:${createMcpSourceRevision(source)}`
}

export function createComposioCatalogBackend(options: ComposioCatalogBackendOptions): ComposioCatalogBackend {
  const maxEntries = options.cacheEntries ?? DEFAULT_CACHE_ENTRIES
  const ttlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isFinite(ttlMs) || ttlMs < 1) {
    throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, "Composio catalog cache bounds are invalid")
  }
  const searchCache = new BoundedTtlCache<McpManagedCatalogTool[]>(maxEntries, ttlMs)
  const describeCache = new BoundedTtlCache<McpManagedCatalogTool>(maxEntries, ttlMs)
  const requestBudget = new BoundedTtlCache<{ calls: number }>(maxEntries, 60_000)
  const maxConcurrent = options.maxConcurrentRequests ?? 4
  const maxRequestsPerMinute = options.maxRequestsPerMinute ?? 60
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || !Number.isInteger(maxRequestsPerMinute) || maxRequestsPerMinute < 1) {
    throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, "Composio catalog request bounds are invalid")
  }
  let activeRequests = 0
  let cacheGeneration = 0
  const pendingCleanup = new Map<string, { secret: ManagedConnectorSecret; sessionId: string }>()

  function retainFailedCleanup(lease: { secret: ManagedConnectorSecret; sessionId: string }): void {
    pendingCleanup.set(lease.sessionId, lease)
  }

  async function release(secret: ManagedConnectorSecret, sessionId: string): Promise<void> {
    try {
      await deleteComposioCatalogSession(options, secret, sessionId)
      pendingCleanup.delete(sessionId)
    } catch (error) {
      retainFailedCleanup({ secret, sessionId })
      throw sanitizeCatalogError(error)
    }
  }

  async function drainPending(): Promise<void> {
    let firstError: McpError | undefined
    for (const { secret, sessionId } of [...pendingCleanup.values()]) {
      try {
        await release(secret, sessionId)
      } catch (error) {
        firstError ??= sanitizeCatalogError(error)
      }
    }
    if (firstError) throw firstError
  }

  async function guarded<T>(source: McpSource, run: () => Promise<T>): Promise<T> {
    await drainPending()
    if (activeRequests >= maxConcurrent) {
      throw new McpError(MCP_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED, "Composio catalog concurrency limit exceeded")
    }
    const key = `${source.workspaceId}:${source.userId}:${source.id}`
    const budget = requestBudget.get(key) ?? { calls: 0 }
    if (budget.calls >= maxRequestsPerMinute) {
      throw new McpError(MCP_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED, "Composio catalog request budget exceeded")
    }
    requestBudget.set(key, { calls: budget.calls + 1 })
    activeRequests += 1
    try {
      return await run()
    } finally {
      activeRequests -= 1
    }
  }

  return {
    drain: drainPending,

    supports(source) {
      return source.provider === COMPOSIO_CATALOG_PROVIDER_ID && source.credentialProvider === "composio-managed"
    },

    async searchTools(source, input) {
      const query = input.query.trim()
      if (!query || query.length > MAX_QUERY_LENGTH) {
        throw new McpError(MCP_ERROR_CODES.INPUT_INVALID, "Composio catalog query must be between 1 and 256 characters")
      }
      const sourceKey = sourceCacheKey(source)
      const key = `${sourceKey}:search:${query}:${input.offset}:${input.limit}`
      const previous = searchCache.get(key)
      if (!input.forceProviderRefresh && previous) return previous
      if (input.forceProviderRefresh) {
        cacheGeneration += 1
        searchCache.deletePrefix(`${sourceKey}:search:`)
        describeCache.deletePrefix(`${sourceKey}:describe:`)
      }
      const requestGeneration = cacheGeneration
      const tools = await guarded(source, () => withCatalogSession(options, source, release, retainFailedCleanup, async (session, transport) => {
        const search = await transport.callTool(source, COMPOSIO_SEARCH_TOOLS, { queries: [query], session: session.id })
        const slugs = searchSlugs(search, input.offset + input.limit).slice(input.offset)
        if (slugs.length === 0) return []
        const schemas = await transport.callTool(source, COMPOSIO_GET_TOOL_SCHEMAS, {
          tool_slugs: slugs.map(({ slug }) => slug),
          session_id: session.id,
        })
        const bySlug = schemasFromPayload(schemas)
        return slugs.flatMap(({ slug, toolkit }) => {
          const tool = normalizeSchema(slug, bySlug[slug], toolkit)
          return tool ? [tool] : []
        })
      }))
      if (requestGeneration === cacheGeneration) {
        searchCache.set(key, tools)
        for (const tool of tools) describeCache.set(`${sourceKey}:describe:${tool.name}`, tool)
      }
      return tools
    },

    async describeTool(source, toolName, input) {
      validateMcpToolName(toolName)
      if (toolName.startsWith("COMPOSIO_")) return undefined
      const key = `${sourceCacheKey(source)}:describe:${toolName}`
      if (!input.forceProviderRefresh) {
        const cached = describeCache.get(key)
        if (cached) return cached
      } else {
        cacheGeneration += 1
        const sourceKey = sourceCacheKey(source)
        searchCache.deletePrefix(`${sourceKey}:search:`)
        describeCache.deletePrefix(`${sourceKey}:describe:`)
      }
      const requestGeneration = cacheGeneration
      const tool = await guarded(source, () => withCatalogSession(options, source, release, retainFailedCleanup, async (session, transport) => {
        const result = await transport.callTool(source, COMPOSIO_GET_TOOL_SCHEMAS, {
          tool_slugs: [toolName],
          session_id: session.id,
        })
        return normalizeSchema(toolName, schemasFromPayload(result)[toolName])
      }))
      if (tool && requestGeneration === cacheGeneration) describeCache.set(key, tool)
      return tool
    },
  }
}
