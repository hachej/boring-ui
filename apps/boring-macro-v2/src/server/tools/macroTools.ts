import type { AgentTool, ToolResult } from '@boring/agent/shared'
import type { ClickHouseConfig } from '../config'
import { DataService } from '../services/clickhouse'

function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] }
}

function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

const READONLY_RE = /^\s*(SELECT|WITH|EXPLAIN|DESCRIBE|SHOW|DESC)\b/i
const MULTI_STMT_RE = /;\s*\S/

function withSqlHint(sql: string, errorMessage: string): string {
  const hints: string[] = []
  if (/unknown expression identifier\s+`?title`?/i.test(errorMessage) && /from\s+timeseries\b/i.test(sql)) {
    hints.push('Hint: `timeseries` only has observation columns; use `series_catalog` or `metadata` for titles.')
  }
  if (/from\s+\w+\s+final\s+\w+/i.test(sql) || (/Code:\s*62/.test(errorMessage) && /\bFINAL\b/i.test(sql))) {
    hints.push('Hint: in ClickHouse, put alias before FINAL, e.g. `FROM timeseries AS t FINAL`.')
  }
  return hints.length > 0 ? `${errorMessage}\n${hints.join('\n')}` : errorMessage
}

export function createMacroTools(chConfig: ClickHouseConfig | null): AgentTool[] {
  const svc = chConfig ? new DataService(chConfig) : null

  const executeSql: AgentTool = {
    name: 'execute_sql',
    description: 'Execute a read-only SQL query against ClickHouse (87k+ FRED series). Returns columns and rows as JSON.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'SQL query (SELECT, WITH, EXPLAIN, DESCRIBE, SHOW only)' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async execute(params) {
      if (!svc) return errorResult('ClickHouse not configured')
      const query = String(params.query ?? '').trim()
      if (!query) return errorResult('query is required')
      if (!READONLY_RE.test(query)) return errorResult('Only read-only queries allowed (SELECT, WITH, EXPLAIN, DESCRIBE, SHOW)')
      if (MULTI_STMT_RE.test(query)) return errorResult('Multi-statement queries not allowed')
      try {
        const result = await svc.executeSql(query)
        if (!result.ok) return errorResult(result.error!)
        const cols = result.columns ?? []
        const rows = result.rows ?? []
        if (rows.length === 0) return textResult(`Query returned 0 rows.\nColumns: ${cols.join(', ')}`)
        const header = cols.join(' | ')
        const lines = rows.slice(0, 200).map((row) =>
          cols.map((column) => String(row[column] ?? '')).join(' | '),
        )
        const truncated = rows.length > 200 ? `\n... (${result.row_count} total rows, showing 200)` : ''
        return textResult(`${header}\n${lines.join('\n')}${truncated}`)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return errorResult(withSqlHint(query, msg))
      }
    },
  }

  const macroSearch: AgentTool = {
    name: 'macro_search',
    description: 'Search the macro-economic series catalog (87k+ FRED series). Returns series_id, title, frequency, units, popularity.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keywords (e.g. "consumer price index", "GDP", "unemployment")' },
        limit: { type: 'number', description: 'Max results (default 20)', minimum: 1, maximum: 100 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async execute(params) {
      if (!svc) return errorResult('ClickHouse not configured')
      const q = String(params.query ?? '').trim()
      if (!q) return errorResult('query is required')
      const limit = typeof params.limit === 'number' ? params.limit : 20
      try {
        const result = await svc.search(q, { limit, offset: 0 })
        const rows = result.results ?? []
        if (rows.length === 0) return textResult(`No results for "${q}"`)
        const lines = rows.map((r) =>
          `${r.series_id}: ${r.title} [${r.frequency ?? '?'}, ${r.units ?? '?'}] (pop: ${r.popularity ?? '?'})`,
        )
        return textResult(`Found ${result.total ?? rows.length} series (showing ${lines.length}):\n\n${lines.join('\n')}`)
      } catch (err: unknown) {
        return errorResult(`Search error: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  }

  const getSeriesData: AgentTool = {
    name: 'get_series_data',
    description: 'Fetch observations for a single series. Returns JSON with `date` and `value` fields. Prefer the macro-transform skill + `bm` for creating reusable derived series; use this tool mainly for inspection/debugging.',
    parameters: {
      type: 'object',
      properties: {
        series_id: { type: 'string', description: 'Series ID (e.g. "CPIAUCSL", "GDP")' },
        from: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        to: { type: 'string', description: 'End date (YYYY-MM-DD)' },
        limit: { type: 'number', description: 'Max rows (default 600)', minimum: 1, maximum: 5000 },
        order: { type: 'string', description: '"asc" (default) or "desc"' },
      },
      required: ['series_id'],
      additionalProperties: false,
    },
    async execute(params) {
      if (!svc) return errorResult('ClickHouse not configured')
      const seriesId = String(params.series_id ?? '').trim()
      if (!seriesId) return errorResult('series_id is required')
      try {
        const result = await svc.seriesData(seriesId, {
          dateFrom: typeof params.from === 'string' ? params.from : null,
          dateTo: typeof params.to === 'string' ? params.to : null,
          limit: typeof params.limit === 'number' ? params.limit : 600,
          order: params.order === 'desc' ? 'desc' : 'asc',
        })
        return textResult(JSON.stringify({
          series_id: seriesId,
          count: result.observations.length,
          observations: result.observations,
        }))
      } catch (err: unknown) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    },
  }

  const persistDerivedSeries: AgentTool = {
    name: 'persist_derived_series',
    description: 'Persist derived timeseries output. Use this instead of SQL INSERT statements. This is a fallback path; for reusable derived-series creation prefer the macro-transform skill plus `bm`.',
    parameters: {
      type: 'object',
      properties: {
        output_id: { type: 'string', description: 'Output series id (e.g. CPIAUCSL_YOY)' },
        title: { type: 'string', description: 'Human-readable series title' },
        input_ids: { type: 'array', items: { type: 'string' }, description: 'Source series ids', minItems: 1 },
        transform_name: { type: 'string', description: 'Transform identifier (e.g. yoy, custom_transform)' },
        transform_spec: { type: 'object', description: 'Optional richer transform metadata (tool_id, file, params, etc.)', additionalProperties: true },
        observations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date: { type: 'string', description: 'Date YYYY-MM-DD' },
              value: { type: 'number', description: 'Numeric value' },
            },
            required: ['date', 'value'],
          },
          description: 'Output observations',
          minItems: 1,
          maxItems: 50000,
        },
      },
      required: ['output_id', 'title', 'input_ids', 'observations'],
      additionalProperties: false,
    },
    async execute(params) {
      if (!svc) return errorResult('ClickHouse not configured')
      const outputId = String(params.output_id ?? '').trim()
      const title = String(params.title ?? '').trim()
      const inputIds = (Array.isArray(params.input_ids) ? params.input_ids : [])
        .map((s: unknown) => String(s).trim()).filter(Boolean)
      const observations = Array.isArray(params.observations) ? params.observations : []
      const transformSpec = params.transform_spec && typeof params.transform_spec === 'object' && !Array.isArray(params.transform_spec)
        ? params.transform_spec as Record<string, unknown>
        : undefined
      const transformSpecName = typeof transformSpec?.name === 'string' ? transformSpec.name.trim() : ''
      const transformName = String(params.transform_name ?? transformSpecName).trim()

      if (!outputId) return errorResult('output_id is required')
      if (!title) return errorResult('title is required')
      if (!transformName) return errorResult('transform_name or transform_spec.name is required')
      if (inputIds.length === 0) return errorResult('input_ids required')
      if (observations.length === 0) return errorResult('observations required')

      const data = observations
        .map((r: Record<string, unknown>) => [String(r.date ?? '').trim(), Number(r.value)])
        .filter(([d, v]: unknown[]) => d && Number.isFinite(v as number))
      if (data.length === 0) return errorResult('No valid observations')

      try {
        const result = await svc.persistTransform({
          outputId,
          title,
          inputIds,
          transformName,
          transformSpec,
          data,
        })
        if (!result.ok) return errorResult(result.error!)
        return textResult(
          `Persisted ${result.obs_count ?? data.length} observations for ${result.output_id ?? outputId} (${result.action ?? 'created'}).`,
        )
      } catch (err: unknown) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    },
  }

  // open_series was deleted in favor of exec_ui openSurface, which arrives
  // via the workspace UI bridge SSE stream and is dispatched by
  // SurfaceShell through plugin-owned resolvers on the frontend. The bridge surface (registered
  // by createWorkspaceAgentApp) replaces tabBus's push/poll semantics with
  // an SSE drain — no app-specific tool needed.
  return [executeSql, macroSearch, getSeriesData, persistDerivedSeries]
}
