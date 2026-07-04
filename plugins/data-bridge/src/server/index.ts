import { spawn } from "node:child_process"
import {
  defineServerPlugin,
  defineTrustedDomainBridgeHandler,
  type WorkspaceServerPlugin,
  type WorkspaceBridgeHandlerContribution,
} from "@hachej/boring-workspace/server"
import type {
  DataBridgeBslQuery,
  DataBridgeQueryRunInput,
  DataBridgeSqlQuery,
  DataBridgeTableResult,
} from "../shared"
import { DATA_BRIDGE_QUERY_RUN_OP } from "../shared"

export interface DataBridgeSqlAdapter {
  requiredCapabilities?: string[]
  maxRows?: number
  execute(args: {
    query: DataBridgeSqlQuery
    sql: string
    params?: Record<string, unknown>
    limit: number
    signal?: AbortSignal
  }): Promise<DataBridgeTableResult>
}

interface CreateDataBridgeServerPluginOptions {
  workspaceRoot: string
  bslModelPath?: string
  bslProfile?: string
  bslProfileFile?: string
  sqlAdapters?: Record<string, DataBridgeSqlAdapter>
}

const SQL_DEFAULT_LIMIT = 1000
const SQL_MAX_LIMIT = 5000
const SQL_ALLOWED_FIRST_TOKENS = new Set(["SELECT", "WITH", "EXPLAIN", "DESCRIBE", "SHOW", "DESC"])
const MULTI_STMT_RE = /;\s*\S/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeLimit(value: unknown, max = SQL_MAX_LIMIT): number {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return Math.min(SQL_DEFAULT_LIMIT, max)
  return Math.max(1, Math.min(Math.floor(n), max))
}

function requireCapabilities(actual: readonly string[], required: readonly string[]): void {
  const missing = required.find((capability) => !actual.includes(capability))
  if (missing) throw new Error(`Missing required data capability: ${missing}`)
}

function normalizeReadOnlySql(sql: string): string {
  const query = sql.trim().replace(/;+$/, "").trim()
  if (!query) throw new Error("SQL query is required")
  const firstToken = query.split(/\s+/)[0]?.toUpperCase() ?? ""
  if (!SQL_ALLOWED_FIRST_TOKENS.has(firstToken)) {
    throw new Error(`Only read-only SQL queries are allowed (${[...SQL_ALLOWED_FIRST_TOKENS].sort().join(", ")})`)
  }
  if (MULTI_STMT_RE.test(query)) throw new Error("Multi-statement SQL queries are not allowed")
  return query
}

function truncateResult(result: DataBridgeTableResult, limit: number): DataBridgeTableResult {
  if (result.rows.length <= limit) return result
  return {
    ...result,
    rows: result.rows.slice(0, limit),
    rowCount: Math.max(result.rowCount, result.rows.length),
    truncated: true,
  }
}

async function runBslQuery(options: CreateDataBridgeServerPluginOptions, input: DataBridgeQueryRunInput & { query: DataBridgeBslQuery }, signal?: AbortSignal): Promise<DataBridgeTableResult> {
  const modelPath = options.bslModelPath ?? process.env.BORING_BSL_MODEL_PATH ?? process.env.BSL_MODEL_PATH
  if (!modelPath) throw new Error("BSL adapter is not configured: set BORING_BSL_MODEL_PATH")
  const payload = {
    modelPath,
    profile: options.bslProfile ?? process.env.BORING_BSL_PROFILE,
    profileFile: options.bslProfileFile ?? process.env.BORING_BSL_PROFILE_FILE,
    model: input.query.model,
    query: input.query.query,
    limit: input.query.limit ?? 5000,
  }
  return await runPythonBsl(payload, signal)
}

async function runSqlQuery(options: CreateDataBridgeServerPluginOptions, input: DataBridgeQueryRunInput, capabilities: readonly string[], signal?: AbortSignal): Promise<DataBridgeTableResult> {
  if (input.query.language !== "sql") throw new Error("SQL adapter requires query.language=sql")
  requireCapabilities(capabilities, ["data:sql-query"])
  const adapter = options.sqlAdapters?.[input.query.source]
  if (!adapter) throw new Error(`Data bridge SQL source is not configured: ${input.query.source}`)
  requireCapabilities(capabilities, adapter.requiredCapabilities ?? [])
  const maxRows = adapter.maxRows ?? SQL_MAX_LIMIT
  const limit = normalizeLimit(input.query.limit, maxRows)
  const sql = normalizeReadOnlySql(input.query.sql)
  const result = await adapter.execute({
    query: { ...input.query, sql, limit },
    sql,
    params: input.query.params,
    limit,
    signal,
  })
  return { ...truncateResult(result, limit), source: result.source ?? input.query.source }
}

async function runPythonBsl(payload: Record<string, unknown>, signal?: AbortSignal): Promise<DataBridgeTableResult> {
  const script = String.raw`
import json, sys
from pathlib import Path
import ibis
from ibis import _
from returns.result import Failure, Success
from boring_semantic_layer import from_yaml
from boring_semantic_layer.utils import safe_eval
payload = json.loads(sys.stdin.read())
query = payload["query"]
models = from_yaml(Path(payload["modelPath"]), profile=payload.get("profile"), profile_path=payload.get("profileFile"))
sm = models[payload["model"]]
evaluated = safe_eval(query, context={**models, "sm": sm, "ibis": ibis, "_": _})
if isinstance(evaluated, Failure):
    raise evaluated.failure()
result = evaluated.unwrap() if isinstance(evaluated, Success) else evaluated
df = result.execute()
limit = int(payload.get("limit") or 5000)
rows = json.loads(df.head(limit).to_json(orient="records", date_format="iso"))
columns = []
for name in df.columns:
    series = df[name]
    kind = "string"
    if str(series.dtype).startswith("int"):
        kind = "integer"
    elif str(series.dtype).startswith("float") or str(series.dtype).startswith("decimal"):
        kind = "float"
    elif str(series.dtype).startswith("bool"):
        kind = "boolean"
    elif "datetime" in str(series.dtype):
        kind = "datetime"
    columns.append({"name": str(name), "type": kind})
print(json.dumps({"kind":"data-bridge.table","version":1,"columns":columns,"rows":rows,"rowCount":len(rows),"truncated": len(df) > len(rows), "source":"bsl"}))
`
  if (signal?.aborted) throw new Error("BSL query aborted")
  const child = spawn(process.env.BORING_DATA_BRIDGE_PYTHON ?? "python3", ["-c", script], { stdio: ["pipe", "pipe", "pipe"] })
  const abort = () => child.kill("SIGKILL")
  signal?.addEventListener("abort", abort, { once: true })
  child.stdin.end(JSON.stringify(payload))
  const [stdout, stderr, code] = await new Promise<[string, string, number | null]>((resolvePromise) => {
    let out = ""
    let err = ""
    child.stdout.on("data", (chunk) => { out += String(chunk) })
    child.stderr.on("data", (chunk) => { err += String(chunk) })
    child.on("close", (exitCode) => resolvePromise([out, err, exitCode]))
  }).finally(() => signal?.removeEventListener("abort", abort))
  if (signal?.aborted) throw new Error("BSL query aborted")
  if (code !== 0) throw new Error(stderr.trim() || `BSL query failed with exit code ${code}`)
  return JSON.parse(stdout) as DataBridgeTableResult
}

export function createDataBridgeServerPlugin(options: CreateDataBridgeServerPluginOptions): WorkspaceServerPlugin {
  const queryRun = defineTrustedDomainBridgeHandler<DataBridgeQueryRunInput, DataBridgeTableResult>({
    op: DATA_BRIDGE_QUERY_RUN_OP,
    version: 1,
    owner: "data-bridge",
    callerClassesAllowed: ["browser", "runtime", "server"],
    requiredCapabilities: ["data:read"],
    inputSchema: { type: "object" },
    maxOutputBytes: 2 * 1024 * 1024,
    timeoutMs: 30_000,
    idempotencyPolicy: "none",
    handler: async ({ input, context, signal }) => {
      if (!isRecord(input) || !isRecord(input.query)) throw new Error("Invalid data bridge query input")
      const typedInput = input as unknown as DataBridgeQueryRunInput
      if (typedInput.query.language === "sql") {
        return await runSqlQuery(options, typedInput, context.capabilities, signal)
      }
      if (typedInput.query.language !== "bsl") {
        throw new Error("Data bridge query language must be either bsl or sql")
      }
      return await runBslQuery(options, typedInput as DataBridgeQueryRunInput & { query: DataBridgeBslQuery }, signal)
    },
  })

  return defineServerPlugin({
    id: "data-bridge",
    label: "Data Bridge",
    workspaceBridgeHandlers: [queryRun as unknown as WorkspaceBridgeHandlerContribution],
    systemPrompt: "Use data.v1.query.run through WorkspaceBridge for dashboard data. Supported query languages are bsl and sql.",
  })
}

export default function defaultDataBridgeServerPlugin(_options: unknown, ctx: { workspaceRoot: string }): WorkspaceServerPlugin {
  return createDataBridgeServerPlugin({ workspaceRoot: ctx.workspaceRoot })
}
