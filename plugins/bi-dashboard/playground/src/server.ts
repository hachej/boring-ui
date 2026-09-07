import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { DuckDBInstance } from "@duckdb/node-api"
import { createWorkspaceAgentServer } from "@hachej/boring-workspace/app/server"
import { createDataBridgeServerPlugin, type DataBridgeSqlAdapter } from "@hachej/boring-data-bridge/server"

export const PLAYGROUND_ROOT = resolve(import.meta.dirname, "..")
export const EXAMPLE_WORKSPACE_ROOT = resolve(PLAYGROUND_ROOT, "../example")
export const AGENT_API_PORT = Number(process.env.AGENT_API_PORT) || 5321
export const VITE_PORT = Number(process.env.PORT) || 5320

function copyMissingTree(srcRoot: string, destRoot: string): void {
  for (const name of readdirSync(srcRoot)) {
    const src = resolve(srcRoot, name)
    const stats = statSync(src)
    if (stats.isDirectory()) {
      copyMissingTree(src, resolve(destRoot, name))
      continue
    }
    if (!stats.isFile()) continue
    const dest = resolve(destRoot, name)
    if (existsSync(dest)) continue
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(src, dest)
  }
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function createDuckDbConnectionAdapter(options: {
  source: string
  connect: () => Promise<Awaited<ReturnType<DuckDBInstance["connect"]>>>
}): DataBridgeSqlAdapter {
  let setup: Promise<{ connection: Awaited<ReturnType<DuckDBInstance["connect"]>> }> | null = null
  async function getConnection() {
    setup ??= options.connect().then((connection) => ({ connection }))
    return (await setup).connection
  }
  return {
    requiredCapabilities: ["data:duckdb-read"],
    maxRows: 5000,
    async execute({ sql, limit }) {
      const connection = await getConnection()
      const reader = await connection.runAndReadUntil(sql, limit + 1)
      const rows = reader.getRowObjectsJson().slice(0, limit) as Record<string, unknown>[]
      return {
        kind: "data-bridge.table",
        version: 1,
        columns: reader.columnNames().map((name) => ({ name, type: "string" as const })),
        rows,
        rowCount: rows.length,
        truncated: !reader.done || reader.currentRowCount > limit,
        source: options.source,
      }
    },
  }
}

function createCsvDuckDbAdapter(workspaceRoot: string, source: string, tableName: string, csvPath: string): DataBridgeSqlAdapter {
  return createDuckDbConnectionAdapter({
    source,
    async connect() {
      const instance = await DuckDBInstance.create(":memory:")
      const connection = await instance.connect()
      await connection.run(`CREATE OR REPLACE VIEW ${tableName} AS SELECT * FROM read_csv_auto(${sqlString(join(workspaceRoot, csvPath))}, header=true)`)
      return connection
    },
  })
}

function createDuckDbFileAdapter(workspaceRoot: string, source: string, dbPath: string): DataBridgeSqlAdapter {
  return createDuckDbConnectionAdapter({
    source,
    async connect() {
      const instance = await DuckDBInstance.create(join(workspaceRoot, dbPath), { access_mode: "READ_ONLY" })
      return await instance.connect()
    },
  })
}

function createPlaygroundDataBridgePlugin(workspaceRoot: string) {
  const plugin = createDataBridgeServerPlugin({
    workspaceRoot,
    sqlAdapters: {
      "people-duckdb": createCsvDuckDbAdapter(workspaceRoot, "people-duckdb", "people", "data/people.csv"),
      "warden_benchmark-duckdb": createCsvDuckDbAdapter(workspaceRoot, "warden_benchmark-duckdb", "warden_benchmark", "data/warden_benchmark.csv"),
      "opus48_high_runtime_comparison-duckdb": createCsvDuckDbAdapter(workspaceRoot, "opus48_high_runtime_comparison-duckdb", "opus48_high_runtime_comparison", "data/opus48_high_runtime_comparison.csv"),
      "random_retail-duckdb": createDuckDbFileAdapter(workspaceRoot, "random_retail-duckdb", "data/random_retail.duckdb"),
    },
  })
  // Dev-only: local CLI browser auth grants statically declared op capabilities.
  for (const contribution of plugin.workspaceBridgeHandlers ?? []) {
    ;(contribution.definition as unknown as { requiredCapabilities: string[] }).requiredCapabilities = ["data:read", "data:sql-query", "data:duckdb-read"]
  }
  return plugin
}

let boot: Promise<void> | null = null

export async function startBiDashboardPlaygroundServer(): Promise<void> {
  if (boot) return boot
  boot = (async () => {
    const workspaceRoot = process.env.BORING_AGENT_WORKSPACE_ROOT ?? EXAMPLE_WORKSPACE_ROOT
    if (process.env.BI_DASHBOARD_PLAYGROUND_SEED !== "0") {
      mkdirSync(workspaceRoot, { recursive: true })
      copyMissingTree(EXAMPLE_WORKSPACE_ROOT, workspaceRoot)
    }
    console.log(`[bi-dashboard-playground] workspace root: ${workspaceRoot}`)
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      appRoot: PLAYGROUND_ROOT,
      mode: process.env.BORING_AGENT_MODE?.trim() === "direct" ? "direct" : "local",
      logger: true,
      plugins: [createPlaygroundDataBridgePlugin(workspaceRoot)],
      defaultPluginPackages: [resolve(PLAYGROUND_ROOT, "..")],
      workspaceBridge: { allowInsecureLocalCliBrowserAuth: true },
    })
    app.get("/api/v1/workspace/meta", async () => ({
      projectName: "BI Dashboard Playground",
      workspaceId: "default",
      workspaceRoot,
    }))
    await app.listen({ port: AGENT_API_PORT, host: "127.0.0.1" })
  })()
  return boot
}
