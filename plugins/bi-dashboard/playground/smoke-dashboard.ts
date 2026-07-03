#!/usr/bin/env -S tsx
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { DuckDBConnection, quotedIdentifier, quotedString } from "@duckdb/node-api"
import { createWorkspaceBridgeRegistry } from "@hachej/boring-workspace/server"
import { createDataBridgeServerPlugin, type DataBridgeSqlAdapter } from "@hachej/boring-data-bridge/server"
import type { DataBridgeTableResult } from "@hachej/boring-data-bridge/shared"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PLUGIN_ROOT = resolve(__dirname, "..")
const EXAMPLE_ROOT = resolve(PLUGIN_ROOT, "example")
const DASHBOARD_PATH = resolve(EXAMPLE_ROOT, "dashboards/people.dashboard.json")

async function createPeopleDuckDbAdapter(): Promise<{ adapter: DataBridgeSqlAdapter; close: () => void }> {
  const connection = await DuckDBConnection.create()
  await connection.run(
    `create or replace view ${quotedIdentifier("people")} as select * from read_csv_auto(${quotedString(resolve(EXAMPLE_ROOT, "data/people.csv"))}, HEADER = true)`,
  )
  return {
    adapter: {
      maxRows: 100,
      async execute({ sql, limit }) {
        const reader = await connection.runAndReadUntil(sql, limit + 1)
        const rows = reader.getRowObjectsJson().slice(0, limit) as Record<string, unknown>[]
        return {
          kind: "data-bridge.table",
          version: 1,
          columns: reader.columnNames().map((name) => ({ name, type: "string" })),
          rows,
          rowCount: rows.length,
          truncated: !reader.done || reader.currentRowCount > limit,
          source: "people-duckdb",
        }
      },
    },
    close: () => connection.closeSync(),
  }
}

async function main(): Promise<number> {
  const dashboard = JSON.parse(readFileSync(DASHBOARD_PATH, "utf8")) as {
    profile?: unknown
    queries?: Record<string, { id: string; source?: string; sql?: string; params?: Record<string, unknown>; model?: string; query?: string; limit?: number }>
  }
  if (dashboard.profile !== "bi-dashboard" || !dashboard.queries) {
    console.error("[bi-dashboard smoke] invalid dashboard fixture")
    return 1
  }

  const { adapter, close } = await createPeopleDuckDbAdapter()
  try {
    const plugin = createDataBridgeServerPlugin({
      workspaceRoot: EXAMPLE_ROOT,
      sqlAdapters: { "people-duckdb": adapter },
    })
    const registry = createWorkspaceBridgeRegistry()
    for (const contribution of plugin.workspaceBridgeHandlers ?? []) {
      registry.registerHandler(contribution.definition, contribution.handler)
    }

    for (const [queryId, query] of Object.entries(dashboard.queries)) {
      const bridgeQuery = query.sql
        ? { language: "sql" as const, source: query.source ?? "default", sql: query.sql, params: query.params, limit: query.limit }
        : { language: "bsl" as const, model: query.model ?? "", query: query.query ?? "", limit: query.limit }

      const res = await registry.call({
        op: "data.v1.query.run",
        input: { query: bridgeQuery },
      }, {
        callerClass: "runtime",
        workspaceId: "bi-dashboard-smoke",
        capabilities: ["data:read", "data:sql-query"],
        actor: { actorKind: "agent", performedBy: { label: "bi-dashboard smoke" } },
      })

      if (!res.ok) {
        console.error(`[bi-dashboard smoke] ${queryId} failed: ${res.error.message}`)
        return 1
      }
      const output = res.output as DataBridgeTableResult
      if (!Array.isArray(output.rows) || output.rows.length === 0) {
        console.error(`[bi-dashboard smoke] ${queryId} returned no rows`)
        return 1
      }
      console.log(`[bi-dashboard smoke] ${queryId}: ${output.rows.length} row(s)`)
    }
    return 0
  } finally {
    close()
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("[bi-dashboard smoke] fatal:", err)
    process.exit(2)
  },
)
