import { createHash } from "node:crypto"
import {
  MCP_ERROR_CODES,
  McpError,
  classifyMcpTool,
  containsMcpSecret,
  getMcpProviderTemplate,
  type McpActor,
  type McpDiscoveredTool,
  type McpProviderId,
  type McpProviderTemplate,
  type McpSource,
  type McpSourceRegistry,
  type McpToolCatalogEntry,
  type McpToolDescribeResult,
  type McpToolSearchResult,
  type McpTransportClient,
} from "../shared"
import { assertMcpPublicPayloadSecretFree, requireActorOwnedMcpSource, validateMcpSourceId } from "./sourceAccess"

interface McpToolCatalogSnapshot {
  sourceId: string
  provider: McpProviderId
  sourceRevision: string
  tools: McpToolCatalogEntry[]
}

export interface McpToolCatalogCache {
  get(actor: McpActor, sourceId: string): Promise<McpToolCatalogSnapshot | undefined>
  set(actor: McpActor, sourceId: string, result: McpToolCatalogSnapshot): Promise<void>
}

export interface McpManagedToolSearchInput {
  query: string
  limit: number
  forceProviderRefresh?: boolean
}

export interface McpManagedCatalogAdapter {
  supports(source: McpSource): boolean
  searchTools(source: McpSource, input: McpManagedToolSearchInput): Promise<McpDiscoveredTool[]>
  describeTool(source: McpSource, toolName: string, input?: { forceProviderRefresh?: boolean }): Promise<McpDiscoveredTool>
  disposeSource?(source: McpSource): Promise<void>
}

export interface BoringMcpToolCatalogOptions {
  registry: McpSourceRegistry
  transport: McpTransportClient
  managedCatalog?: McpManagedCatalogAdapter
  templates?: readonly McpProviderTemplate[]
  cache?: McpToolCatalogCache
}

export interface McpToolsSearchInput {
  sourceId?: string
  query?: string
  limit?: number
  refresh?: boolean
  providerRefresh?: boolean
}

export interface McpToolDescribeInput {
  sourceId: string
  toolName: string
  expectedSchemaHash?: string
  refresh?: boolean
  providerRefresh?: boolean
}

export interface BoringMcpToolCatalog {
  searchTools(actor: McpActor, input?: McpToolsSearchInput): Promise<McpToolSearchResult>
  describeTool(actor: McpActor, input: McpToolDescribeInput): Promise<McpToolDescribeResult>
}

export class InMemoryMcpToolCatalogCache implements McpToolCatalogCache {
  private readonly values = new Map<string, McpToolCatalogSnapshot>()

  async get(actor: McpActor, sourceId: string): Promise<McpToolCatalogSnapshot | undefined> {
    return this.values.get(`${actor.workspaceId}:${actor.userId}:${sourceId}`)
  }

  async set(actor: McpActor, sourceId: string, result: McpToolCatalogSnapshot): Promise<void> {
    this.values.set(`${actor.workspaceId}:${actor.userId}:${sourceId}`, result)
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (!value || typeof value !== "object") return JSON.stringify(value)
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`
}

export function createMcpSchemaHash(schema: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(schema ?? {})).digest("hex")}`
}

function displayName(toolName: string): string {
  return toolName.replace(/[_:.-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

function sourceCatalogRevision(source: { status: string; updatedAt?: string; connectorRef?: { sessionId?: string; connectedAccountId?: string; externalSourceId?: string } }): string {
  return createHash("sha256").update(JSON.stringify({
    status: source.status,
    updatedAt: source.updatedAt,
    sessionId: source.connectorRef?.sessionId,
    connectedAccountId: source.connectorRef?.connectedAccountId,
    externalSourceId: source.connectorRef?.externalSourceId,
  })).digest("hex")
}

export interface NormalizeMcpCatalogToolContext {
  sourceRevision?: string
  accountRequired?: boolean
}

export function normalizeMcpCatalogTool(
  sourceId: string,
  provider: McpProviderId,
  tool: McpDiscoveredTool,
  templates?: readonly McpProviderTemplate[],
  context: NormalizeMcpCatalogToolContext = {},
): McpToolCatalogEntry {
  const template = getMcpProviderTemplate(provider, templates)
  const decision = template
    ? classifyMcpTool(template, tool.name)
    : { allowed: false, risk: "unknown" as const, reason: "Tool provider has no read-only allowlist" }
  const inputSchema = tool.inputSchema ?? {}
  const policyRevision = createMcpSchemaHash({ template, decision })
  const descriptorHash = createMcpSchemaHash({
    provider,
    toolkit: tool.toolkit,
    toolName: tool.name,
    version: tool.version,
    inputSchema,
    outputSchema: tool.outputSchema,
    annotations: tool.annotations,
    sourceRevision: context.sourceRevision,
    policyRevision,
    accountRequired: context.accountRequired,
  })
  return {
    sourceId,
    provider,
    toolName: tool.name,
    displayName: displayName(tool.name),
    summary: tool.description ?? displayName(tool.name),
    description: tool.description,
    inputSchema,
    outputSchema: tool.outputSchema,
    providerVersion: tool.version,
    annotations: tool.annotations,
    descriptorHash,
    sourceRevision: context.sourceRevision,
    policyRevision,
    accountRequired: context.accountRequired,
    risk: decision.risk,
    enabled: decision.allowed,
    blockedReasons: decision.allowed ? [] : [decision.reason],
    schemaHash: createMcpSchemaHash(inputSchema),
    nativeRef: { provider, toolkit: tool.toolkit, action: tool.name },
  }
}

function matchesQuery(entry: McpToolCatalogEntry, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return [entry.toolName, entry.displayName, entry.summary, entry.description, entry.provider]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalized))
}

function assertConnectedSource(sourceId: string, status: string): void {
  if (status !== "connected") {
    throw new McpError(MCP_ERROR_CODES.SOURCE_UNAVAILABLE, `MCP source ${sourceId} is not connected`)
  }
}

export function createBoringMcpToolCatalog(options: BoringMcpToolCatalogOptions): BoringMcpToolCatalog {
  const cache = options.cache ?? new InMemoryMcpToolCatalogCache()

  async function requireConnectedSource(actor: McpActor, sourceId: string): Promise<McpSource> {
    const requestedSourceId = validateMcpSourceId(sourceId)
    const source = await requireActorOwnedMcpSource(options.registry, actor, requestedSourceId)
    assertConnectedSource(source.id, source.status)
    return source
  }

  async function loadSourceCatalog(actor: McpActor, sourceId: string, refresh?: boolean, providerRefresh?: boolean): Promise<McpToolCatalogSnapshot> {
    const requestedSourceId = validateMcpSourceId(sourceId)
    const source = await requireActorOwnedMcpSource(options.registry, actor, requestedSourceId)
    const resolvedSourceId = validateMcpSourceId(source.id)
    assertConnectedSource(resolvedSourceId, source.status)

    const sourceRevision = sourceCatalogRevision(source)
    if (!refresh && !providerRefresh) {
      const cached = await cache.get(actor, resolvedSourceId)
      if (cached && cached.provider === source.provider && cached.sourceRevision === sourceRevision) return cached
    }

    const discoveredTools = await options.transport.listTools(source, { forceProviderRefresh: providerRefresh ?? refresh })
    const normalizationContext = {
      sourceRevision,
      accountRequired: source.credentialProvider === "composio-managed",
    }
    const tools = discoveredTools.map((tool) => normalizeMcpCatalogTool(resolvedSourceId, source.provider, tool, options.templates, normalizationContext))
    const snapshot = { sourceId: resolvedSourceId, provider: source.provider, sourceRevision, tools }
    assertMcpPublicPayloadSecretFree(snapshot)
    await cache.set(actor, resolvedSourceId, snapshot)
    return snapshot
  }

  return {
    async searchTools(actor, input = {}) {
      const sources = input.sourceId
        ? [await requireConnectedSource(actor, input.sourceId)]
        : (await options.registry.listSources(actor)).filter((source) => source.status === "connected")
      const catalog: McpToolCatalogEntry[] = []
      const query = input.query?.trim() ?? ""
      const limit = Math.min(Math.max(input.limit ?? 20, 1), 20)
      for (const source of sources) {
        if (options.managedCatalog?.supports(source)) {
          if (!query) throw new McpError(MCP_ERROR_CODES.INPUT_INVALID, "A non-empty query is required for managed full-catalog search")
          const discovered = await options.managedCatalog.searchTools(source, {
            query,
            limit,
            forceProviderRefresh: input.providerRefresh ?? input.refresh,
          })
          const sourceRevision = sourceCatalogRevision(source)
          catalog.push(...discovered.map((tool) => normalizeMcpCatalogTool(source.id, source.provider, tool, options.templates, {
            sourceRevision,
            accountRequired: source.credentialProvider === "composio-managed",
          })))
          continue
        }
        const result = await loadSourceCatalog(actor, source.id, input.refresh, input.providerRefresh)
        catalog.push(...result.tools.filter((entry) => matchesQuery(entry, query)))
      }
      const response = { tools: input.limit === undefined ? catalog : catalog.slice(0, limit) }
      assertMcpPublicPayloadSecretFree(response)
      return response
    },

    async describeTool(actor, input) {
      const source = await requireConnectedSource(actor, input.sourceId)
      let tool: McpToolCatalogEntry | undefined
      if (options.managedCatalog?.supports(source)) {
        const discovered = await options.managedCatalog.describeTool(source, input.toolName, {
          forceProviderRefresh: input.providerRefresh ?? input.refresh,
        })
        tool = normalizeMcpCatalogTool(source.id, source.provider, discovered, options.templates, {
          sourceRevision: sourceCatalogRevision(source),
          accountRequired: source.credentialProvider === "composio-managed",
        })
      } else {
        const result = await loadSourceCatalog(actor, input.sourceId, input.refresh, input.providerRefresh)
        tool = result.tools.find((candidate) => candidate.toolName === input.toolName)
      }
      if (!tool) throw new McpError(MCP_ERROR_CODES.TOOL_NOT_FOUND, "MCP tool not found")
      const schemaDrifted = Boolean(input.expectedSchemaHash && input.expectedSchemaHash !== tool.schemaHash)
      if (containsMcpSecret(tool)) throw new McpError(MCP_ERROR_CODES.SECRET_LEAK_GUARD, "MCP tool metadata looked like it contained a secret")
      const response = { tool, schemaDrifted }
      assertMcpPublicPayloadSecretFree(response)
      return response
    },
  }
}
