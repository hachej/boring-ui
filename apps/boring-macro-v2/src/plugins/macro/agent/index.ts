import { defineTool, type ExtensionFactory } from "@mariozechner/pi-coding-agent"
import { Type } from "@sinclair/typebox"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { loadMacroConfig } from "../server/config"
import { DataService } from "../server/services/clickhouse"

const __dir = dirname(fileURLToPath(import.meta.url))

const READONLY_RE = /^\s*(SELECT|WITH|EXPLAIN|DESCRIBE|SHOW|DESC)\b/i
const MULTI_STMT_RE = /;\s*\S/

function ok(text: string) {
  return { content: [{ type: "text" as const, text }], details: undefined }
}

function fail(text: string): never {
  throw new Error(text)
}

function withSqlHint(sql: string, msg: string): string {
  const hints: string[] = []
  if (/unknown expression identifier\s+`?title`?/i.test(msg) && /from\s+timeseries\b/i.test(sql))
    hints.push("Hint: `timeseries` only has observation columns; use `series_catalog` or `metadata` for titles.")
  if (/from\s+\w+\s+final\s+\w+/i.test(sql) || (/Code:\s*62/.test(msg) && /\bFINAL\b/i.test(sql)))
    hints.push("Hint: put alias before FINAL, e.g. `FROM timeseries AS t FINAL`.")
  return hints.length > 0 ? `${msg}\n${hints.join("\n")}` : msg
}

const macroExtension: ExtensionFactory = async (pi) => {
  const macroConfig = await loadMacroConfig()
  const svc = macroConfig.clickhouse ? new DataService(macroConfig.clickhouse) : null

  pi.on("resources_discover", () => ({
    skillPaths:  [join(__dir, "skills")],
    promptPaths: [join(__dir, "prompts")],
  }))

  pi.registerTool(defineTool({
    name: "execute_sql",
    label: "SQL",
    description: "Run read-only SQL on ClickHouse (87k+ FRED series). Returns columns and rows as JSON.",
    parameters: Type.Object({
      query: Type.String({ description: "SQL query (SELECT, WITH, EXPLAIN, DESCRIBE, SHOW only)" }),
    }),
    async execute(_id, { query }, _signal) {
      if (!svc) fail("ClickHouse not configured")
      const q = query.trim()
      if (!q) fail("query is required")
      if (!READONLY_RE.test(q)) fail("Only read-only queries allowed")
      if (MULTI_STMT_RE.test(q)) fail("Multi-statement queries not allowed")
      try {
        const result = await svc.executeSql(q)
        if (!result.ok) fail(result.error!)
        const cols = result.columns ?? []
        const rows = result.rows ?? []
        if (rows.length === 0) return ok(`Query returned 0 rows.\nColumns: ${cols.join(", ")}`)
        const lines = rows.slice(0, 200).map((row) => cols.map((c) => String(row[c] ?? "")).join(" | "))
        const truncated = rows.length > 200 ? `\n... (${result.row_count} total rows, showing 200)` : ""
        return ok(`${cols.join(" | ")}\n${lines.join("\n")}${truncated}`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        fail(withSqlHint(q, msg))
      }
    },
  }))

  pi.registerTool(defineTool({
    name: "macro_search",
    label: "Macro search",
    description: "Search the macro-economic series catalog (87k+ FRED series). Returns series_id, title, frequency, units, popularity.",
    parameters: Type.Object({
      query: Type.String({ description: 'Search keywords (e.g. "consumer price index", "GDP", "unemployment")' }),
      limit: Type.Optional(Type.Number({ description: "Max results (default 20)", minimum: 1, maximum: 100 })),
    }),
    async execute(_id, { query, limit = 20 }, _signal) {
      if (!svc) fail("ClickHouse not configured")
      const q = query.trim()
      if (!q) fail("query is required")
      try {
        const result = await svc.search(q, { limit, offset: 0 })
        const rows = result.results ?? []
        if (rows.length === 0) return ok(`No results for "${q}"`)
        const lines = rows.map((r) => `${r.series_id}: ${r.title} [${r.frequency ?? "?"}, ${r.units ?? "?"}] (pop: ${r.popularity ?? "?"})`)
        return ok(`Found ${result.total ?? rows.length} series (showing ${lines.length}):\n\n${lines.join("\n")}`)
      } catch (e) {
        fail(`Search error: ${e instanceof Error ? e.message : String(e)}`)
      }
    },
  }))

  pi.registerTool(defineTool({
    name: "get_series_data",
    label: "Series data",
    description: "Fetch observations for a single series. Returns JSON with date and value fields. Prefer the macro-transform skill + `bm` for creating reusable derived series; use this mainly for inspection/debugging.",
    parameters: Type.Object({
      series_id: Type.String({ description: 'Series ID (e.g. "CPIAUCSL", "GDP")' }),
      from: Type.Optional(Type.String({ description: "Start date (YYYY-MM-DD)" })),
      to: Type.Optional(Type.String({ description: "End date (YYYY-MM-DD)" })),
      limit: Type.Optional(Type.Number({ description: "Max rows (default 600)", minimum: 1, maximum: 5000 })),
      order: Type.Optional(Type.String({ description: '"asc" (default) or "desc"' })),
    }),
    async execute(_id, { series_id, from, to, limit = 600, order }, _signal) {
      if (!svc) fail("ClickHouse not configured")
      const seriesId = series_id.trim()
      if (!seriesId) fail("series_id is required")
      try {
        const result = await svc.seriesData(seriesId, {
          dateFrom: from ?? null,
          dateTo: to ?? null,
          limit,
          order: order === "desc" ? "desc" : "asc",
        })
        return ok(JSON.stringify({ series_id: seriesId, count: result.observations.length, observations: result.observations }))
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e))
      }
    },
  }))

  pi.registerTool(defineTool({
    name: "persist_derived_series",
    label: "Persist series",
    description: "Persist derived timeseries output. Use instead of SQL INSERT. Prefer the macro-transform skill + `bm` for reusable transforms; use this as a fallback.",
    parameters: Type.Object({
      output_id:      Type.String({ description: "Output series id (e.g. CPIAUCSL_YOY)" }),
      title:          Type.String({ description: "Human-readable series title" }),
      input_ids:      Type.Array(Type.String(), { description: "Source series ids", minItems: 1 }),
      transform_name: Type.String({ description: "Transform identifier (e.g. yoy, custom_transform)" }),
      transform_spec: Type.Optional(Type.Object({}, { additionalProperties: true, description: "Optional richer transform metadata" })),
      observations:   Type.Array(
        Type.Object({ date: Type.String({ description: "Date YYYY-MM-DD" }), value: Type.Number({ description: "Numeric value" }) }),
        { description: "Output observations", minItems: 1, maxItems: 50000 }
      ),
    }),
    async execute(_id, { output_id, title, input_ids, transform_name, transform_spec, observations }, _signal) {
      if (!svc) fail("ClickHouse not configured")
      if (!output_id.trim()) fail("output_id is required")
      if (!title.trim()) fail("title is required")
      if (!transform_name.trim()) fail("transform_name is required")

      const data = observations
        .map((r) => [r.date.trim(), r.value] as [string, number])
        .filter(([d, v]) => d && Number.isFinite(v))
      if (data.length === 0) fail("No valid observations")

      try {
        const result = await svc.persistTransform({ outputId: output_id, title, inputIds: input_ids, transformName: transform_name, transformSpec: transform_spec, data })
        if (!result.ok) fail(result.error!)
        return ok(`Persisted ${result.obs_count ?? data.length} observations for ${result.output_id ?? output_id} (${result.action ?? "created"}).`)
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e))
      }
    },
  }))
}

export default macroExtension
