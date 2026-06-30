import { useEffect, useMemo, useState } from "react"
import type { BslDashboardQuerySpec, BslDashboardSpec } from "../shared"

const DATA_BRIDGE_QUERY_RUN_OP = "data.v1.query.run"

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
        query: "sql" in options.query
          ? {
              language: "sql",
              source: options.query.source ?? "default",
              sql: options.query.sql,
              params: options.query.params,
              limit: options.query.limit,
            }
          : {
              language: "bsl",
              model: options.query.model,
              query: options.query.query,
              limit: options.query.limit,
            },
      },
    }),
  })
  const body = await response.json() as { ok?: boolean; output?: { columns?: DashboardQueryResult["columns"]; rows?: Record<string, unknown>[]; source?: string }; error?: { message?: string } }
  if (!response.ok || !body.ok || !body.output) {
    const message = body.error?.message ?? `Data bridge failed with HTTP ${response.status}`
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
