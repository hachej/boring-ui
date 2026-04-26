import type { AgentTool, ToolResult } from '@boring/agent/shared'
import type { ClickHouseConfig } from '../config'
import { DataService } from '../services/clickhouse'
import { tabBus } from '../services/tabBus'

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
    description: 'Fetch observations for a single series. Returns JSON with `date` and `value` fields.',
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
    description: 'Persist derived timeseries output. Use this instead of SQL INSERT statements.',
    parameters: {
      type: 'object',
      properties: {
        output_id: { type: 'string', description: 'Output series id (e.g. CPIAUCSL_YOY)' },
        title: { type: 'string', description: 'Human-readable series title' },
        input_ids: { type: 'array', items: { type: 'string' }, description: 'Source series ids', minItems: 1 },
        transform_name: { type: 'string', description: 'Transform identifier (e.g. yoy, custom_transform)' },
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
      required: ['output_id', 'title', 'input_ids', 'transform_name', 'observations'],
      additionalProperties: false,
    },
    async execute(params) {
      if (!svc) return errorResult('ClickHouse not configured')
      const outputId = String(params.output_id ?? '').trim()
      const title = String(params.title ?? '').trim()
      const transformName = String(params.transform_name ?? '').trim()
      const inputIds = (Array.isArray(params.input_ids) ? params.input_ids : [])
        .map((s: unknown) => String(s).trim()).filter(Boolean)
      const observations = Array.isArray(params.observations) ? params.observations : []

      if (!outputId) return errorResult('output_id is required')
      if (!title) return errorResult('title is required')
      if (!transformName) return errorResult('transform_name is required')
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

  const openSeries: AgentTool = {
    name: 'open_series',
    description: 'Open a time series chart in the UI workspace.',
    parameters: {
      type: 'object',
      properties: {
        series_id: { type: 'string', description: 'Series ID to open (e.g. "CPIAUCSL")' },
        mode: { type: 'string', description: '"chart" (default) or "table"' },
      },
      required: ['series_id'],
      additionalProperties: false,
    },
    async execute(params) {
      const seriesId = String(params.series_id ?? '').trim()
      if (!seriesId) return errorResult('series_id is required')
      const mode = String(params.mode ?? 'chart').toLowerCase() === 'table' ? 'table' : 'chart'
      tabBus.push(seriesId, mode)
      return textResult(`Opened ${mode} for ${seriesId}`)
    },
  }

  return [executeSql, macroSearch, getSeriesData, persistDerivedSeries, openSeries]
}

export const MACRO_SYSTEM_PROMPT = `You are a macro-economic data analyst in MacroAnalyst.
You have access to 87,000+ FRED time series stored in ClickHouse.

Available tools:
- execute_sql: Run read-only SQL against ClickHouse (fast, no overhead)
- macro_search: Search the series catalog by keyword
- get_series_data: Fetch observations for a series as JSON
- persist_derived_series: Save derived output series (metadata + observations + lineage)
- open_series: Open a series chart in the UI
- bash: Execute shell commands (python3, file operations, git, etc.)

Prefer execute_sql for simple queries (counts, aggregations, lookups).
Use bash + python3 when you need pandas/numpy/scipy transforms.
For non-trivial Python, write a .py script file and run it via bash.
Use a toolbox approach: reuse existing transform scripts before creating new ones.
Minimize retries: if a query fails, fix it using the error and run at most one corrected retry.

## Deck authoring rules
- Deck files MUST be markdown files under the \`deck/\` folder and end with \`.md\`.
- Valid examples: \`deck/deck.md\`, \`deck/briefing.md\`, \`deck/q2_outlook.md\`.
- For embedded series charts, use ONLY these syntaxes:
  - \`{{TimeSeries ids="GDPC1" title="Real GDP"}}\`
  - \`{{TimeSeries ids="GDPC1,UNRATE" title="Growth vs Labor"}}\`
- NEVER use shorthand like \`{{GDPC1}}\` (invalid in deck parser).
- When user asks for a deck:
  1) write the file under \`deck/*.md\` using bash
  2) call open_series or tell the user to open it
- Deck slide separator is \`---\` between slides.

## SQL guardrails (ClickHouse)
- \`timeseries\` has observation fields (\`series_id\`, \`date\`, \`value\`) only.
- Use \`series_catalog\` or \`metadata\` for descriptive fields like \`title\`, \`frequency\`, \`units\`.
- If using aliases with FINAL, place alias before FINAL: \`FROM timeseries AS t FINAL\`.
- For joins, prefer explicit aliases and select fully-qualified columns.
- execute_sql is read-only: no INSERT/DELETE/ALTER. For writes, use persist_derived_series.

## Python execution (bash + python3)
- Use bash to run python3 scripts for transforms.
- pandas, numpy, scipy are available via pip install.
- Write scripts to files first, then execute: better for debugging and reuse.
- Place reusable custom transforms under \`transforms/custom/*.py\` with stable names.
- Use workspace-relative paths.

## Key tables
- \`series_catalog\`: unified view (series_id, title, frequency, units, popularity, source_type)
- \`timeseries\`: observations (series_id, date, value) — always use FINAL for reads
- \`metadata\`: FRED series metadata (read-only)
- \`derived_series\`: user-created series (series_id, title, transform_spec, source_series_ids)
- \`lineage\`: derivation relationships (derived_series_id, source_series_id, transform_step)

## Safety rules for writes
- NEVER overwrite FRED series (check metadata table first)
- Use FINAL when reading from ReplacingMergeTree tables
- For idempotent re-run: DELETE existing rows first, then INSERT

## Workflow
1. Search for series with macro_search
2. Explore data with execute_sql (counts, aggregations, date ranges)
3. For simple transforms: compute in SQL, persist with persist_derived_series
4. For complex transforms: write python3 script, run via bash, persist results
5. View results with open_series

Be concise and action-oriented.`
