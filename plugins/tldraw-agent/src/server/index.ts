import { posix } from "node:path"
import { createHash, randomUUID } from "node:crypto"
import type { FastifyPluginAsync } from "fastify"
import { createTLStore, parseTldrawJsonFile } from "tldraw"
import type { Workspace, Stat } from "@hachej/boring-agent/shared"
import type { AgentTool, ToolResult } from "@hachej/boring-workspace"
import { defineServerPlugin, type UiBridge, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import { normalizeTldrawResourcePath, TLDRAW_AGENT_PLUGIN_ID, type CanvasAction, type PendingCanvasBatch } from "../shared"

type BatchState = "pending" | "claimed" | "committing" | "committed" | "failed" | "cancelled"
interface CommitOutcome { statusCode: number; body: unknown }
interface CommitRequest { fingerprint: string; promise: Promise<CommitOutcome> }
interface FileRevision { size: number; mtimeMs: number; sha256: string }
interface BatchEntry {
  batch: PendingCanvasBatch
  state: BatchState
  resolve: (value: ToolResult) => void
  timer?: ReturnType<typeof setTimeout>
  ownerClientId?: string
  outcome?: CommitOutcome
}

const USER_FILESYSTEM = "user" as const
const GEO_SHAPE_TYPES = ["rectangle", "ellipse", "diamond"] as const
const SHAPE_ID_PATTERN = /^(?:shape:)?[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/
const COLORS = ["black", "blue", "green", "orange", "red", "violet"] as const
const FILLS = ["none", "semi"] as const

function result(text: string, details?: unknown, isError = false): ToolResult {
  return { content: [{ type: "text", text }], details, ...(isError ? { isError: true } : {}) }
}

const tldrawPath = normalizeTldrawResourcePath

function requireUserFilesystem(value: unknown): "user" {
  if (value !== undefined && value !== USER_FILESYSTEM) throw new Error("only the user filesystem is supported")
  return USER_FILESYSTEM
}

function parseNative(json: string) {
  const parsed = parseTldrawJsonFile({ json, schema: createTLStore().schema })
  if (!parsed.ok) throw new Error(`invalid native tldraw file: ${parsed.error.type}`)
  return parsed.value
}

function blankFile(): string {
  const snapshot = createTLStore().getStoreSnapshot()
  return JSON.stringify({ tldrawFileFormatVersion: 1, schema: snapshot.schema, records: [] })
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function canonicalShapeId(value: string): string { return value.replace(/^shape:/, "") }

export function validateActions(value: unknown): CanvasAction[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) throw new Error("edit requires 1-100 actions")
  const createdIds = new Set<string>()
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("each action must be an object")
    const action = raw as Record<string, unknown>
    if (action.type === "clear") {
      if (!exactKeys(action, ["type"])) throw new Error("clear accepts no additional fields")
      continue
    }
    if (action.type === "create" || action.type === "update") {
      if (!exactKeys(action, ["type", "shape"]) || !action.shape || typeof action.shape !== "object" || Array.isArray(action.shape)) throw new Error(`${action.type} requires shape`)
      const shape = action.shape as Record<string, unknown>
      const isTextCreate = action.type === "create" && shape.type === "text"
      const isTextUpdate = action.type === "update" && shape.target === "text"
      const allowed = action.type === "create"
        ? isTextCreate ? ["id", "type", "x", "y", "w", "text", "color"] : ["id", "type", "x", "y", "w", "h", "text", "color", "fill"]
        : isTextUpdate ? ["id", "target", "x", "y", "w", "text", "color"] : ["id", "target", "x", "y", "w", "h", "text", "color", "fill"]
      if (!exactKeys(shape, allowed) || typeof shape.id !== "string" || !SHAPE_ID_PATTERN.test(shape.id)) throw new Error(`${action.type} shape requires valid id`)
      if (action.type === "create" && (!(shape.type === "text" || GEO_SHAPE_TYPES.includes(shape.type as never)) || !isFiniteNumber(shape.x) || !isFiniteNumber(shape.y))) throw new Error("create shape requires valid type, x, and y")
      if (action.type === "create") {
        const canonicalId = canonicalShapeId(shape.id as string)
        if (createdIds.has(canonicalId)) throw new Error("create requires unique canonical shape ids")
        createdIds.add(canonicalId)
      }
      if (action.type === "update" && !["geo", "text"].includes(String(shape.target))) throw new Error("update requires target")
      if (action.type === "update" && !Object.keys(shape).some((key) => key !== "id" && key !== "target")) throw new Error("update requires at least one mutable property")
      for (const key of ["x", "y", "w", "h"] as const) if (shape[key] !== undefined && !isFiniteNumber(shape[key])) throw new Error(`${key} must be finite`)
      if (shape.text !== undefined && typeof shape.text !== "string") throw new Error("text must be a string")
      if (shape.color !== undefined && !COLORS.includes(shape.color as never)) throw new Error("invalid color")
      if (shape.fill !== undefined && !FILLS.includes(shape.fill as never)) throw new Error("invalid fill")
      continue
    }
    if (action.type === "delete" || action.type === "align" || action.type === "distribute") {
      const allowed = action.type === "delete" ? ["type", "ids"] : action.type === "align" ? ["type", "ids", "axis", "alignment"] : ["type", "ids", "axis"]
      const ids = action.ids
      if (!exactKeys(action, allowed) || !Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !SHAPE_ID_PATTERN.test(id))) throw new Error(`${action.type} requires valid string ids`)
      if (new Set(ids.map(canonicalShapeId)).size !== ids.length) throw new Error(`${action.type} requires unique canonical ids`)
      const minimum = action.type === "delete" ? 1 : action.type === "align" ? 2 : 3
      if (ids.length < minimum) throw new Error(`${action.type} requires at least ${minimum} ids`)
      if (action.type !== "delete" && !["x", "y"].includes(String(action.axis))) throw new Error(`${action.type} requires axis`)
      if (action.type === "align" && !["start", "center", "end"].includes(String(action.alignment))) throw new Error("align requires alignment")
      continue
    }
    throw new Error(`unsupported action: ${String(action.type)}`)
  }
  return value as CanvasAction[]
}

function richTextText(value: unknown): string {
  if (!value || typeof value !== "object") return ""
  const node = value as { text?: unknown; content?: unknown[] }
  return `${typeof node.text === "string" ? node.text : ""}${Array.isArray(node.content) ? node.content.map(richTextText).join("") : ""}`
}

export function nativeShapeSummary(json: string): string {
  const store = parseNative(json)
  const all = store.allRecords().filter((record) => record.typeName === "shape") as unknown as Array<Record<string, unknown>>
  const limit = 100
  const shapes = all.slice(0, limit).map((record) => {
    const props = (record.props && typeof record.props === "object" ? record.props : {}) as Record<string, unknown>
    return {
      id: record.id,
      type: record.type,
      x: record.x,
      y: record.y,
      w: props.w,
      h: props.h,
      text: richTextText(props.richText).slice(0, 300),
      color: props.color,
      fill: props.fill,
      geo: props.geo,
    }
  })
  return JSON.stringify({ total: all.length, returned: shapes.length, truncated: all.length > limit, shapes })
}

const idSchema = { type: "string", minLength: 1, pattern: SHAPE_ID_PATTERN.source } as const
const commonMutableProperties = {
  x: { type: "number" }, y: { type: "number" }, w: { type: "number" },
  text: { type: "string" }, color: { type: "string", enum: [...COLORS] },
} as const
const geoMutableProperties = { ...commonMutableProperties, h: { type: "number" }, fill: { type: "string", enum: [...FILLS] } } as const
const actionSchema = {
  oneOf: [
    { type: "object", properties: { type: { const: "create" }, shape: { type: "object", properties: { id: idSchema, type: { const: "text" }, ...commonMutableProperties }, required: ["id", "type", "x", "y"], additionalProperties: false } }, required: ["type", "shape"], additionalProperties: false },
    { type: "object", properties: { type: { const: "create" }, shape: { type: "object", properties: { id: idSchema, type: { enum: [...GEO_SHAPE_TYPES] }, ...geoMutableProperties }, required: ["id", "type", "x", "y"], additionalProperties: false } }, required: ["type", "shape"], additionalProperties: false },
    { type: "object", properties: { type: { const: "update" }, shape: { type: "object", properties: { id: idSchema, target: { const: "text" }, ...commonMutableProperties }, required: ["id", "target"], anyOf: Object.keys(commonMutableProperties).map((key) => ({ required: [key] })), additionalProperties: false } }, required: ["type", "shape"], additionalProperties: false },
    { type: "object", properties: { type: { const: "update" }, shape: { type: "object", properties: { id: idSchema, target: { const: "geo" }, ...geoMutableProperties }, required: ["id", "target"], anyOf: Object.keys(geoMutableProperties).map((key) => ({ required: [key] })), additionalProperties: false } }, required: ["type", "shape"], additionalProperties: false },
    { type: "object", properties: { type: { const: "delete" }, ids: { type: "array", minItems: 1, uniqueItems: true, items: idSchema } }, required: ["type", "ids"], additionalProperties: false },
    { type: "object", properties: { type: { const: "clear" } }, required: ["type"], additionalProperties: false },
    { type: "object", properties: { type: { const: "align" }, ids: { type: "array", minItems: 2, uniqueItems: true, items: idSchema }, axis: { enum: ["x", "y"] }, alignment: { enum: ["start", "center", "end"] } }, required: ["type", "ids", "axis", "alignment"], additionalProperties: false },
    { type: "object", properties: { type: { const: "distribute" }, ids: { type: "array", minItems: 3, uniqueItems: true, items: idSchema }, axis: { enum: ["x", "y"] } }, required: ["type", "ids", "axis"], additionalProperties: false },
  ],
} as const

export function createCanvasTool(workspace: Workspace, batches: Map<string, BatchEntry> = new Map(), bridge?: UiBridge): AgentTool {
  return {
    name: "edit_tldraw_canvas",
    description: "Create, inspect, or batch-edit a native .tldraw file through its live workspace tab.",
    promptSnippet: "Use one edit action batch per requested canvas change. Only the user filesystem is supported.",
    parameters: {
      oneOf: [
        { type: "object", properties: { operation: { const: "create" }, path: { type: "string" } }, required: ["operation", "path"], additionalProperties: false },
        { type: "object", properties: { operation: { const: "read" }, path: { type: "string" } }, required: ["operation", "path"], additionalProperties: false },
        { type: "object", properties: { operation: { const: "edit" }, path: { type: "string" }, actions: { type: "array", minItems: 1, maxItems: 100, items: actionSchema } }, required: ["operation", "path", "actions"], additionalProperties: false },
      ],
    },
    async execute(params, ctx) {
      try {
        const path = tldrawPath(params.path)
        const operation = String(params.operation ?? "")
        const allowedTopLevel = operation === "edit" ? ["operation", "path", "actions"] : ["operation", "path"]
        if (!exactKeys(params, allowedTopLevel)) throw new Error(`${operation} received unsupported fields`)
        if (operation === "create") {
          if (!workspace.createBinaryFile) return result("Workspace does not support exclusive file creation.", undefined, true)
          const parent = posix.dirname(path)
          if (parent !== ".") await workspace.mkdir(parent, { recursive: true })
          await workspace.createBinaryFile(path, new TextEncoder().encode(blankFile()))
          await bridge?.postCommand({ kind: "openFile", params: { path, filesystem: USER_FILESYSTEM } })
          return result(`Created native tldraw file ${path} and requested its workspace tab.`, { path, filesystem: USER_FILESYSTEM })
        }
        if (operation === "read") {
          const json = await workspace.readFile(path)
          return result(`Canvas ${path}: ${nativeShapeSummary(json)}`, { path, filesystem: USER_FILESYSTEM })
        }
        if (operation !== "edit") return result(`Unsupported operation: ${operation}`, undefined, true)
        const actions = validateActions(params.actions)
        const id = randomUUID()
        const batch: PendingCanvasBatch = { id, path, filesystem: USER_FILESYSTEM, actions }
        return await new Promise<ToolResult>((resolveTool) => {
          const finish = (value: ToolResult) => { ctx.abortSignal?.removeEventListener("abort", abort); resolveTool(value) }
          const cancel = (message: string) => {
            const entry = batches.get(id)
            if (!entry || entry.state === "committing" || entry.state === "committed") return
            if (entry.timer) clearTimeout(entry.timer)
            entry.state = "cancelled"
            entry.outcome = { statusCode: 409, body: { written: false, error: { message } } }
            finish(result(message, { path }, true))
            setTimeout(() => batches.delete(id), 60_000).unref?.()
          }
          const abort = () => cancel("Canvas edit cancelled.")
          const timer = setTimeout(() => cancel(`The ${path} tab did not claim the batch before expiry.`), 15_000)
          batches.set(id, { batch, state: "pending", resolve: finish, timer })
          ctx.abortSignal?.addEventListener("abort", abort, { once: true })
          // addEventListener does not replay an abort that happened before
          // registration; close that race before returning control.
          if (ctx.abortSignal?.aborted) abort()
        })
      } catch (error) { return result(error instanceof Error ? error.message : String(error), undefined, true) }
    },
  }
}

function contentHash(content: string): string { return createHash("sha256").update(content).digest("hex") }
function revision(stat: Stat, content: string): FileRevision { return { size: stat.size, mtimeMs: stat.mtimeMs, sha256: contentHash(content) } }
function revisionsMatch(actual: FileRevision, expected: FileRevision): boolean {
  return actual.size === expected.size && actual.mtimeMs === expected.mtimeMs && actual.sha256 === expected.sha256
}
function resourceKey(filesystem: string, path: string) { return `${filesystem}:${path}` }

export function createTldrawAgentServerPlugin(options: { workspace: Workspace; bridge?: UiBridge }): WorkspaceServerPlugin {
  const batches = new Map<string, BatchEntry>()
  const commitRequests = new Map<string, CommitRequest>()
  const owners = new Map<string, { clientId: string; seenAt: number }>()
  const resourceWrites = new Map<string, Promise<void>>()
  const withResourceWriteLock = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const previous = resourceWrites.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    const queued = previous.then(() => current)
    resourceWrites.set(key, queued)
    await previous
    try { return await fn() } finally {
      release()
      if (resourceWrites.get(key) === queued) resourceWrites.delete(key)
    }
  }
  const finishBatch = (entry: BatchEntry, state: "committed" | "failed", statusCode: number, body: unknown, tool: ToolResult) => {
    if (entry.timer) clearTimeout(entry.timer)
    entry.state = state
    entry.outcome = { statusCode, body }
    entry.resolve(tool)
    setTimeout(() => batches.delete(entry.batch.id), 60_000).unref?.()
  }
  const routes: FastifyPluginAsync = async (app) => {
    app.get<{ Querystring: { path?: string; filesystem?: string } }>("/api/v1/plugins/tldraw-agent/file", async (request, reply) => {
      try {
        const filesystem = requireUserFilesystem(request.query.filesystem)
        const path = tldrawPath(request.query.path)
        if (!options.workspace.readFileWithStat) throw Object.assign(new Error("workspace does not support consistent revision reads"), { statusCode: 501 })
        const loaded = await options.workspace.readFileWithStat(path)
        parseNative(loaded.content)
        return { path, filesystem, json: loaded.content, revision: revision(loaded.stat, loaded.content) }
      } catch (error) {
        const statusCode = Number((error as { statusCode?: number }).statusCode) || 400
        return reply.code(statusCode).send({ error: { message: error instanceof Error ? error.message : String(error) } })
      }
    })
    app.post<{ Body: { path?: string; clientId?: string; filesystem?: string } }>("/api/v1/plugins/tldraw-agent/connect", async (request, reply) => {
      try {
        const filesystem = requireUserFilesystem(request.body?.filesystem)
        const path = tldrawPath(request.body?.path)
        const clientId = String(request.body?.clientId ?? "")
        if (!clientId) throw new Error("clientId is required")
        const key = resourceKey(filesystem, path)
        const current = owners.get(key)
        if (!current || current.clientId === clientId || Date.now() - current.seenAt > 5_000) owners.set(key, { clientId, seenAt: Date.now() })
        return { ok: owners.get(key)?.clientId === clientId }
      } catch (error) { return reply.code(400).send({ error: { message: error instanceof Error ? error.message : String(error) } }) }
    })
    app.get<{ Querystring: { path?: string; clientId?: string; filesystem?: string } }>("/api/v1/plugins/tldraw-agent/actions", async (request, reply) => {
      try {
        const filesystem = requireUserFilesystem(request.query.filesystem)
        const path = tldrawPath(request.query.path)
        const clientId = String(request.query.clientId ?? "")
        const owner = owners.get(resourceKey(filesystem, path))
        if (!owner || owner.clientId !== clientId || Date.now() - owner.seenAt > 5_000) return { batches: [] }
        owner.seenAt = Date.now()
        const claimed: PendingCanvasBatch[] = []
        for (const entry of batches.values()) {
          if (entry.batch.path !== path || entry.batch.filesystem !== filesystem) continue
          if (entry.state === "claimed" && entry.ownerClientId === clientId) {
            claimed.push(entry.batch)
            continue
          }
          if (entry.state !== "pending") continue
          if (entry.timer) clearTimeout(entry.timer)
          entry.ownerClientId = clientId
          entry.state = "claimed"
          entry.timer = setTimeout(() => {
            if (entry.state !== "claimed") return
            entry.state = "cancelled"
            entry.outcome = { statusCode: 409, body: { written: false, error: { message: "batch claim expired" } } }
            entry.resolve(result("Canvas edit claim expired before commit.", { path }, true))
            setTimeout(() => batches.delete(entry.batch.id), 60_000).unref?.()
          }, 15_000)
          claimed.push(entry.batch)
        }
        return { batches: claimed }
      } catch (error) { return reply.code(400).send({ error: { message: error instanceof Error ? error.message : String(error) } }) }
    })
    app.post<{ Body: { requestId?: string; batchId?: string; path?: string; filesystem?: string; clientId?: string; json?: string; expectedRevision?: { size?: number; mtimeMs?: number; sha256?: string } } }>("/api/v1/plugins/tldraw-agent/commit", async (request, reply) => {
      const { requestId = "", batchId, clientId = "", json, expectedRevision } = request.body ?? {}
      try {
        const filesystem = requireUserFilesystem(request.body?.filesystem)
        const path = tldrawPath(request.body?.path)
        if (!requestId) throw new Error("requestId is required")
        if (typeof json !== "string") throw new Error("json is required")
        parseNative(json)
        if (!expectedRevision || !isFiniteNumber(expectedRevision.size) || !isFiniteNumber(expectedRevision.mtimeMs) || typeof expectedRevision.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedRevision.sha256)) throw new Error("expectedRevision is required")
        const expected: FileRevision = { size: expectedRevision.size, mtimeMs: expectedRevision.mtimeMs, sha256: expectedRevision.sha256 }
        const fingerprint = JSON.stringify({ batchId: batchId ?? null, clientId, filesystem, path, json, expectedRevision })
        const replay = commitRequests.get(requestId)
        if (replay) {
          if (replay.fingerprint !== fingerprint) return reply.code(409).send({ written: false, error: { message: "commit requestId fingerprint mismatch" } })
          const outcome = await replay.promise
          return reply.code(outcome.statusCode).send(outcome.body)
        }
        const promise = (async (): Promise<CommitOutcome> => {
          const entry = batchId ? batches.get(batchId) : undefined
          let writeStarted = false
          try {
            const owner = owners.get(resourceKey(filesystem, path))
            if (!owner || owner.clientId !== clientId || Date.now() - owner.seenAt > 5_000) throw Object.assign(new Error("canvas owner lease is invalid"), { statusCode: 409 })
            if (batchId && (!entry || entry.state !== "claimed" || entry.batch.path !== path || entry.batch.filesystem !== filesystem || entry.ownerClientId !== clientId)) throw Object.assign(new Error("batch claim is invalid or expired"), { statusCode: 409 })
            if (entry) {
              if (entry.timer) clearTimeout(entry.timer)
              entry.state = "committing"
            }
            if (!options.workspace.readFileWithStat || !options.workspace.writeFileWithStat) throw Object.assign(new Error("workspace does not support optimistic revision writes"), { statusCode: 501 })
            const key = resourceKey(filesystem, path)
            const outcome = await withResourceWriteLock(key, async (): Promise<CommitOutcome> => {
              const current = await options.workspace.readFileWithStat!(path)
              const actual = revision(current.stat, current.content)
              if (!revisionsMatch(actual, expected)) {
                return { statusCode: 409, body: { written: false, error: { message: "file changed since it was loaded" }, currentRevision: actual } }
              }
              writeStarted = true
              await options.workspace.writeFileWithStat!(path, json)
              const verified = await options.workspace.readFileWithStat!(path)
              const verifiedRevision = revision(verified.stat, verified.content)
              if (verifiedRevision.sha256 !== contentHash(json)) {
                return { statusCode: 409, body: { written: true, error: { message: "file changed during optimistic save; reload required" }, currentRevision: verifiedRevision } }
              }
              return { statusCode: 200, body: { ok: true, written: true, revision: verifiedRevision } }
            })
            if (outcome.statusCode !== 200) throw Object.assign(new Error(((outcome.body as { error?: { message?: string } }).error?.message ?? "optimistic save failed")), { statusCode: outcome.statusCode, commitBody: outcome.body })
            const body = outcome.body as { ok: true; written: true; revision: FileRevision }
            if (entry) finishBatch(entry, "committed", 200, body, result(`Applied one action batch to ${path} and saved it.`, { path, filesystem, revision: body.revision }))
            return { statusCode: 200, body }
          } catch (error) {
            const statusCode = Number((error as { statusCode?: number }).statusCode) || 409
            const body = (error as { commitBody?: unknown }).commitBody ?? {
              written: writeStarted ? "unknown" : false,
              error: { message: error instanceof Error ? error.message : String(error) },
            }
            const message = (body as { error?: { message?: string } }).error?.message ?? "canvas commit failed"
            if (entry && entry.state === "committing") finishBatch(entry, "failed", statusCode, body, result(message, { path: entry.batch.path }, true))
            return { statusCode, body }
          }
        })()
        commitRequests.set(requestId, { fingerprint, promise })
        void promise.finally(() => { setTimeout(() => commitRequests.delete(requestId), 60_000).unref?.() })
        const outcome = await promise
        return reply.code(outcome.statusCode).send(outcome.body)
      } catch (error) {
        const statusCode = Number((error as { statusCode?: number }).statusCode) || 400
        return reply.code(statusCode).send({ written: false, error: { message: error instanceof Error ? error.message : String(error) } })
      }
    })
    app.addHook("onClose", async () => {
      for (const entry of batches.values()) {
        if (entry.timer) clearTimeout(entry.timer)
        if (entry.state !== "committed" && entry.state !== "failed") entry.resolve(result("Canvas server stopped.", undefined, true))
      }
      batches.clear(); commitRequests.clear(); owners.clear(); resourceWrites.clear()
    })
  }
  return defineServerPlugin({ id: TLDRAW_AGENT_PLUGIN_ID, label: "tldraw Canvas", routes, agentTools: [createCanvasTool(options.workspace, batches, options.bridge)], systemPrompt: "Use edit_tldraw_canvas for native .tldraw diagrams in the user filesystem." })
}

export default function defaultTldrawAgentServerPlugin(options: { workspace?: Workspace } | undefined, context: { bridge?: UiBridge }): WorkspaceServerPlugin {
  if (!options?.workspace) throw new Error("tldraw-agent requires an injected Workspace")
  return createTldrawAgentServerPlugin({ workspace: options.workspace, bridge: context.bridge })
}
