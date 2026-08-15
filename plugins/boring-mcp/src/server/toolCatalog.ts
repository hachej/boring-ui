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

export interface McpManagedCatalogTool extends McpDiscoveredTool {
  toolkit?: string
  outputSchema?: unknown
  version?: string
}

export interface McpManagedCatalogBackend {
  supports(source: Pick<McpSource, "provider" | "credentialProvider">): boolean
  searchTools(source: McpSource, input: { query: string; limit: number; offset: number; forceProviderRefresh: boolean }): Promise<McpManagedCatalogTool[]>
  describeTool(source: McpSource, toolName: string, input: { forceProviderRefresh: boolean }): Promise<McpManagedCatalogTool | undefined>
}

export interface BoringMcpToolCatalogOptions {
  registry: McpSourceRegistry
  transport: McpTransportClient
  templates?: readonly McpProviderTemplate[]
  cache?: McpToolCatalogCache
  managedCatalog?: McpManagedCatalogBackend
}

export interface McpToolsSearchInput {
  sourceId?: string
  query?: string
  limit?: number
  offset?: number
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

export function normalizeMcpCatalogTool(
  sourceId: string,
  provider: McpProviderId,
  tool: McpDiscoveredTool,
  templates?: readonly McpProviderTemplate[],
  sourceRevision?: string,
): McpToolCatalogEntry {
  const template = getMcpProviderTemplate(provider, templates)
  const decision = template
    ? classifyMcpTool(template, tool.name)
    : { allowed: false, risk: "unknown" as const, reason: "Tool provider has no read-only allowlist" }
  const inputSchema = tool.inputSchema ?? {}
  const managedTool = tool as McpManagedCatalogTool
  return {
    sourceId,
    provider,
    toolName: tool.name,
    displayName: displayName(tool.name),
    summary: tool.description ?? displayName(tool.name),
    description: tool.description,
    inputSchema,
    outputSchema: managedTool.outputSchema,
    sourceRevision,
    toolVersion: managedTool.version,
    providerSupplied: true,
    risk: decision.risk,
    enabled: decision.allowed,
    blockedReasons: decision.allowed ? [] : [decision.reason],
    schemaHash: createMcpSchemaHash(inputSchema),
    nativeRef: { provider, toolkit: managedTool.toolkit, action: tool.name },
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

  async function resolveConnectedSource(actor: McpActor, sourceId: string) {
    const requestedSourceId = validateMcpSourceId(sourceId)
    const source = await requireActorOwnedMcpSource(options.registry, actor, requestedSourceId)
    const resolvedSourceId = validateMcpSourceId(source.id)
    assertConnectedSource(resolvedSourceId, source.status)
    return { source, resolvedSourceId }
  }

  function normalizeManagedTools(sourceId: string, provider: McpProviderId, sourceRevision: string, tools: McpManagedCatalogTool[]): McpToolCatalogEntry[] {
    return tools.map((tool) => normalizeMcpCatalogTool(sourceId, provider, tool, options.templates, sourceRevision))
  }

  async function loadSourceCatalog(actor: McpActor, sourceId: string, refresh?: boolean, providerRefresh?: boolean): Promise<McpToolCatalogSnapshot> {
    const { source, resolvedSourceId } = await resolveConnectedSource(actor, sourceId)

    const sourceRevision = sourceCatalogRevision(source)
    if (!refresh && !providerRefresh) {
      const cached = await cache.get(actor, resolvedSourceId)
      if (cached && cached.provider === source.provider && cached.sourceRevision === sourceRevision) return cached
    }

    const discoveredTools = await options.transport.listTools(source, { forceProviderRefresh: providerRefresh ?? refresh })
    const tools = discoveredTools.map((tool) => normalizeMcpCatalogTool(resolvedSourceId, source.provider, tool, options.templates, sourceRevision))
    const snapshot = { sourceId: resolvedSourceId, provider: source.provider, sourceRevision, tools }
    assertMcpPublicPayloadSecretFree(snapshot)
    await cache.set(actor, resolvedSourceId, snapshot)
    return snapshot
  }

  return {
    async searchTools(actor, input = {}) {
      const sources = input.sourceId
        ? [{ id: validateMcpSourceId(input.sourceId) }]
        : (await options.registry.listSources(actor)).filter((source) => source.status === "connected")
      const catalog: McpToolCatalogEntry[] = []
      const managedResults: McpToolCatalogEntry[] = []
      for (const candidate of sources) {
        const { source, resolvedSourceId } = await resolveConnectedSource(actor, candidate.id)
        if (options.managedCatalog?.supports(source)) {
          const query = input.query?.trim() ?? ""
          if (!query && !input.sourceId) continue
          if (!query) throw new McpError(MCP_ERROR_CODES.INPUT_INVALID, "Managed MCP catalog search requires a query")
          const limit = input.limit ?? 20
          if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
            throw new McpError(MCP_ERROR_CODES.INPUT_INVALID, "Managed MCP catalog search limit must be between 1 and 20")
          }
          const offset = input.offset ?? 0
          if (!Number.isInteger(offset) || offset < 0 || offset > 80) {
            throw new McpError(MCP_ERROR_CODES.INPUT_INVALID, "Managed MCP catalog search offset must be between 0 and 80")
          }
          const tools = await options.managedCatalog.searchTools(source, {
            query,
            limit,
            offset,
            forceProviderRefresh: input.providerRefresh ?? input.refresh ?? false,
          })
          managedResults.push(...normalizeManagedTools(resolvedSourceId, source.provider, sourceCatalogRevision(source), tools).slice(0, limit))
          continue
        }
        const result = await loadSourceCatalog(actor, resolvedSourceId, input.refresh, input.providerRefresh)
        catalog.push(...result.tools)
      }
      const response = { tools: [...managedResults, ...catalog.filter((entry) => matchesQuery(entry, input.query ?? ""))] }
      assertMcpPublicPayloadSecretFree(response)
      return response
    },

    async describeTool(actor, input) {
      const { source, resolvedSourceId } = await resolveConnectedSource(actor, input.sourceId)
      let resolvedTool: McpToolCatalogEntry | undefined
      if (options.managedCatalog?.supports(source)) {
        const managedTool = await options.managedCatalog.describeTool(source, input.toolName, {
          forceProviderRefresh: input.providerRefresh ?? input.refresh ?? false,
        })
        resolvedTool = managedTool
          ? normalizeMcpCatalogTool(resolvedSourceId, source.provider, managedTool, options.templates, sourceCatalogRevision(source))
          : undefined
      } else {
        const result = await loadSourceCatalog(actor, resolvedSourceId, input.refresh, input.providerRefresh)
        resolvedTool = result.tools.find((candidate) => candidate.toolName === input.toolName)
      }
      if (!resolvedTool) throw new McpError(MCP_ERROR_CODES.TOOL_NOT_FOUND, "MCP tool not found")
      const schemaDrifted = Boolean(input.expectedSchemaHash && input.expectedSchemaHash !== resolvedTool.schemaHash)
      if (containsMcpSecret(resolvedTool)) throw new McpError(MCP_ERROR_CODES.SECRET_LEAK_GUARD, "MCP tool metadata looked like it contained a secret")
      const response = { tool: resolvedTool, schemaDrifted }
      assertMcpPublicPayloadSecretFree(response)
      return response
    },
  }
}
