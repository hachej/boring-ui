import { useEffect, useMemo, useState } from "react"
import type { BslDashboardQuerySpec, BslDashboardSpec } from "../shared"

const DATA_BRIDGE_QUERY_RUN_OP = "data.v1.query.run"

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ""
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"' && line[i + 1] === '"') {
      current += '"'
      i++
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === "," && !quoted) {
      cells.push(current)
      current = ""
    } else {
      current += char
    }
  }
  cells.push(current)
  return cells.map((cell) => cell.trim())
}

function parseCell(value: string): unknown {
  if (value === "") return null
  const number = Number(value)
  if (Number.isFinite(number) && /^-?\d+(\.\d+)?$/.test(value)) return number
  return value
}

function parseCsv(text: string): Record<string, unknown>[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  const headers = splitCsvLine(lines[0] ?? "")
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line)
    return Object.fromEntries(headers.map((header, index) => [header, parseCell(cells[index] ?? "")]))
  })
}

function applyFilters(rows: Record<string, unknown>[], query: BslDashboardQuerySpec): Record<string, unknown>[] {
  if (!query.filters?.length) return rows
  return rows.filter((row) => query.filters!.every((filter) => {
    const value = row[filter.field]
    switch (filter.op) {
      case "eq": return value === filter.value
      case "neq": return value !== filter.value
      case "gt": return (numeric(value) ?? -Infinity) > Number(filter.value)
      case "gte": return (numeric(value) ?? -Infinity) >= Number(filter.value)
      case "lt": return (numeric(value) ?? Infinity) < Number(filter.value)
      case "lte": return (numeric(value) ?? Infinity) <= Number(filter.value)
      case "in": return Array.isArray(filter.value) && filter.value.includes(value)
      case "contains": return String(value ?? "").toLowerCase().includes(String(filter.value ?? "").toLowerCase())
      case "between": {
        if (!Array.isArray(filter.value) || filter.value.length < 2) return false
        const number = numeric(value)
        return number !== null && number >= Number(filter.value[0]) && number <= Number(filter.value[1])
      }
    }
  }))
}

function applyOrder(rows: Record<string, unknown>[], query: BslDashboardQuerySpec): Record<string, unknown>[] {
  if (!query.orderBy?.length) return rows
  return [...rows].sort((a, b) => {
    for (const [field, direction] of query.orderBy!) {
      const an = numeric(a[field])
      const bn = numeric(b[field])
      const cmp = an !== null && bn !== null ? an - bn : String(a[field] ?? "").localeCompare(String(b[field] ?? ""))
      if (cmp !== 0) return direction === "desc" ? -cmp : cmp
    }
    return 0
  })
}

function aggregateRows(rows: Record<string, unknown>[], query: BslDashboardQuerySpec): Record<string, unknown>[] {
  const filtered = applyFilters(rows, query)
  const groups = query.groupBy ?? query.dimensions ?? []
  const measures = query.measures?.length ? query.measures : ["count"]
  if (groups.length === 0) {
    const result: Record<string, unknown> = {}
    for (const measure of measures) {
      const values = filtered.map((row) => numeric(row[measure])).filter((value): value is number => value !== null)
      result[measure] = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : filtered.length
    }
    return applyOrder([result], query)
  }
  const byKey = new Map<string, { groupValues: Record<string, unknown>; rows: Record<string, unknown>[] }>()
  for (const row of filtered) {
    const key = groups.map((field) => String(row[field] ?? "—")).join("\u0000")
    const existing = byKey.get(key)
    if (existing) existing.rows.push(row)
    else byKey.set(key, { groupValues: Object.fromEntries(groups.map((field) => [field, row[field] ?? "—"])), rows: [row] })
  }
  return applyOrder([...byKey.values()].map((group) => {
    const result: Record<string, unknown> = { ...group.groupValues }
    for (const measure of measures) {
      const values = group.rows.map((row) => numeric(row[measure])).filter((value): value is number => value !== null)
      result[measure] = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : group.rows.length
    }
    return result
  }), query).slice(0, query.limit ?? undefined)
}

export interface DashboardQueryResult {
  queryId: string
  columns: Array<{ name: string; type?: string }>
  rows: Record<string, unknown>[]
  source?: string
  loading: boolean
  error?: string
}

function inferColumns(rows: Record<string, unknown>[]): Array<{ name: string; type?: string }> {
  const names = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  return names.map((name) => ({ name, type: typeof rows.find((row) => row[name] != null)?.[name] }))
}

async function fetchWorkspaceFileQuery(options: {
  apiBaseUrl: string
  workspaceId: string | undefined
  query: BslDashboardQuerySpec
}): Promise<DashboardQueryResult> {
  if (options.query.dataRef?.kind !== "workspace-file") throw new Error("No browser fallback is available for this query")
  const path = options.query.dataRef.path
  const response = await fetch(`${options.apiBaseUrl}/api/v1/files/raw?path=${encodeURIComponent(path)}`, {
    credentials: "include",
    headers: options.workspaceId ? { "x-boring-workspace-id": options.workspaceId } : {},
  })
  if (!response.ok) throw new Error(`Workspace file query failed with HTTP ${response.status}`)
  const text = await response.text()
  const rawRows = path.endsWith(".json")
    ? JSON.parse(text) as Record<string, unknown>[]
    : path.endsWith(".ndjson") || path.endsWith(".jsonl")
      ? text.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
      : parseCsv(text)
  const rows = aggregateRows(rawRows.slice(0, options.query.dataRef.limit ?? 10000), options.query)
  return {
    queryId: options.query.id,
    columns: inferColumns(rows),
    rows,
    source: `workspace:${path}`,
    loading: false,
  }
}

async function fetchDataBridgeQuery(options: {
  apiBaseUrl: string
  workspaceId: string | undefined
  query: BslDashboardQuerySpec
}): Promise<DashboardQueryResult> {
  const response = await fetch(`${options.apiBaseUrl}/api/v1/workspace-bridge/call`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(options.workspaceId ? { "x-boring-workspace-id": options.workspaceId } : {}),
    },
    body: JSON.stringify({
      op: DATA_BRIDGE_QUERY_RUN_OP,
      input: {
        query: {
          language: "bsl-dashboard",
          model: options.query.model,
          groupBy: options.query.groupBy,
          measures: options.query.measures,
          dimensions: options.query.dimensions,
          filters: options.query.filters,
          orderBy: options.query.orderBy,
          limit: options.query.limit,
          dataRef: options.query.dataRef,
        },
      },
    }),
  })
  const body = await response.json() as { ok?: boolean; output?: { columns?: DashboardQueryResult["columns"]; rows?: Record<string, unknown>[]; source?: string }; error?: { message?: string } }
  if (!response.ok || !body.ok || !body.output) {
    const message = body.error?.message ?? `Data bridge failed with HTTP ${response.status}`
    if (/operation is not registered|forbidden|unauthorized/i.test(message) || response.status === 403) {
      return await fetchWorkspaceFileQuery(options)
    }
    throw new Error(message)
  }
  const rows = body.output.rows ?? []
  return {
    queryId: options.query.id,
    columns: body.output.columns ?? inferColumns(rows),
    rows,
    source: body.output.source,
    loading: false,
  }
}

export function useDashboardQueryData(spec: BslDashboardSpec | null, apiBaseUrl: string, workspaceId: string | undefined) {
  const queries = useMemo(
    () => spec ? Object.entries(spec.queries) : [],
    [spec],
  )
  const [results, setResults] = useState<Record<string, DashboardQueryResult>>({})

  useEffect(() => {
    let cancelled = false
    if (queries.length === 0) {
      setResults({})
      return
    }

    setResults(Object.fromEntries(queries.map(([queryId]) => [queryId, { queryId, columns: [], rows: [], loading: true }])))

    void Promise.all(queries.map(async ([queryId, query]) => {
      try {
        return [queryId, await fetchDataBridgeQuery({ apiBaseUrl, workspaceId, query })] as const
      } catch (error) {
        return [queryId, {
          queryId,
          columns: [],
          rows: [],
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }] as const
      }
    })).then((entries) => {
      if (!cancelled) setResults(Object.fromEntries(entries))
    })

    return () => { cancelled = true }
  }, [apiBaseUrl, queries, workspaceId])

  return results
}
