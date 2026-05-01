import { DuckDBConnection, quotedIdentifier, quotedString } from "@duckdb/node-api"
import type { AgentTool, ToolResult } from "@boring/agent/shared"
import { resolve } from "node:path"
import { PLAYGROUND_CSV_DATASETS } from "../fixtures"
import { PLAYGROUND_DATA_PLUGIN_ID } from "../constants"

interface CreatePlaygroundDataServerPluginOptions {
  workspaceRoot: string
}

interface QueryResultDetails {
  columns: string[]
  rows: Record<string, unknown>[]
  truncated: boolean
}

function textResult(text: string, details?: unknown): ToolResult {
  return { content: [{ type: "text", text }], details }
}

function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true }
}

function clampLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 50
  return Math.max(1, Math.min(100, Math.floor(value)))
}

function stripLeadingSqlComments(sql: string): string {
  let value = sql.trim()
  while (value.startsWith("--") || value.startsWith("/*")) {
    if (value.startsWith("--")) {
      const newline = value.indexOf("\n")
      value = newline === -1 ? "" : value.slice(newline + 1).trimStart()
      continue
    }

    const end = value.indexOf("*/")
    if (end === -1) return ""
    value = value.slice(end + 2).trimStart()
  }
  return value
}

function isReadOnlySql(sql: string): boolean {
  const first = stripLeadingSqlComments(sql)
  return /^(select|with|show|describe|explain|from)\b/i.test(first)
}

function hasBlockedDuckDbFeature(sql: string): boolean {
  return [
    /\b(attach|copy|create|delete|drop|export|import|insert|install|load|pragma|set|update)\b/i,
    /\b(read_blob|read_csv|read_csv_auto|read_json|read_json_auto|read_ndjson|read_parquet|read_text|glob)\s*\(/i,
    /\b(from|join)\s+(['"])[^'"]*[/\\][^'"]*\2/i,
    /https?:\/\//i,
  ].some((pattern) => pattern.test(sql))
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "null"
  if (typeof value === "object") return JSON.stringify(value).replace(/\|/g, "\\|")
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>")
}

function formatMarkdownTable(columns: string[], rows: Record<string, unknown>[]): string {
  if (columns.length === 0) return "Query returned no tabular result."
  if (rows.length === 0) return `Query returned 0 rows.\n\nColumns: ${columns.join(", ")}`

  const header = `| ${columns.join(" | ")} |`
  const divider = `| ${columns.map(() => "---").join(" | ")} |`
  const body = rows
    .map((row) => `| ${columns.map((column) => formatCell(row[column])).join(" | ")} |`)
    .join("\n")
  return `${header}\n${divider}\n${body}`
}

function tableList(): string {
  return PLAYGROUND_CSV_DATASETS.map(
    (item) => `- ${item.table}: ${item.path} (${item.columns.join(", ")})`,
  ).join("\n")
}

function createExecuteSqlTool(workspaceRoot: string): AgentTool {
  let connectionPromise: Promise<DuckDBConnection> | null = null

  async function getConnection(): Promise<DuckDBConnection> {
    if (connectionPromise) return connectionPromise
    connectionPromise = (async () => {
      const connection = await DuckDBConnection.create()
      for (const dataset of PLAYGROUND_CSV_DATASETS) {
        const csvPath = resolve(workspaceRoot, dataset.path)
        await connection.run(
          `create or replace view ${quotedIdentifier(dataset.table)} as select * from read_csv_auto(${quotedString(csvPath)}, HEADER = true)`,
        )
      }
      return connection
    })()
    try {
      return await connectionPromise
    } catch (error) {
      connectionPromise = null
      throw error
    }
  }

  return {
    name: "execute_sql",
    description: "Run read-only DuckDB SQL against the playground CSV data catalog.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: `Read-only DuckDB SQL. Available tables:\n${tableList()}`,
        },
        limit: {
          type: "number",
          description: "Maximum rows to return. Default 50, max 100.",
          minimum: 1,
          maximum: 100,
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async execute(params) {
      const query = String(params.query ?? "").trim()
      if (!query) return errorResult("query is required")
      if (!isReadOnlySql(query)) {
        return errorResult(
          "execute_sql only accepts read-only DuckDB SQL: SELECT, WITH, SHOW, DESCRIBE, EXPLAIN, or FROM.",
        )
      }
      if (hasBlockedDuckDbFeature(query)) {
        return errorResult(
          "execute_sql can only query the registered playground tables; file, extension, and mutation statements are blocked.",
        )
      }

      const limit = clampLimit(params.limit)
      try {
        const connection = await getConnection()
        const extracted = await connection.extractStatements(query)
        if (extracted.count !== 1) {
          return errorResult("execute_sql accepts exactly one SQL statement.")
        }

        const reader = await connection.runAndReadUntil(query, limit + 1)
        const columns = reader.columnNames()
        const rows = reader.getRowObjectsJson().slice(0, limit) as Record<string, unknown>[]
        const truncated = !reader.done || reader.currentRowCount > limit
        const table = formatMarkdownTable(columns, rows)
        const suffix = truncated ? `\n\nShowing first ${limit} rows.` : ""
        const details: QueryResultDetails = { columns, rows, truncated }
        return textResult(`${table}${suffix}`, details)
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }
    },
  }
}

export function createPlaygroundDataServerPlugin(
  options: CreatePlaygroundDataServerPluginOptions,
): {
  id: string
  label: string
  agentTools: AgentTool[]
  systemPrompt: string
} {
  const sqlTool = createExecuteSqlTool(options.workspaceRoot)
  return {
    id: PLAYGROUND_DATA_PLUGIN_ID,
    label: "Playground Data",
    agentTools: [sqlTool],
    systemPrompt: [
      "## Playground Data Catalog",
      "",
      "The playground installs the data catalog plugin with DuckDB-backed CSV fixtures.",
      "Use `execute_sql` for read-only SQL and discovery over these tables:",
      tableList(),
      "",
      "When you need to show a playground catalog row, call `exec_ui` with",
      "`kind: \"openSurface\"` and params",
      `\`{ kind: "data-catalog.open-row", target: row.id, meta: { catalogId: "${PLAYGROUND_DATA_PLUGIN_ID}", row } }\`.`,
    ].join("\n"),
  }
}
