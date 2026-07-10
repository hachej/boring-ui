import { useEffect, useMemo, useState } from "react"
import {
  DATA_BRIDGE_QUERY_BATCH_OP,
  DATA_BRIDGE_QUERY_RUN_OP,
  type DataBridgeArrowResult,
  type DataBridgeQueryBatchOutput,
} from "@hachej/boring-data-bridge/shared"
import type { BslDashboardQuerySpec, BslDashboardSpec } from "../shared"

export interface DashboardQueryResult {
  queryId: string
  columns: Array<{ name: string; type?: string }>
  rows: Record<string, unknown>[]
  source?: string
  loading: boolean
  error?: string
}

export type DashboardArrowQueryResult = DataBridgeArrowResult

function inferColumns(rows: Record<string, unknown>[]): Array<{ name: string; type?: string }> {
  const names = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  return names.map((name) => ({ name, type: typeof rows.find((row) => row[name] != null)?.[name] }))
}

function queryPayload(query: BslDashboardQuerySpec) {
  return "sql" in query
    ? {
        language: "sql",
        source: query.source ?? "default",
        sql: query.sql,
        params: query.params,
        limit: query.limit,
      }
    : {
        language: "bsl",
        model: query.model,
        query: query.query,
        limit: query.limit,
      }
}

async function callDataBridge<T>(options: {
  apiBaseUrl: string
  workspaceId: string | undefined
  op?: string
  input: Record<string, unknown>
}): Promise<T> {
  const response = await fetch(`${options.apiBaseUrl}/api/v1/workspace-bridge/call`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(options.workspaceId ? { "x-boring-workspace-id": options.workspaceId } : {}),
    },
    body: JSON.stringify({ op: options.op ?? DATA_BRIDGE_QUERY_RUN_OP, input: options.input }),
  })
  const body = await response.json() as { ok?: boolean; output?: T; error?: { message?: string } }
  if (!response.ok || !body.ok || !body.output) {
    const message = body.error?.message ?? `Data bridge failed with HTTP ${response.status}`
    throw new Error(message)
  }
  return body.output
}

export async function fetchDataBridgeQuery(options: {
  apiBaseUrl: string
  workspaceId: string | undefined
  queryId: string
  query: BslDashboardQuerySpec
}): Promise<DashboardQueryResult> {
  const output = await callDataBridge<{ columns?: DashboardQueryResult["columns"]; rows?: Record<string, unknown>[]; source?: string }>({
    apiBaseUrl: options.apiBaseUrl,
    workspaceId: options.workspaceId,
    input: { query: queryPayload(options.query) },
  })
  const rows = output.rows ?? []
  return {
    queryId: options.queryId,
    columns: output.columns ?? inferColumns(rows),
    rows,
    source: output.source,
    loading: false,
  }
}

export async function fetchDataBridgeQueries(options: {
  apiBaseUrl: string
  workspaceId: string | undefined
  queries: Array<readonly [string, BslDashboardQuerySpec]>
}): Promise<Record<string, DashboardQueryResult>> {
  const output = await callDataBridge<DataBridgeQueryBatchOutput>({
    apiBaseUrl: options.apiBaseUrl,
    workspaceId: options.workspaceId,
    op: DATA_BRIDGE_QUERY_BATCH_OP,
    input: {
      queries: options.queries.map(([queryId, query]) => ({
        id: queryId,
        input: { query: queryPayload(query) },
      })),
    },
  })

  return Object.fromEntries(output.results.map((result) => {
    if (!result.ok) {
      return [result.id, {
        queryId: result.id,
        columns: [],
        rows: [],
        loading: false,
        error: result.error.message,
      } satisfies DashboardQueryResult]
    }
    const rows = "rows" in result.output ? result.output.rows ?? [] : []
    return [result.id, {
      queryId: result.id,
      columns: "columns" in result.output ? result.output.columns ?? inferColumns(rows) : inferColumns(rows),
      rows,
      source: result.output.source,
      loading: false,
    } satisfies DashboardQueryResult]
  }))
}

export async function fetchArrowDataBridgeQuery(options: {
  apiBaseUrl: string
  workspaceId: string | undefined
  queryId: string
  query: BslDashboardQuerySpec
}): Promise<DashboardArrowQueryResult> {
  return await callDataBridge<DashboardArrowQueryResult>({
    apiBaseUrl: options.apiBaseUrl,
    workspaceId: options.workspaceId,
    input: {
      format: "arrow",
      query: queryPayload(options.query),
    },
  })
}

export function useDashboardQueryData(spec: BslDashboardSpec | null, apiBaseUrl: string, workspaceId: string | undefined, refreshKey = 0, queryIds?: readonly string[]) {
  const queryIdKey = JSON.stringify(queryIds ?? [])
  const queries = useMemo(
    () => {
      if (!spec) return []
      const allowed = queryIds ? new Set(queryIds) : null
      return Object.entries(spec.queries).filter(([queryId]) => !allowed || allowed.has(queryId))
    },
    [queryIdKey, spec],
  )
  const [results, setResults] = useState<Record<string, DashboardQueryResult>>({})

  useEffect(() => {
    let cancelled = false
    if (queries.length === 0) {
      setResults({})
      return
    }

    setResults(Object.fromEntries(queries.map(([queryId]) => [queryId, { queryId, columns: [], rows: [], loading: true }])))

    void fetchDataBridgeQueries({ apiBaseUrl, workspaceId, queries }).then((nextResults) => {
      if (!cancelled) setResults(nextResults)
    }).catch((error) => {
      if (cancelled) return
      setResults(Object.fromEntries(queries.map(([queryId]) => [queryId, {
        queryId,
        columns: [],
        rows: [],
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }])))
    })

    return () => { cancelled = true }
  }, [apiBaseUrl, queries, refreshKey, workspaceId])

  return results
}
