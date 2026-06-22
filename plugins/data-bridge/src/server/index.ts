import { spawn } from "node:child_process"
import { readFile, realpath } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"
import {
  defineServerPlugin,
  defineTrustedDomainBridgeHandler,
  type WorkspaceServerPlugin,
  type WorkspaceBridgeHandlerContribution,
} from "@hachej/boring-workspace/server"
import type {
  DataBridgeColumn,
  DataBridgeDashboardQuery,
  DataBridgeQueryRunInput,
  DataBridgeTableResult,
} from "../shared"
import { DATA_BRIDGE_QUERY_RUN_OP } from "../shared"

interface CreateDataBridgeServerPluginOptions {
  workspaceRoot: string
  bslModelPath?: string
  bslProfile?: string
  bslProfileFile?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function parseCsv(text: string): Record<string, unknown>[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  const headers = splitCsvLine(lines[0] ?? "")
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line)
    return Object.fromEntries(headers.map((header, index) => [header, parseCell(cells[index] ?? "")]))
  })
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
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true"
  const number = Number(value)
  if (Number.isFinite(number) && /^-?\d+(\.\d+)?$/.test(value)) return number
  return value
}

function applyFilters(rows: Record<string, unknown>[], filters: DataBridgeDashboardQuery["filters"]): Record<string, unknown>[] {
  if (!filters?.length) return rows
  return rows.filter((row) => filters.every((filter) => {
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
        const n = numeric(value)
        return n !== null && n >= Number(filter.value[0]) && n <= Number(filter.value[1])
      }
    }
  }))
}

function applyOrder(rows: Record<string, unknown>[], orderBy: DataBridgeDashboardQuery["orderBy"]): Record<string, unknown>[] {
  if (!orderBy?.length) return rows
  return [...rows].sort((a, b) => {
    for (const [field, direction] of orderBy) {
      const an = numeric(a[field])
      const bn = numeric(b[field])
      const cmp = an !== null && bn !== null ? an - bn : String(a[field] ?? "").localeCompare(String(b[field] ?? ""))
      if (cmp !== 0) return direction === "desc" ? -cmp : cmp
    }
    return 0
  })
}

function aggregateRows(rows: Record<string, unknown>[], query: DataBridgeDashboardQuery): Record<string, unknown>[] {
  const filtered = applyFilters(rows, query.filters)
  const groups = query.groupBy ?? query.dimensions ?? []
  const measures = query.measures?.length ? query.measures : ["count"]
  if (groups.length === 0) {
    const result: Record<string, unknown> = {}
    for (const measure of measures) {
      const values = filtered.map((row) => numeric(row[measure])).filter((value): value is number => value !== null)
      result[measure] = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : filtered.length
    }
    return applyOrder([result], query.orderBy).slice(0, query.limit ?? undefined)
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
  }), query.orderBy).slice(0, query.limit ?? undefined)
}

function inferType(values: unknown[]): DataBridgeColumn["type"] {
  const sample = values.find((value) => value !== null && value !== undefined)
  if (typeof sample === "boolean") return "boolean"
  if (typeof sample === "number") return Number.isInteger(sample) ? "integer" : "float"
  if (sample && typeof sample === "object") return "json"
  return "string"
}

function inferColumns(rows: Record<string, unknown>[]): DataBridgeColumn[] {
  const names = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  return names.map((name) => ({ name, type: inferType(rows.map((row) => row[name])) }))
}

async function resolveWorkspacePath(workspaceRoot: string, path: string): Promise<string> {
  if (isAbsolute(path) || path.includes("\0")) throw new Error("Invalid workspace file path")
  const root = resolve(workspaceRoot)
  const target = resolve(root, path)
  const rel = relative(root, target)
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Workspace file path escapes workspace root")
  const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)])
  const realRel = relative(realRoot, realTarget)
  if (realRel === "" || realRel.startsWith("..") || isAbsolute(realRel)) throw new Error("Workspace file path escapes workspace root")
  return realTarget
}

async function runWorkspaceFileQuery(workspaceRoot: string, input: DataBridgeQueryRunInput): Promise<DataBridgeTableResult> {
  if (input.query.language !== "bsl-dashboard" || input.query.dataRef?.kind !== "workspace-file") {
    throw new Error("workspace-file adapter requires bsl-dashboard query with dataRef.kind=workspace-file")
  }
  const path = input.query.dataRef.path
  const content = await readFile(await resolveWorkspacePath(workspaceRoot, path), "utf8")
  const rawRows = path.endsWith(".json")
    ? JSON.parse(content) as Record<string, unknown>[]
    : path.endsWith(".ndjson") || path.endsWith(".jsonl")
      ? content.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
      : parseCsv(content)
  const rows = aggregateRows(rawRows.slice(0, input.query.dataRef.limit ?? 10000), input.query)
  return { kind: "data-bridge.table", version: 1, columns: inferColumns(rows), rows, rowCount: rows.length, source: path }
}

function compileDashboardToBslPython(query: DataBridgeDashboardQuery): string {
  const groups = query.groupBy ?? query.dimensions ?? []
  const measures = query.measures ?? []
  const groupCall = groups.length > 0 ? `.group_by(${groups.map((item) => JSON.stringify(item)).join(", ")})` : ""
  const aggregateArgs = measures.map((item) => JSON.stringify(item)).join(", ")
  return `sm${groupCall}.aggregate(${aggregateArgs})`
}

async function runBslQuery(options: CreateDataBridgeServerPluginOptions, input: DataBridgeQueryRunInput, trustedPython: boolean, signal?: AbortSignal): Promise<DataBridgeTableResult> {
  const modelPath = options.bslModelPath ?? process.env.BORING_BSL_MODEL_PATH ?? process.env.BSL_MODEL_PATH
  if (!modelPath) throw new Error("BSL adapter is not configured: set BORING_BSL_MODEL_PATH")
  const payload = {
    modelPath,
    profile: options.bslProfile ?? process.env.BORING_BSL_PROFILE,
    profileFile: options.bslProfileFile ?? process.env.BORING_BSL_PROFILE_FILE,
    model: input.query.model,
    query: input.query.language === "bsl-python" ? input.query.query : compileDashboardToBslPython(input.query),
    limit: input.query.limit ?? 5000,
    trustedPython,
  }
  return await runPythonBsl(payload, signal)
}

async function runPythonBsl(payload: Record<string, unknown>, signal?: AbortSignal): Promise<DataBridgeTableResult> {
  const script = String.raw`
import json, sys, ast
from pathlib import Path
from boring_semantic_layer import from_yaml
payload = json.loads(sys.stdin.read())
query = payload["query"]
if not payload.get("trustedPython"):
    tree = ast.parse(query, mode="eval")
    allowed = (ast.Expression, ast.Call, ast.Attribute, ast.Name, ast.Load, ast.Constant, ast.Tuple, ast.List)
    for node in ast.walk(tree):
        if not isinstance(node, allowed):
            raise ValueError(f"Unsupported BSL query syntax: {type(node).__name__}")
        if isinstance(node, ast.Name) and node.id != "sm":
            raise ValueError(f"Unsupported BSL query name: {node.id}")
models = from_yaml(Path(payload["modelPath"]), profile=payload.get("profile"), profile_path=payload.get("profileFile"))
sm = models[payload["model"]]
result = eval(compile(query, "<data-bridge-bsl>", "eval"), {"__builtins__": {}}, {"sm": sm})
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
    requiredCapabilities: [],
    inputSchema: { type: "object" },
    maxOutputBytes: 2 * 1024 * 1024,
    timeoutMs: 30_000,
    idempotencyPolicy: "none",
    handler: async ({ input, context, signal }) => {
      if (!isRecord(input) || !isRecord(input.query)) throw new Error("Invalid data bridge query input")
      const typedInput = input as unknown as DataBridgeQueryRunInput
      if (typedInput.query.language === "bsl-python" && (context.callerClass === "browser" || !context.capabilities.includes("data:bsl-query-string"))) {
        throw new Error("trusted runtime/server caller with data:bsl-query-string capability is required for bsl-python queries")
      }
      if (typedInput.query.language === "bsl-dashboard" && typedInput.query.dataRef?.kind === "workspace-file") {
        return await runWorkspaceFileQuery(options.workspaceRoot, typedInput)
      }
      return await runBslQuery(options, typedInput, typedInput.query.language === "bsl-python", signal)
    },
  })

  return defineServerPlugin({
    id: "data-bridge",
    label: "Data Bridge",
    workspaceBridgeHandlers: [queryRun as unknown as WorkspaceBridgeHandlerContribution],
    systemPrompt: "Use data.v1.query.run through WorkspaceBridge for semantic dashboard data. Prefer bsl-dashboard requests; direct bsl-python requires trusted capability.",
  })
}

export default function defaultDataBridgeServerPlugin(_options: unknown, ctx: { workspaceRoot: string }): WorkspaceServerPlugin {
  return createDataBridgeServerPlugin({ workspaceRoot: ctx.workspaceRoot })
}
