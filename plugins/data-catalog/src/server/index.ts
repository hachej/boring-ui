import type { ExplorerAdapter, ExplorerRow, SearchResult } from "@hachej/boring-data-explorer/shared"
import {
  defineServerPlugin,
  type WorkspaceServerPlugin,
} from "@hachej/boring-workspace/server"
import type { AgentTool, ToolResult } from "@hachej/boring-workspace"
import {
  DATA_CATALOG_DEFAULT_TOOL_NAME,
  DATA_CATALOG_PLUGIN_ID,
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

export interface DataCatalogServerPluginOptions
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

export function createDataCatalogAgentTool(
  options: DataCatalogAgentToolOptions,
): AgentTool {
  const name = options.name ?? DATA_CATALOG_DEFAULT_TOOL_NAME
  const label = options.label ?? "data catalog"
  const { defaultLimit, maxLimit } = normalizeLimitOptions(options)

  return {
    name,
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
    async execute(params, ctx) {
      const query = String(params.query ?? "").trim()
      if (!query) return errorResult("query is required")
      const limit = clampLimit(params.limit, defaultLimit, maxLimit)

      try {
        const result = await options.adapter.search({
          query,
          filters: {},
          limit,
          offset: 0,
          signal: ctx.abortSignal,
        })
        return textResult(formatDataCatalogSearchResult(query, result), result)
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }
    },
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

export function createDataCatalogServerPlugin(
  options: DataCatalogServerPluginOptions,
): WorkspaceServerPlugin & { agentTools: AgentTool[]; systemPrompt: string } {
  const tool = createDataCatalogAgentTool(options)
  return defineServerPlugin({
    id: options.id ?? DATA_CATALOG_PLUGIN_ID,
    label: options.label ?? "Data Catalog",
    agentTools: [tool],
    systemPrompt: createDataCatalogSkillPrompt({
      label: options.label,
      toolName: tool.name,
      surfaceKind: options.surfaceKind,
      guidance: options.guidance,
    }),
  })
}
