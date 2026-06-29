import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createWorkspaceAgentServer } from "@hachej/boring-workspace/app/server"
import { createWorkspaceBridgeRegistry, type WorkspaceBridgeCallResponse } from "@hachej/boring-workspace/server"
import type { DataBridgeTableResult } from "../shared"
import { createDataBridgeServerPlugin, type DataBridgeSqlAdapter } from "./index"

let app: Awaited<ReturnType<typeof createWorkspaceAgentServer>> | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

function createWorkspaceFixture() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "data-bridge-test-"))
  writeFileSync(join(workspaceRoot, "data.csv"), "id,role\n1,engineer\n2,designer\n3,engineer\n")
  const outside = join(workspaceRoot, "..", "outside.csv")
  writeFileSync(outside, "id,role\n1,secret\n")
  symlinkSync(outside, join(workspaceRoot, "linked-outside.csv"))
  return workspaceRoot
}

async function createApp() {
  const workspaceRoot = createWorkspaceFixture()
  app = await createWorkspaceAgentServer({
    workspaceRoot,
    mode: "local",
    logger: false,
    plugins: [createDataBridgeServerPlugin({ workspaceRoot })],
    workspaceBridge: { allowInsecureLocalCliBrowserAuth: true },
  })
  return app
}

async function query(path: string, overrides: Record<string, unknown> = {}) {
  const server = await createApp()
  return await server.inject({
    method: "POST",
    url: "/api/v1/workspace-bridge/call",
    headers: { "content-type": "application/json" },
    payload: {
      op: "data.v1.query.run",
      input: {
        query: {
          language: "bsl-dashboard",
          model: "people",
          groupBy: ["role"],
          measures: ["count"],
          dataRef: { kind: "workspace-file", path },
          ...overrides,
        },
      },
    },
  })
}

async function sqlQuery(adapter: DataBridgeSqlAdapter, capabilities: string[], overrides: Record<string, unknown> = {}): Promise<WorkspaceBridgeCallResponse> {
  const plugin = createDataBridgeServerPlugin({
    workspaceRoot: createWorkspaceFixture(),
    sqlAdapters: { macro: adapter },
  })
  const registry = createWorkspaceBridgeRegistry()
  for (const contribution of plugin.workspaceBridgeHandlers ?? []) {
    registry.registerHandler(contribution.definition, contribution.handler)
  }
  return await registry.call({
    op: "data.v1.query.run",
    input: {
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

describe("data bridge workspace-file adapter", () => {
  it("aggregates workspace CSV data through WorkspaceBridge", async () => {
    const res = await query("data.csv")

    expect(res.statusCode).toBe(200)
    expect(res.json().output.rows).toEqual([
      { role: "engineer", count: 2 },
      { role: "designer", count: 1 },
    ])
  })

  it("honors dimensions as the grouping field fallback", async () => {
    const res = await query("data.csv", { groupBy: undefined, dimensions: ["role"] })

    expect(res.statusCode).toBe(200)
    expect(res.json().output.rows).toEqual([
      { role: "engineer", count: 2 },
      { role: "designer", count: 1 },
    ])
  })

  it("rejects workspace file paths that escape the workspace root", async () => {
    const res = await query("../outside.csv")

    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(res.json().ok).toBe(false)
  })

  it("rejects symlinks that resolve outside the workspace root", async () => {
    const res = await query("linked-outside.csv")

    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(res.json().ok).toBe(false)
  })
})

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
})
