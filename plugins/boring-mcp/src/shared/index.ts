export const BORING_MCP_PLUGIN_ID = "boring-mcp"
export const BORING_MCP_SOURCES_TAB_PANEL_ID = "boring-mcp.sources.tab"
export const BORING_MCP_SOURCES_PANEL_ID = "boring-mcp.sources.panel"

export const MCP_ERROR_CODES = {
  SOURCE_NOT_FOUND: "MCP_SOURCE_NOT_FOUND",
  SOURCE_FORBIDDEN: "MCP_SOURCE_FORBIDDEN",
  SOURCE_UNAVAILABLE: "MCP_SOURCE_UNAVAILABLE",
  PROVIDER_CONFIG_INVALID: "MCP_PROVIDER_CONFIG_INVALID",
  PROVIDER_TIMEOUT: "MCP_PROVIDER_TIMEOUT",
  PROVIDER_ERROR: "MCP_PROVIDER_ERROR",
  TOOL_NOT_FOUND: "MCP_TOOL_NOT_FOUND",
  TOOL_NOT_ALLOWED: "MCP_TOOL_NOT_ALLOWED",
  PROVIDER_TOOL_DRIFT: "MCP_PROVIDER_TOOL_DRIFT",
  RESOURCE_LIMIT_EXCEEDED: "MCP_RESOURCE_LIMIT_EXCEEDED",
  SECRET_LEAK_GUARD: "MCP_SECRET_LEAK_GUARD",
  INPUT_INVALID: "MCP_INPUT_INVALID",
  RESOURCE_URI_INVALID: "MCP_RESOURCE_URI_INVALID",
  USER_REGISTERED_SOURCE_DISABLED: "MCP_USER_REGISTERED_SOURCE_DISABLED",
  USER_REGISTERED_ENDPOINT_SCHEME_INVALID: "MCP_USER_REGISTERED_ENDPOINT_SCHEME_INVALID",
  USER_REGISTERED_ENDPOINT_HOST_BLOCKED: "MCP_USER_REGISTERED_ENDPOINT_HOST_BLOCKED",
  USER_REGISTERED_ENDPOINT_CREDENTIALS_INVALID: "MCP_USER_REGISTERED_ENDPOINT_CREDENTIALS_INVALID",
  USER_REGISTERED_ENDPOINT_TRANSPORT_INVALID: "MCP_USER_REGISTERED_ENDPOINT_TRANSPORT_INVALID",
} as const

export type McpErrorCode = (typeof MCP_ERROR_CODES)[keyof typeof MCP_ERROR_CODES]
export const USER_REGISTERED_MCP_PROVIDER_ID = "user-registered" as const
/**
 * "user-registered" is an explicit discriminator for caller-supplied MCP
 * endpoints (see {@link McpUserRegisteredSourceConfig}), distinct from the
 * untyped `(string & {})` escape hatch used for forward-compatible provider
 * ids. It never appears in {@link DEFAULT_MCP_PROVIDER_TEMPLATES}.
 */
export type McpProviderId = "notion" | "airtable" | typeof USER_REGISTERED_MCP_PROVIDER_ID | (string & {})
export type McpTransport = "streamable-http"
export type McpSourceStatus = "connected" | "expired" | "revoked" | "error" | "unconfigured"
export type McpToolRisk = "read" | "write" | "admin" | "unknown"
export type McpCredentialProvider = "provider-managed" | "composio-managed" | "app-managed" | "user-managed" | (string & {})
export type McpSourceOwnerKind = "user" | "company_context" | "team_context" | "project_context"

export interface McpActor {
  userId: string
  workspaceId: string
  isAdmin?: boolean
}

export interface McpProviderTemplate {
  id: McpProviderId
  displayName: string
  endpoint?: string
  transport?: McpTransport
  readOnlyDefault: boolean
  allowedTools: string[]
  deniedTools: string[]
  allowedResourceUriPrefixes?: string[]
}

export interface McpConnectorRef {
  provider: McpProviderId
  toolkitId?: string
  externalSourceId?: string
  connectedAccountId?: string
  sessionId?: string
}

export interface McpSource {
  id: string
  workspaceId: string
  userId: string
  provider: McpProviderId
  displayName: string
  status: McpSourceStatus
  ownerKind: McpSourceOwnerKind
  credentialProvider: McpCredentialProvider
  scopes?: string[]
  providerAccountLabel?: string
  connectorRef?: McpConnectorRef
  lastVerifiedAt?: string
  createdAt?: string
  updatedAt?: string
}

/** Source whose network endpoint originated at the user-registration boundary. */
export interface McpUserRegisteredSource extends McpSource {
  provider: typeof USER_REGISTERED_MCP_PROVIDER_ID
}

export function isUserRegisteredMcpSource(source: McpSource): source is McpUserRegisteredSource {
  return source.provider === USER_REGISTERED_MCP_PROVIDER_ID
}

export type McpSourceDto = Pick<
  McpSource,
  | "id"
  | "provider"
  | "displayName"
  | "status"
  | "ownerKind"
  | "credentialProvider"
  | "scopes"
  | "providerAccountLabel"
  | "lastVerifiedAt"
  | "createdAt"
  | "updatedAt"
>

export interface McpDiscoveredTool {
  name: string
  description?: string
  inputSchema?: unknown
}

export interface McpDiscoveredResource {
  uri: string
  name?: string
  description?: string
  mimeType?: string
}

export interface McpToolDecision {
  allowed: boolean
  risk: McpToolRisk
  reason: string
}

export interface McpProbeResult {
  sourceId: string
  provider: McpProviderId
  tools: Array<McpDiscoveredTool & { decision: McpToolDecision }>
  resources: McpDiscoveredResource[]
}

export interface McpDoctorIssue {
  level: "error" | "warning"
  code: McpErrorCode
  message: string
}

export interface McpDoctorResult {
  ok: boolean
  sourceId: string
  issues: McpDoctorIssue[]
}

export interface McpToolCatalogEntry {
  sourceId: string
  provider: McpProviderId
  toolName: string
  displayName: string
  summary: string
  description?: string
  inputSchema: unknown
  outputSchema?: unknown
  risk: McpToolRisk
  enabled: boolean
  blockedReasons: string[]
  schemaHash: string
  nativeRef: {
    provider: string
    toolkit?: string
    action: string
  }
}

export type NormalizedMcpTool = McpToolCatalogEntry

export interface McpToolSearchResult {
  tools: McpToolCatalogEntry[]
}

export interface McpToolDescribeResult {
  tool: McpToolCatalogEntry
  schemaDrifted: boolean
}

export interface McpReadonlyCallInput {
  sourceId: string
  toolName: string
  input?: unknown
  expectedSchemaHash?: string
}

export interface McpReadonlyCallResult {
  content: unknown
}

export interface McpReadonlyCallAuditEvent {
  operation: "mcp_readonly_call"
  outcome: "success" | "blocked" | "failure"
  workspaceId: string
  userId: string
  sourceId: string
  toolName: string
  expectedSchemaHash?: string
  code?: string
}

export interface McpToolCallResult {
  content: unknown
}

export interface McpSourceStore {
  listSources(actor: McpActor): Promise<McpSource[]>
  getSource(sourceId: string): Promise<McpSource | undefined>
}

export interface McpSourceRegistry extends McpSourceStore {
  disconnectSource?(actor: McpActor, sourceId: string): Promise<McpSource | undefined>
}

export interface McpSourceStatusPayload {
  source: McpSourceDto
  connectable: boolean
  canProbe: boolean
  canDisconnect: boolean
}

export function toMcpSourceDto(source: McpSource): McpSourceDto {
  return {
    id: source.id,
    provider: source.provider,
    displayName: source.displayName,
    status: source.status,
    ownerKind: source.ownerKind,
    credentialProvider: source.credentialProvider,
    scopes: source.scopes,
    providerAccountLabel: source.providerAccountLabel,
    lastVerifiedAt: source.lastVerifiedAt,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  }
}

export interface McpTransportListToolsOptions {
  /** Force bypassing provider-level metadata caches, not just local catalog caches. */
  forceProviderRefresh?: boolean
}

export interface McpTransportClient {
  listTools(source: McpSource, options?: McpTransportListToolsOptions): Promise<McpDiscoveredTool[]>
  listResources(source: McpSource): Promise<McpDiscoveredResource[]>
  readResource(source: McpSource, uri: string): Promise<unknown>
  callTool(source: McpSource, toolName: string, input: unknown): Promise<McpToolCallResult>
}

export interface McpSourceAccessPolicy {
  canAccessSource(actor: McpActor, source: McpSource): boolean
}

export class McpError extends Error {
  readonly code: McpErrorCode
  readonly details: unknown

  constructor(code: McpErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = "McpError"
    this.code = code
    this.details = details
  }
}

export const NOTION_MCP_TEMPLATE: McpProviderTemplate = {
  id: "notion",
  displayName: "Notion",
  readOnlyDefault: true,
  allowedTools: ["NOTION_SEARCH_NOTION_PAGE", "NOTION_GET_PAGE_MARKDOWN", "NOTION_RETRIEVE_PAGE"],
  deniedTools: ["create_*", "update_*", "delete_*", "publish_*", "admin_*"],
  allowedResourceUriPrefixes: ["notion:", "notion://"],
}

export const AIRTABLE_MCP_TEMPLATE: McpProviderTemplate = {
  id: "airtable",
  displayName: "Airtable",
  readOnlyDefault: true,
  allowedTools: ["ping", "list_bases", "list_workspaces", "list_tables_for_base", "get_table_schema", "search_records"],
  deniedTools: ["create_*", "update_*", "delete_*", "publish_*", "admin_*"],
  allowedResourceUriPrefixes: ["airtable:", "airtable://"],
}

export const DEFAULT_MCP_PROVIDER_TEMPLATES = [NOTION_MCP_TEMPLATE, AIRTABLE_MCP_TEMPLATE] as const

/**
 * A user-supplied MCP server registration. This is the escape hatch for
 * endpoints outside {@link DEFAULT_MCP_PROVIDER_TEMPLATES} — no credential
 * value ever lives here (see plan #1011: credential custody is a separate,
 * currently-blocked slice). `headerNames` only records which header keys the
 * transport should attach at call time from wherever credentials eventually
 * come from.
 *
 * `enabled` is a required, explicit opt-in: {@link createUserRegisteredMcpProviderTemplate}
 * default-denies (`USER_REGISTERED_SOURCE_DISABLED`) unless it is `true`. A
 * user-registered source is never admitted implicitly.
 */
export interface McpUserRegisteredSourceConfig {
  enabled: boolean
  endpoint: string
  displayName: string
  transport?: McpTransport
  headerNames?: string[]
  allowedTools?: string[]
  deniedTools?: string[]
  allowedResourceUriPrefixes?: string[]
}

const BLOCKED_HOSTNAME_SUFFIXES = [".local", ".internal", ".localhost"]
const BLOCKED_HOSTNAME_EXACT = new Set(["localhost", "metadata.google.internal"])

function ipv4OctetsFromHostname(hostname: string): number[] | undefined {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (!match) return undefined
  const octets = match.slice(1, 5).map(Number)
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : undefined
}

function isBlockedIpv4(octets: number[]): boolean {
  const [a, b] = octets
  if (a === 127) return true // loopback
  if (a === 10) return true // private
  if (a === 0) return true // "this network"
  if (a === 169 && b === 254) return true // link-local + cloud metadata service (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true // private
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  return false
}

function ipv4OctetsFromHexWords(high: number, low: number): number[] {
  return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff]
}

/** Expands every valid IPv6 spelling, including dotted IPv4 tails, into eight 16-bit words. */
function ipv6Words(hostname: string): number[] | undefined {
  let normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase().split("%")[0]
  const dottedTail = normalized.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1]
  if (dottedTail) {
    const octets = ipv4OctetsFromHostname(dottedTail)
    if (!octets) return undefined
    const high = ((octets[0] << 8) | octets[1]).toString(16)
    const low = ((octets[2] << 8) | octets[3]).toString(16)
    normalized = `${normalized.slice(0, -dottedTail.length)}${high}:${low}`
  }

  const halves = normalized.split("::")
  if (halves.length > 2) return undefined
  const left = halves[0] ? halves[0].split(":") : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : []
  if ([...left, ...right].some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return undefined
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return undefined
  return [...left, ...Array(missing).fill("0"), ...right].map((word) => Number.parseInt(word, 16))
}

function isBlockedIpv6(hostname: string): boolean {
  const words = ipv6Words(hostname)
  if (!words) return false
  if (words.slice(0, 7).every((word) => word === 0) && words[7] <= 1) return true // unspecified + loopback
  if ((words[0] & 0xffc0) === 0xfe80) return true // link-local fe80::/10
  if ((words[0] & 0xffc0) === 0xfec0) return true // deprecated site-local fec0::/10
  if ((words[0] & 0xfe00) === 0xfc00) return true // unique-local fc00::/7

  const mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff
  const compatible = words.slice(0, 6).every((word) => word === 0)
  if ((mapped || compatible) && isBlockedIpv4(ipv4OctetsFromHexWords(words[6], words[7]))) return true

  const nat64 = words[0] === 0x64 && words[1] === 0xff9b && words.slice(2, 6).every((word) => word === 0)
  if (nat64 && isBlockedIpv4(ipv4OctetsFromHexWords(words[6], words[7]))) return true
  if (words[0] === 0x2002 && isBlockedIpv4(ipv4OctetsFromHexWords(words[1], words[2]))) return true // 6to4
  return false
}

/** Applies the MCP private/metadata/loopback/link-local blocklist to an IP address returned by DNS. */
export function isBlockedMcpEndpointIpAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "")
  const ipv4 = ipv4OctetsFromHostname(normalized)
  if (ipv4) return isBlockedIpv4(ipv4)
  return normalized.includes(":") && isBlockedIpv6(normalized)
}

function isBlockedHostname(hostname: string): boolean {
  // Resolvers treat a single trailing root dot as equivalent to no dot
  // ("localhost." === "localhost"); strip it before every other check.
  const lower = hostname.toLowerCase().replace(/\.$/, "")
  if (BLOCKED_HOSTNAME_EXACT.has(lower)) return true
  if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return true
  return isBlockedMcpEndpointIpAddress(lower)
}

/**
 * SYNTACTIC PRE-FILTER, NOT AN SSRF CONTROL. This function inspects the
 * literal endpoint string only: https-only, no credentials embedded in the
 * URL, and a hostname/IP-literal blocklist covering loopback / link-local /
 * private-network / cloud-metadata-service addresses. It never resolves DNS,
 * so an attacker-controlled A record (e.g. `evil.example` -> 169.254.169.254,
 * or a wildcard DNS rebinding host such as `127.0.0.1.nip.io`) sails through
 * unchanged, and nothing here prevents a validated `https://` endpoint from
 * later issuing an HTTP redirect to a private address at connect time.
 *
 * This validator MUST NOT be treated as sufficient by itself. The server-side
 * SDK transport adds connect-time resolve-then-pin enforcement and refuses
 * redirects when the source carries typed user-registered provenance. Other
 * transports must provide equivalent enforcement or route through a trusted
 * egress allowlist/proxy.
 *
 * Throws {@link McpError} with a stable code per rejection reason.
 */
export function validateUserRegisteredMcpEndpoint(endpoint: string, transport?: McpTransport): URL {
  if (transport && transport !== "streamable-http") {
    throw new McpError(
      MCP_ERROR_CODES.USER_REGISTERED_ENDPOINT_TRANSPORT_INVALID,
      "User-registered MCP sources only support the streamable-http transport",
    )
  }
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new McpError(MCP_ERROR_CODES.USER_REGISTERED_ENDPOINT_SCHEME_INVALID, "Invalid MCP endpoint URL")
  }
  if (url.protocol !== "https:") {
    throw new McpError(
      MCP_ERROR_CODES.USER_REGISTERED_ENDPOINT_SCHEME_INVALID,
      "User-registered MCP endpoints must use https",
    )
  }
  if (url.username || url.password) {
    throw new McpError(
      MCP_ERROR_CODES.USER_REGISTERED_ENDPOINT_CREDENTIALS_INVALID,
      "User-registered MCP endpoints must not embed credentials in the URL",
    )
  }
  if (isBlockedHostname(url.hostname)) {
    throw new McpError(
      MCP_ERROR_CODES.USER_REGISTERED_ENDPOINT_HOST_BLOCKED,
      "User-registered MCP endpoint host is not allowed (loopback, link-local, private, or metadata-service address)",
    )
  }
  return url
}

/**
 * Builds a {@link McpProviderTemplate} for a user-registered source. This is
 * the plugin's intended admission point for the escape hatch: it is
 * default-deny (throws `USER_REGISTERED_SOURCE_DISABLED` unless
 * `config.enabled === true`) and always runs the endpoint through the
 * syntactic pre-filter {@link validateUserRegisteredMcpEndpoint} before
 * returning a template, regardless of caller. It never mutates
 * {@link DEFAULT_MCP_PROVIDER_TEMPLATES}.
 *
 * `McpProviderTemplate` is a plain structural type, so nothing stops a caller
 * from hand-constructing a `{ id: "user-registered", endpoint: ... }` object
 * and bypassing this factory entirely. {@link getMcpProviderTemplate} — the
 * shared lookup used by every consumption point — re-runs the same
 * validation on any template whose id is `"user-registered"` and silently
 * drops it (returns `undefined`) if the endpoint doesn't pass, so a
 * hand-crafted bypass template is rejected as "unknown provider" rather than
 * being trusted. This is a runtime guard, not type-level branding: it was
 * chosen over branding the interface because branding `McpProviderTemplate`
 * would ripple across every call site that constructs or clones a template.
 * The server-side SDK transport closes the connect-time DNS/TOCTOU gap for
 * sources carrying this typed provider provenance; other transports must do
 * the same before accepting this template.
 */
export function createUserRegisteredMcpProviderTemplate(config: McpUserRegisteredSourceConfig): McpProviderTemplate {
  if (!config.enabled) {
    throw new McpError(
      MCP_ERROR_CODES.USER_REGISTERED_SOURCE_DISABLED,
      "User-registered MCP sources must be explicitly enabled",
    )
  }
  const url = validateUserRegisteredMcpEndpoint(config.endpoint, config.transport)
  return {
    id: USER_REGISTERED_MCP_PROVIDER_ID,
    displayName: config.displayName,
    endpoint: url.toString(),
    transport: "streamable-http",
    readOnlyDefault: true,
    allowedTools: config.allowedTools ?? [],
    deniedTools: config.deniedTools ?? ["create_*", "update_*", "delete_*", "publish_*", "admin_*"],
    allowedResourceUriPrefixes: config.allowedResourceUriPrefixes,
  }
}

/** Re-validates a "user-registered" template's endpoint at lookup time, guarding against hand-constructed bypass templates (see doc comment on {@link createUserRegisteredMcpProviderTemplate}). */
function isValidUserRegisteredTemplate(template: McpProviderTemplate): boolean {
  if (!template.endpoint) return false
  try {
    validateUserRegisteredMcpEndpoint(template.endpoint, template.transport)
    return true
  } catch {
    return false
  }
}

export function getMcpProviderTemplate(
  provider: string,
  templates: readonly McpProviderTemplate[] = DEFAULT_MCP_PROVIDER_TEMPLATES,
): McpProviderTemplate | undefined {
  const template = templates.find((template) => template.id === provider)
  if (template && template.id === "user-registered" && !isValidUserRegisteredTemplate(template)) return undefined
  return template
}

export const MCP_TOOL_NAME_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/

export function validateMcpToolName(toolName: string): void {
  if (!MCP_TOOL_NAME_PATTERN.test(toolName)) {
    throw new McpError(MCP_ERROR_CODES.INPUT_INVALID, "Invalid MCP tool name")
  }
}

function wildcardMatch(pattern: string, value: string): boolean {
  if (!pattern.includes("*")) return pattern === value
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
  return new RegExp(`^${escaped}$`, "i").test(value)
}

export function classifyMcpTool(template: McpProviderTemplate, toolName: string): McpToolDecision {
  validateMcpToolName(toolName)
  if (template.deniedTools.some((pattern) => wildcardMatch(pattern, toolName))) {
    return { allowed: false, risk: "write", reason: "Tool matches a denied write/admin pattern" }
  }
  if (template.allowedTools.some((pattern) => wildcardMatch(pattern, toolName))) {
    return { allowed: true, risk: "read", reason: "Tool is on the read-only allowlist" }
  }
  return { allowed: false, risk: "unknown", reason: "Tool is not on the read-only allowlist" }
}

export function classifyMcpTools(template: McpProviderTemplate, tools: readonly McpDiscoveredTool[]): Array<McpDiscoveredTool & { decision: McpToolDecision }> {
  return tools.map((tool) => ({ ...tool, decision: classifyMcpTool(template, tool.name) }))
}

export function assertMcpToolAllowed(template: McpProviderTemplate, toolName: string): void {
  const decision = classifyMcpTool(template, toolName)
  if (!decision.allowed) throw new McpError(MCP_ERROR_CODES.TOOL_NOT_ALLOWED, decision.reason)
}

const REDACTION = "[REDACTED_MCP_SECRET]"
const SECRET_KEY_PATTERN = /(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|oauth[_-]?token|authorization|cookie|client[_-]?secret|session[_-]?headers?|mcp[_-]?session|x-composio-mcp-session)/i
const SECRET_VALUE_PATTERN = /(Bearer\s+[A-Za-z0-9._~+\/-]{12,}|sk-[A-Za-z0-9_-]{12,}|(?:x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|oauth[_-]?token|code|client[_-]?secret|session[_-]?headers?|mcp[_-]?session|x-composio-mcp-session)\s*[:=]\s*[^\s,&,}]+)/gi

export function redactMcpSecrets(value: unknown): unknown {
  if (typeof value === "string") return value.replace(SECRET_VALUE_PATTERN, REDACTION)
  if (Array.isArray(value)) return value.map(redactMcpSecrets)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, SECRET_KEY_PATTERN.test(key) ? REDACTION : redactMcpSecrets(nested)]))
}

export function containsMcpSecret(value: unknown): boolean {
  const redacted = redactMcpSecrets(value)
  return JSON.stringify(redacted) !== JSON.stringify(value)
}

function hasMcpCanaryText(value: string, canaries: readonly string[]): boolean {
  return canaries.some((canary) => canary.trim() && value.includes(canary))
}

export function containsMcpCanary(value: unknown, canaries: readonly string[]): boolean {
  if (typeof value === "string") return hasMcpCanaryText(value, canaries)
  if (Array.isArray(value)) return value.some((item) => containsMcpCanary(item, canaries))
  if (!value || typeof value !== "object") return false
  return Object.entries(value).some(([key, nested]) => hasMcpCanaryText(key, canaries) || containsMcpCanary(nested, canaries))
}

export function containsMcpSecretOrCanary(value: unknown, canaries: readonly string[]): boolean {
  return containsMcpSecret(value) || containsMcpCanary(value, canaries)
}

export function doctorMcpSource(source: McpSource, templates: readonly McpProviderTemplate[] = DEFAULT_MCP_PROVIDER_TEMPLATES): McpDoctorResult {
  const issues: McpDoctorIssue[] = []
  if (!getMcpProviderTemplate(source.provider, templates)) {
    issues.push({ level: "error", code: MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, message: "Unknown MCP provider template" })
  }
  if (source.status !== "connected") {
    issues.push({ level: "warning", code: MCP_ERROR_CODES.SOURCE_UNAVAILABLE, message: "MCP source is not connected" })
  }
  return { ok: issues.every((issue) => issue.level !== "error"), sourceId: source.id, issues }
}

export class McpAccessFacade {
  constructor(
    private readonly params: {
      store: McpSourceStore
      transport: McpTransportClient
      templates?: readonly McpProviderTemplate[]
      maxInputBytes?: number
      accessPolicy?: McpSourceAccessPolicy
    },
  ) {}

  async listSources(actor: McpActor): Promise<McpSource[]> {
    return (await this.params.store.listSources(actor)).filter((source) => this.canAccessSource(actor, source))
  }

  async probeSource(actor: McpActor, sourceId: string): Promise<McpProbeResult> {
    const source = await this.requireAccessibleSource(actor, sourceId)
    this.requireConnectedSource(source)
    const template = this.requireTemplate(source)
    const [tools, resources] = await Promise.all([
      this.params.transport.listTools(source),
      this.params.transport.listResources(source),
    ])
    return {
      sourceId: source.id,
      provider: source.provider,
      tools: classifyMcpTools(template, tools),
      resources,
    }
  }


  private async requireAccessibleSource(actor: McpActor, sourceId: string): Promise<McpSource> {
    const source = await this.params.store.getSource(sourceId)
    if (!source || source.workspaceId !== actor.workspaceId) {
      throw new McpError(MCP_ERROR_CODES.SOURCE_NOT_FOUND, "MCP source not found")
    }
    if (!this.canAccessSource(actor, source)) throw new McpError(MCP_ERROR_CODES.SOURCE_NOT_FOUND, "MCP source not found")
    return source
  }

  private canAccessSource(actor: McpActor, source: McpSource): boolean {
    if (source.workspaceId !== actor.workspaceId) return false
    return this.params.accessPolicy?.canAccessSource(actor, source)
      ?? (source.ownerKind === "user" && source.userId === actor.userId)
  }

  private requireConnectedSource(source: McpSource): void {
    if (source.status !== "connected") throw new McpError(MCP_ERROR_CODES.SOURCE_UNAVAILABLE, "MCP source is not connected")
  }

  private requireTemplate(source: McpSource): McpProviderTemplate {
    const template = getMcpProviderTemplate(source.provider, this.params.templates)
    if (!template) throw new McpError(MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID, "Unknown MCP provider")
    return template
  }
}
