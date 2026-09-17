import { randomUUID } from "node:crypto"
import type { FastifyPluginAsync } from "fastify"
import { createTLStore, parseTldrawJsonFile } from "tldraw"
import type { Workspace } from "@hachej/boring-agent/shared"
import type { AgentTool, ToolResult } from "@hachej/boring-workspace"
import { defineServerPlugin, type UiBridge, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import { TLDRAW_AGENT_PLUGIN_ID, type CanvasAction, type PendingCanvasBatch } from "../shared"

interface PendingRequest {
  batch: PendingCanvasBatch
  resolve: (value: ToolResult) => void
  timer: ReturnType<typeof setTimeout>
  ownerClientId?: string
  expired: boolean
}

function result(text: string, details?: unknown, isError = false): ToolResult {
  return { content: [{ type: "text", text }], details, ...(isError ? { isError: true } : {}) }
}

export function canonicalPath(target: string): string {
  const path = target.replaceAll("\\", "/").replace(/^\.\//, "")
  if (!path || path.startsWith("/") || path.split("/").some((part) => part === "..") || !/\.(?:tldraw|tldr)$/i.test(path)) {
    throw new Error("path must be a contained relative .tldraw or .tldr file")
  }
  return path.split("/").filter((part) => part && part !== ".").join("/")
}

function parseNative(json: string) {
  const schema = createTLStore().schema
  const parsed = parseTldrawJsonFile({ json, schema })
  if (!parsed.ok) throw new Error(`invalid native tldraw file: ${parsed.error.type}`)
  return parsed.value
}

function blankFile(): string {
  const snapshot = createTLStore().getStoreSnapshot()
  return JSON.stringify({ tldrawFileFormatVersion: 1, schema: snapshot.schema, records: [] })
}

export function validateActions(value: unknown): CanvasAction[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) throw new Error("edit requires 1-100 actions")
  for (const action of value as CanvasAction[]) {
    if (!action || typeof action !== "object") throw new Error("each action must be an object")
    if ((action.type === "create" || action.type === "update") && !action.shape) throw new Error(`${action.type} requires shape`)
    if ((action.type === "delete" || action.type === "align" || action.type === "distribute") && (!action.ids?.length)) throw new Error(`${action.type} requires non-empty ids`)
    if ((action.type === "align" || action.type === "distribute") && !action.axis) throw new Error(`${action.type} requires axis`)
    if (action.type === "align" && !action.alignment) throw new Error("align requires alignment")
    if (!["create", "update", "delete", "clear", "align", "distribute"].includes(action.type)) throw new Error(`unsupported action: ${String(action.type)}`)
  }
  return value as CanvasAction[]
}

function shapeSummary(json: string): string {
  const file = JSON.parse(json) as { records?: Array<{ id?: string; typeName?: string; type?: string; x?: number; y?: number }> }
  const shapes = (file.records ?? []).filter((record) => record.typeName === "shape").slice(0, 100)
  return JSON.stringify(shapes.map(({ id, type, x, y }) => ({ id, type, x, y })))
}

export function createCanvasTool(workspace: Workspace, pending: Map<string, PendingRequest> = new Map(), bridge?: UiBridge): AgentTool {
  return {
    name: "edit_tldraw_canvas",
    description: "Create, inspect, or batch-edit a native .tldraw file through its live workspace tab.",
    promptSnippet: "Use one edit action batch per requested canvas change. Only the user filesystem is supported.",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["create", "read", "edit"] },
        path: { type: "string" },
        actions: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: true } },
      },
      required: ["operation", "path"], additionalProperties: false,
    },
    async execute(params, ctx) {
      try {
        const path = canonicalPath(String(params.path ?? ""))
        const operation = String(params.operation ?? "")
        if (operation === "create") {
          if (!workspace.createBinaryFile) return result("Workspace does not support exclusive file creation.", undefined, true)
          await workspace.createBinaryFile(path, new TextEncoder().encode(blankFile()))
          await bridge?.postCommand({ kind: "openFile", params: { path } })
          return result(`Created native tldraw file ${path} and requested its workspace tab.`, { path })
        }
        if (operation === "read") {
          const json = await workspace.readFile(path)
          parseNative(json)
          return result(`Canvas ${path} shapes: ${shapeSummary(json)}`, { path })
        }
        if (operation !== "edit") return result(`Unsupported operation: ${operation}`, undefined, true)
        const actions = validateActions(params.actions)
        const id = randomUUID()
        const batch: PendingCanvasBatch = { id, path, actions }
        return await new Promise<ToolResult>((resolveTool) => {
          const finish = (value: ToolResult) => { ctx.abortSignal?.removeEventListener("abort", abort); resolveTool(value) }
          const abort = () => { const entry = pending.get(id); if (entry) entry.expired = true; pending.delete(id); finish(result("Canvas edit cancelled.", { path }, true)) }
          const timer = setTimeout(() => { const entry = pending.get(id); if (entry) entry.expired = true; pending.delete(id); finish(result(`The ${path} tab did not commit before expiry.`, { path }, true)) }, 15_000)
          pending.set(id, { batch, resolve: finish, timer, expired: false })
          ctx.abortSignal?.addEventListener("abort", abort, { once: true })
        })
      } catch (error) { return result(error instanceof Error ? error.message : String(error), undefined, true) }
    },
  }
}

export function createTldrawAgentServerPlugin(options: { workspace: Workspace; bridge?: UiBridge }): WorkspaceServerPlugin {
  const pending = new Map<string, PendingRequest>()
  const owners = new Map<string, { clientId: string; seenAt: number }>()
  const locks = new Map<string, Promise<void>>()
  const withLock = async <T>(path: string, fn: () => Promise<T>): Promise<T> => {
    const previous = locks.get(path) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    const queued = previous.then(() => current)
    locks.set(path, queued)
    await previous
    try { return await fn() } finally { release(); if (locks.get(path) === queued) locks.delete(path) }
  }
  const routes: FastifyPluginAsync = async (app) => {
    app.get<{ Querystring: { path?: string; filesystem?: string } }>("/api/v1/plugins/tldraw-agent/file", async (request, reply) => {
      try {
        if (request.query.filesystem && request.query.filesystem !== "user") return reply.code(400).send({ error: { message: "only the user filesystem is supported" } })
        const path = canonicalPath(String(request.query.path ?? ""))
        const loaded = options.workspace.readFileWithStat ? await options.workspace.readFileWithStat(path) : { content: await options.workspace.readFile(path), stat: await options.workspace.stat(path) }
        parseNative(loaded.content)
        return { path, json: loaded.content, revision: loaded.stat.mtimeMs }
      } catch (error) { return reply.code(400).send({ error: { message: error instanceof Error ? error.message : String(error) } }) }
    })
    app.post<{ Body: { path?: string; clientId?: string; filesystem?: string } }>("/api/v1/plugins/tldraw-agent/connect", async (request, reply) => {
      if (request.body?.filesystem && request.body.filesystem !== "user") return reply.code(400).send({ error: { message: "only the user filesystem is supported" } })
      const path = canonicalPath(String(request.body?.path ?? "")); const clientId = String(request.body?.clientId ?? "")
      if (!clientId) return reply.code(400).send({ error: { message: "clientId is required" } })
      const current = owners.get(path)
      if (!current || current.clientId === clientId || Date.now() - current.seenAt > 5_000) owners.set(path, { clientId, seenAt: Date.now() })
      return { ok: owners.get(path)?.clientId === clientId }
    })
    app.get<{ Querystring: { path?: string; clientId?: string } }>("/api/v1/plugins/tldraw-agent/actions", async (request) => {
      const path = canonicalPath(String(request.query.path ?? "")); const clientId = String(request.query.clientId ?? ""); const owner = owners.get(path)
      if (!owner || owner.clientId !== clientId || Date.now() - owner.seenAt > 5_000) return { batches: [] }
      owner.seenAt = Date.now()
      const batches = [...pending.values()].filter((entry) => !entry.expired && entry.batch.path === path && (!entry.ownerClientId || entry.ownerClientId === clientId))
      for (const entry of batches) entry.ownerClientId = clientId
      return { batches: batches.map((entry) => entry.batch) }
    })
    app.post<{ Body: { id?: string; path?: string; clientId?: string; json?: string; expectedRevision?: number } }>("/api/v1/plugins/tldraw-agent/commit", async (request, reply) => {
      try {
        const { id, path: rawPath = "", clientId = "", json, expectedRevision } = request.body ?? {}; const path = canonicalPath(rawPath)
        if (typeof json !== "string") throw new Error("json is required")
        parseNative(json)
        const owner = owners.get(path)
        if (!owner || owner.clientId !== clientId || Date.now() - owner.seenAt > 5_000) return reply.code(409).send({ error: { message: "canvas owner lease is invalid" } })
        const entry = id ? pending.get(id) : undefined
        if (id && (!entry || entry.expired || entry.batch.path !== path || entry.ownerClientId !== clientId)) return reply.code(409).send({ error: { message: "batch claim is invalid or expired" } })
        const stat = await withLock(path, async () => {
          const current = await options.workspace.stat(path)
          if (typeof expectedRevision !== "number" || current.mtimeMs !== expectedRevision) throw new Error("file revision conflict")
          return options.workspace.writeFileWithStat ? options.workspace.writeFileWithStat(path, json) : (await options.workspace.writeFile(path, json), await options.workspace.stat(path))
        })
        if (entry && id) { clearTimeout(entry.timer); pending.delete(id); entry.resolve(result(`Applied one action batch to ${path} and saved it.`, { path, revision: stat.mtimeMs })) }
        return { ok: true, revision: stat.mtimeMs }
      } catch (error) { return reply.code(409).send({ error: { message: error instanceof Error ? error.message : String(error) } }) }
    })
    app.addHook("onClose", async () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.resolve(result("Canvas server stopped.", undefined, true)) }; pending.clear(); owners.clear() })
  }
  return defineServerPlugin({ id: TLDRAW_AGENT_PLUGIN_ID, label: "tldraw Canvas", routes, agentTools: [createCanvasTool(options.workspace, pending, options.bridge)], systemPrompt: "Use edit_tldraw_canvas for native .tldraw diagrams in the user filesystem." })
}

export default function defaultTldrawAgentServerPlugin(options: { workspace?: Workspace } | undefined, context: { bridge?: UiBridge }): WorkspaceServerPlugin {
  if (!options?.workspace) throw new Error("tldraw-agent requires an injected Workspace")
  return createTldrawAgentServerPlugin({ workspace: options.workspace, bridge: context.bridge })
}
