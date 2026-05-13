import type { ExplorerAdapter, ExplorerRow, SearchResult } from "../../../shared/types/explorer"
import type { AgentTool, ToolResult } from "../../../shared/types/agent-tool"
import {
  DATA_CATALOG_DEFAULT_TOOL_NAME,
  DATA_CATALOG_ROW_SURFACE_KIND,
} from "../shared/constants"

export interface DataCatalogAgentToolOptions {
  name?: string
  label?: string
  adapter: ExplorerAdapter
  defaultLimit?: number
  maxLimit?: number
}

export interface DataCatalogSkillOptions {
  label?: string
  toolName?: string
  surfaceKind?: string
  guidance?: string
}

export interface DataCatalogAgentPluginOptions
  extends DataCatalogAgentToolOptions,
    DataCatalogSkillOptions {
  id?: string
}

function textResult(text: string, details?: unknown): ToolResult {
  return { content: [{ type: "text", text }], details }
}

function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true }
}

interface PiToolUpdate {
  content: Array<{ type: "text"; text: string }>
  details?: unknown
}

interface PiToolDefinition {
  name: string
  label: string
  description: string
  parameters: Record<string, unknown>
  promptSnippet?: string
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: (update: PiToolUpdate) => void,
    ctx?: unknown,
  ): Promise<{ content: Array<{ type: "text"; text: string }>; details?: unknown }>
}

type DataCatalogExtensionFactory = (api: unknown) => void | Promise<void>

interface DataCatalogPiExtensionAPI {
  registerTool(tool: PiToolDefinition): void
  on(
    event: "before_agent_start",
    handler: (event: { systemPrompt: string }) =>
      | void
      | { systemPrompt: string }
      | Promise<void | { systemPrompt: string }>,
  ): void
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(1, Math.min(max, Math.floor(numeric)))
}

function normalizeLimitOptions(options: DataCatalogAgentToolOptions): {
  defaultLimit: number
  maxLimit: number
} {
  const rawMax = options.maxLimit ?? 50
  const maxLimit =
    typeof rawMax === "number" && Number.isFinite(rawMax)
      ? Math.max(1, Math.floor(rawMax))
      : 50
  const rawDefault = options.defaultLimit ?? 20
  const defaultLimit =
    typeof rawDefault === "number" && Number.isFinite(rawDefault)
      ? Math.max(1, Math.min(maxLimit, Math.floor(rawDefault)))
      : Math.min(20, maxLimit)
  return { defaultLimit, maxLimit }
}

function formatBadge(row: ExplorerRow): string {
  const parts = [
    row.leading?.code,
    ...(row.trailing ?? []).map((badge) => badge.code),
    row.meta,
  ].filter(Boolean)
  return parts.length > 0 ? ` [${parts.join(", ")}]` : ""
}

export function formatDataCatalogSearchResult(
  query: string,
  result: SearchResult,
): string {
  if (result.items.length === 0) {
    return `No ${query ? `results for "${query}"` : "catalog results"}.`
  }

  const lines = result.items.map((row) => {
    const subtitle = row.subtitle ? ` — ${row.subtitle}` : ""
    return `${row.id}: ${row.title}${subtitle}${formatBadge(row)}`
  })
  const total = Number.isFinite(result.total) ? result.total : result.items.length
  return `Found ${total} results (showing ${result.items.length}):\n\n${lines.join("\n")}`
}

function createDataCatalogToolCore(options: DataCatalogAgentToolOptions): {
  name: string
  label: string
  description: string
  parameters: Record<string, unknown>
  search(params: Record<string, unknown>, signal?: AbortSignal): Promise<{ text: string; details: SearchResult }>
} {
  const name = options.name ?? DATA_CATALOG_DEFAULT_TOOL_NAME
  const label = options.label ?? "data catalog"
  const { defaultLimit, maxLimit } = normalizeLimitOptions(options)
  return {
    name,
    label,
    description: `Search the ${label}. Use this before opening data visualizations or asking for a specific dataset.`,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search keywords for datasets, series, tables, or metrics.",
        },
        limit: {
          type: "number",
          description: `Maximum number of results. Default ${defaultLimit}, max ${maxLimit}.`,
          minimum: 1,
          maximum: maxLimit,
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async search(params, signal) {
      const query = String(params.query ?? "").trim()
      if (!query) throw new Error("query is required")
      const limit = clampLimit(params.limit, defaultLimit, maxLimit)
      const result = await options.adapter.search({
        query,
        filters: {},
        limit,
        offset: 0,
        signal,
      })
      return { text: formatDataCatalogSearchResult(query, result), details: result }
    },
  }
}

export function createDataCatalogAgentTool(
  options: DataCatalogAgentToolOptions,
): AgentTool {
  const core = createDataCatalogToolCore(options)

  return {
    name: core.name,
    description: core.description,
    parameters: core.parameters,
    async execute(params, ctx) {
      try {
        const result = await core.search(params, ctx.abortSignal)
        return textResult(result.text, result.details)
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }
    },
  }
}

export function createDataCatalogPiTool(
  options: DataCatalogAgentToolOptions,
): PiToolDefinition {
  const core = createDataCatalogToolCore(options)
  return {
    name: core.name,
    label: core.label,
    description: core.description,
    parameters: core.parameters,
    async execute(_toolCallId, params, signal) {
      const result = await core.search(params, signal)
      return {
        content: [{ type: "text", text: result.text }],
        details: result.details,
      }
    },
  }
}

export function createDataCatalogPiExtension(
  options: DataCatalogAgentPluginOptions,
): DataCatalogExtensionFactory {
  return (api) => {
    const pi = api as DataCatalogPiExtensionAPI
    const tool = createDataCatalogPiTool(options)
    pi.registerTool(tool)
    pi.on("before_agent_start", (event) => ({
      systemPrompt: `${event.systemPrompt}\n\n${createDataCatalogSkillPrompt({
        label: options.label,
        toolName: tool.name,
        surfaceKind: options.surfaceKind,
        guidance: options.guidance,
      })}`,
    }))
  }
}

export function createDataCatalogSkillPrompt(
  options: DataCatalogSkillOptions = {},
): string {
  const label = options.label ?? "data catalog"
  const toolName = options.toolName ?? DATA_CATALOG_DEFAULT_TOOL_NAME
  const surfaceKind = options.surfaceKind ?? DATA_CATALOG_ROW_SURFACE_KIND
  const guidance = options.guidance?.trim()

  return [
    "## Data Catalog Plugin",
    "",
    `Use \`${toolName}\` to search the ${label} before referencing datasets, series, tables, or metrics.`,
    `When you need to show a catalog row to the user, use the workspace UI bridge \`openSurface\` command with \`{ kind: '${surfaceKind}', target: row.id, meta: { catalogId, row } }\` so the client plugin resolver chooses the panel.`,
    guidance ? "" : undefined,
    guidance || undefined,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")
}

