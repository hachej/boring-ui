import { mkdtempSync, writeFileSync } from "node:fs"
import { DuckDBInstance } from "@duckdb/node-api"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { createWorkspaceBridgeRegistry, type WorkspaceBridgeCallResponse } from "@hachej/boring-workspace/server"
import type { DataBridgeTableResult } from "../shared"
import { createClickHouseDataBridgeAdapter, createDataBridgeQueryAgentTool, createDataBridgeServerPlugin, type DataBridgeSqlAdapter } from "./index"

const { clickHouseQuery, clickHouseExec } = vi.hoisted(() => ({ clickHouseQuery: vi.fn(), clickHouseExec: vi.fn() }))

vi.mock("@clickhouse/client", () => ({
  createClient: vi.fn(() => ({ query: clickHouseQuery, exec: clickHouseExec })),
}))

function createWorkspaceFixture() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "data-bridge-test-"))
  writeFileSync(join(workspaceRoot, "data.csv"), "id,role\n1,engineer\n2,designer\n3,engineer\n")
  return workspaceRoot
}

function toolContext() {
  return { abortSignal: new AbortController().signal, toolCallId: "tool-call-test" }
}

async function sqlQuery(adapter: DataBridgeSqlAdapter, capabilities: string[], overrides: Record<string, unknown> = {}, format?: "json" | "arrow", pluginOptions: Parameters<typeof createDataBridgeServerPlugin>[0] = { workspaceRoot: createWorkspaceFixture() }): Promise<WorkspaceBridgeCallResponse> {
  const plugin = createDataBridgeServerPlugin({
    ...pluginOptions,
    sqlAdapters: { macro: adapter },
  })
  const registry = createWorkspaceBridgeRegistry()
  for (const contribution of plugin.workspaceBridgeHandlers ?? []) {
    registry.registerHandler(contribution.definition, contribution.handler)
  }
  return await registry.call({
    op: "data.v1.query.run",
    input: {
      ...(format ? { format } : {}),
      query: {
        language: "sql",
        source: "macro",
        sql: "SELECT series_id FROM series_catalog",
        limit: 2,
        ...overrides,
      },
    },
  }, {
    callerClass: "runtime",
    workspaceId: "workspace-test",
    capabilities,
    actor: { actorKind: "agent", performedBy: { label: "test" } },
  })
}

describe("data bridge SQL adapters", () => {
  function adapter(rows: Record<string, unknown>[] = [{ series_id: "GDP" }, { series_id: "CPI" }, { series_id: "UNRATE" }]): DataBridgeSqlAdapter {
    return {
      requiredCapabilities: ["data:macro-clickhouse"],
      maxRows: 2,
      execute: vi.fn(async ({ sql, limit }) => ({
        kind: "data-bridge.table" as const,
        version: 1 as const,
        columns: [{ name: "series_id", type: "string" as const }],
        rows,
        rowCount: rows.length,
        source: `${sql} limit=${limit}`,
      })),
    }
  }

  it("requires generic SQL capability", async () => {
    const sqlAdapter = adapter()
    const res = await sqlQuery(sqlAdapter, ["data:read", "data:macro-clickhouse"])

    expect(res.ok).toBe(false)
    expect(sqlAdapter.execute).not.toHaveBeenCalled()
  })

  it("requires source-specific capabilities", async () => {
    const sqlAdapter = adapter()
    const res = await sqlQuery(sqlAdapter, ["data:read", "data:sql-query"])

    expect(res.ok).toBe(false)
    expect(sqlAdapter.execute).not.toHaveBeenCalled()
  })

  it("rejects non-read-only SQL before adapter execution", async () => {
    const sqlAdapter = adapter()
    const res = await sqlQuery(sqlAdapter, ["data:read", "data:sql-query", "data:macro-clickhouse"], { sql: "DROP TABLE series_catalog" })

    expect(res.ok).toBe(false)
    expect(sqlAdapter.execute).not.toHaveBeenCalled()
  })

  it("rejects multi-statement SQL before adapter execution", async () => {
    const sqlAdapter = adapter()
    const res = await sqlQuery(sqlAdapter, ["data:read", "data:sql-query", "data:macro-clickhouse"], { sql: "SELECT 1; SELECT 2" })

    expect(res.ok).toBe(false)
    expect(sqlAdapter.execute).not.toHaveBeenCalled()
  })

  it("passes normalized SQL and bounded limits to adapters, then truncates defensively", async () => {
    const sqlAdapter = adapter()
    const res = await sqlQuery(sqlAdapter, ["data:read", "data:sql-query", "data:macro-clickhouse"], {
      sql: " SELECT series_id FROM series_catalog;;; ",
      limit: 99,
    })

    expect(res.ok).toBe(true)
    const output = res.ok ? res.output as DataBridgeTableResult : undefined
    expect(output?.rows).toEqual([{ series_id: "GDP" }, { series_id: "CPI" }])
    expect(output?.truncated).toBe(true)
    expect(sqlAdapter.execute).toHaveBeenCalledWith(expect.objectContaining({
      sql: "SELECT series_id FROM series_catalog",
      limit: 2,
    }))
  })

  it("materializes SQL query results as Arrow snapshots", async () => {
    const sqlAdapter = adapter([{ series_id: "GDP" }])
    const res = await sqlQuery(sqlAdapter, ["data:read", "data:sql-query", "data:macro-clickhouse"], {
      sql: "SELECT series_id FROM series_catalog",
      limit: 1,
    }, "arrow")

    expect(res.ok).toBe(true)
    const output = res.ok ? res.output as { kind: string; arrowBase64: string; columns: Array<{ name: string }> } : undefined
    expect(output?.kind).toBe("data-bridge.arrow")
    expect(output?.arrowBase64.length).toBeGreaterThan(0)
    expect(output?.columns.map((column) => column.name)).toEqual(["series_id"])
  })

  it("lets ClickHouse adapters return native Arrow without JSON materialization", async () => {
    clickHouseExec.mockResolvedValueOnce({
      stream: (async function* streamArrow() { yield Buffer.from([1, 2, 3, 4]) })(),
    })
    const sqlAdapter = createClickHouseDataBridgeAdapter({ url: "http://clickhouse.test:8123" })
    const res = await sqlQuery(sqlAdapter, ["data:read", "data:sql-query", "data:clickhouse"], {
      sql: "SELECT series_id FROM series_catalog LIMIT 100000",
      limit: 100,
    }, "arrow")

    expect(res.ok).toBe(true)
    const output = res.ok ? res.output as { kind: string; arrowBase64: string; rowCount?: number } : undefined
    expect(output).toMatchObject({ kind: "data-bridge.arrow", arrowBase64: Buffer.from([1, 2, 3, 4]).toString("base64") })
    expect(output?.rowCount).toBeUndefined()
    expect(clickHouseExec).toHaveBeenCalledWith(expect.objectContaining({
      query: "SELECT * FROM (SELECT series_id FROM series_catalog LIMIT 100000) AS data_bridge_query LIMIT 100 FORMAT Arrow",
    }))
  })

  it("runs an end-to-end SQL query through a DuckDB file adapter", async () => {
    const workspaceRoot = createWorkspaceFixture()
    const dbPath = join(workspaceRoot, "macro-fixture.duckdb")
    const instance = await DuckDBInstance.create(dbPath)
    const connection = await instance.connect()
    try {
      await connection.run("create table series_catalog(series_id varchar, frequency varchar)")
      await connection.run("insert into series_catalog values ('GDP', 'quarterly'), ('CPI', 'monthly'), ('UNRATE', 'monthly')")

      const sqlAdapter: DataBridgeSqlAdapter = {
        requiredCapabilities: ["data:macro-clickhouse"],
        maxRows: 10,
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
            source: "duckdb-file",
          }
        },
      }

      const res = await sqlQuery(sqlAdapter, ["data:read", "data:sql-query", "data:macro-clickhouse"], {
        sql: "SELECT frequency, count(*) as count FROM series_catalog GROUP BY frequency ORDER BY frequency",
        limit: 5,
      })

      expect(res.ok).toBe(true)
      expect(res.ok ? (res.output as DataBridgeTableResult).rows : []).toEqual([
        { frequency: "monthly", count: "2" },
        { frequency: "quarterly", count: "1" },
      ])
    } finally {
      connection.closeSync()
      instance.closeSync()
    }
  })
})

describe("data bridge agent tool", () => {
  function adapter(rows: Record<string, unknown>[] = [{ series_id: "GDP" }]): DataBridgeSqlAdapter {
    return {
      requiredCapabilities: ["data:macro-clickhouse"],
      maxRows: 10,
      execute: vi.fn(async ({ sql, params, limit }) => ({
        kind: "data-bridge.table" as const,
        version: 1 as const,
        columns: [{ name: "series_id", type: "string" as const }],
        rows,
        rowCount: rows.length,
        source: JSON.stringify({ sql, params, limit }),
      })),
    }
  }

  it("registers query_data by default", () => {
    const plugin = createDataBridgeServerPlugin({ workspaceRoot: createWorkspaceFixture() })

    expect(plugin.agentTools?.map((tool) => tool.name)).toEqual(["query_data"])
    expect(plugin.systemPrompt).toContain("query_data")
  })

  it("can disable the agent query tool", () => {
    const plugin = createDataBridgeServerPlugin({ workspaceRoot: createWorkspaceFixture(), agentTool: false })

    expect(plugin.agentTools).toEqual([])
  })

  it("runs read-only SQL through the same adapter path as data.v1.query.run", async () => {
    const sqlAdapter = adapter()
    const tool = createDataBridgeQueryAgentTool({
      workspaceRoot: createWorkspaceFixture(),
      sqlAdapters: { macro: sqlAdapter },
      agentTool: { capabilities: ["data:read", "data:sql-query", "data:macro-clickhouse"] },
    })

    const result = await tool.execute({
      language: "sql",
      source: "macro",
      sql: " SELECT series_id FROM series_catalog;;; ",
      params: { frequency: "monthly" },
      limit: 2,
    }, toolContext())

    expect(result.isError).toBeUndefined()
    expect(result.details).toMatchObject({
      kind: "data-bridge.table",
      rows: [{ series_id: "GDP" }],
      source: expect.stringContaining("SELECT series_id FROM series_catalog"),
    })
    expect(sqlAdapter.execute).toHaveBeenCalledWith(expect.objectContaining({
      sql: "SELECT series_id FROM series_catalog",
      params: { frequency: "monthly" },
      limit: 2,
    }))
  })

  it("rejects invalid tool inputs before execution", async () => {
    const sqlAdapter = adapter()
    const tool = createDataBridgeQueryAgentTool({
      workspaceRoot: createWorkspaceFixture(),
      sqlAdapters: { macro: sqlAdapter },
      agentTool: { capabilities: ["data:read", "data:sql-query", "data:macro-clickhouse"] },
    })

    await expect(tool.execute({ language: "bsl", query: "sm" }, toolContext()))
      .resolves.toMatchObject({ isError: true, content: [{ text: "model is required for bsl queries" }] })
    await expect(tool.execute({ language: "sql", sql: "SELECT 1" }, toolContext()))
      .resolves.toMatchObject({ isError: true, content: [{ text: "source is required for sql queries" }] })
    expect(sqlAdapter.execute).not.toHaveBeenCalled()
  })
})
