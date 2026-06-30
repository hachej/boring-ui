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
} as const

export type McpErrorCode = (typeof MCP_ERROR_CODES)[keyof typeof MCP_ERROR_CODES]
export type McpProviderId = "notion" | "airtable" | (string & {})
export type McpTransport = "streamable-http" | "sse" | "stdio"
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
  | "connectorRef"
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
    connectorRef: source.connectorRef,
    lastVerifiedAt: source.lastVerifiedAt,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  }
}

export interface McpTransportClient {
  listTools(source: McpSource): Promise<McpDiscoveredTool[]>
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

export function getMcpProviderTemplate(
  provider: string,
  templates: readonly McpProviderTemplate[] = DEFAULT_MCP_PROVIDER_TEMPLATES,
): McpProviderTemplate | undefined {
  return templates.find((template) => template.id === provider)
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

export function doctorMcpSource(source: McpSource, templates = DEFAULT_MCP_PROVIDER_TEMPLATES): McpDoctorResult {
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
      tools: tools.map((tool) => ({ ...tool, decision: classifyMcpTool(template, tool.name) })),
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
