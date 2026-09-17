import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, resolve, sep } from "node:path"
import { randomUUID } from "node:crypto"
import type { FastifyPluginAsync } from "fastify"
import { createTLStore } from "tldraw"
import type { AgentTool, ToolResult } from "@hachej/boring-workspace"
import { defineServerPlugin, type UiBridge, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import { TLDRAW_AGENT_PLUGIN_ID, type CanvasAction, type PendingCanvasBatch } from "../shared"

interface PendingRequest {
  batch: PendingCanvasBatch
  resolve: (value: ToolResult) => void
  timer: ReturnType<typeof setTimeout>
}

function toolResult(text: string, details?: unknown, isError = false): ToolResult {
  return { content: [{ type: "text", text }], details, ...(isError ? { isError: true } : {}) }
}

function resolveWorkspacePath(root: string, target: string): string {
  const normalized = target.replace(/^\.?[\\/]+/, "")
  if (!normalized || isAbsolute(normalized) || !/\.(?:tldraw|tldr)$/i.test(normalized)) throw new Error("path must be a relative .tldraw or .tldr file")
  const absoluteRoot = resolve(root)
  const candidate = resolve(absoluteRoot, normalized)
  if (candidate !== absoluteRoot && !candidate.startsWith(absoluteRoot.endsWith(sep) ? absoluteRoot : `${absoluteRoot}${sep}`)) throw new Error("path escapes workspace")
  return candidate
}

function blankTldrawFile(): string {
  const store = createTLStore()
  const snapshot = store.getStoreSnapshot()
  return JSON.stringify({ tldrawFileFormatVersion: 1, schema: snapshot.schema, records: Object.values(snapshot.store) })
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, content, "utf8")
  await rename(temporary, path)
}

export function createCanvasTool(workspaceRoot: string, pending: Map<string, PendingRequest> = new Map(), bridge?: UiBridge): AgentTool {
  return {
    name: "edit_tldraw_canvas",
    description: "Create, read, or batch-edit a native .tldraw file. When its tab is open, the action batch is applied to the same live tldraw Editor used by the user and saved once.",
    promptSnippet: "Use edit_tldraw_canvas with a workspace-relative .tldraw path. Send all related edits in one actions batch. The target tab must be open for edits so user and agent share one live SDK Editor.",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["create", "read", "edit"] },
        path: { type: "string", description: "Workspace-relative .tldraw or .tldr path." },
        actions: {
          type: "array",
          maxItems: 100,
          description: "One SDK action batch. Actions: create, update, delete, clear, align, distribute.",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["create", "update", "delete", "clear", "align", "distribute"] },
              shape: {
                type: "object",
                description: "Single tldraw-style shape for create/update.",
                properties: {
                  id: { type: "string" }, type: { type: "string", enum: ["rectangle", "ellipse", "diamond", "text"] },
                  x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" },
                  text: { type: "string" }, color: { type: "string", enum: ["black", "blue", "green", "orange", "red", "violet"] },
                  fill: { type: "string", enum: ["none", "semi"] },
                },
                required: ["id", "type", "x", "y"], additionalProperties: false,
              },
              ids: { type: "array", items: { type: "string" } },
              axis: { type: "string", enum: ["x", "y"] },
              alignment: { type: "string", enum: ["start", "center", "end"] },
            },
            required: ["type"], additionalProperties: false,
          },
        },
      },
      required: ["operation", "path"],
      additionalProperties: false,
    },
    async execute(params) {
      try {
        const path = String(params.path ?? "")
        const absolute = resolveWorkspacePath(workspaceRoot, path)
        const operation = String(params.operation ?? "")
        if (operation === "create") {
          try { await stat(absolute); return toolResult(`File already exists: ${path}`, undefined, true) } catch { /* create */ }
          await atomicWrite(absolute, blankTldrawFile())
          await bridge?.postCommand({ kind: "openFile", params: { path } })
          return toolResult(`Created native tldraw file ${path} and requested its workspace tab.`, { path })
        }
        if (operation === "read") {
          const json = await readFile(absolute, "utf8")
          return toolResult(`Read ${path}.`, { path, json: JSON.parse(json) })
        }
        if (operation !== "edit") return toolResult(`Unsupported operation: ${operation}`, undefined, true)
        const actions = Array.isArray(params.actions) ? params.actions as CanvasAction[] : []
        if (!actions.length) return toolResult("actions are required for edit", undefined, true)
        const id = randomUUID()
        const batch: PendingCanvasBatch = { id, path, actions }
        return await new Promise<ToolResult>((resolveResult) => {
          const timer = setTimeout(() => {
            pending.delete(id)
            resolveResult(toolResult(`The ${path} tab is not connected. Open the file in the workspace, then retry the edit.`, { path }, true))
          }, 15_000)
          pending.set(id, { batch, resolve: resolveResult, timer })
        })
      } catch (error) {
        return toolResult(error instanceof Error ? error.message : String(error), undefined, true)
      }
    },
  }
}

export function createTldrawAgentServerPlugin(options: { workspaceRoot: string; bridge?: UiBridge }): WorkspaceServerPlugin {
  const pending = new Map<string, PendingRequest>()
  const owners = new Map<string, { clientId: string; seenAt: number }>()
  const routes: FastifyPluginAsync = async (app) => {
    app.get<{ Querystring: { path?: string } }>("/api/v1/plugins/tldraw-agent/file", async (request, reply) => {
      try {
        const path = String(request.query.path ?? "")
        const absolute = resolveWorkspacePath(options.workspaceRoot, path)
        const [json, fileStat] = await Promise.all([readFile(absolute, "utf8"), stat(absolute)])
        return { path, json, mtimeMs: fileStat.mtimeMs }
      } catch (error) {
        return reply.code((error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 400).send({ error: { message: error instanceof Error ? error.message : String(error) } })
      }
    })
    app.post<{ Body: { path?: string; clientId?: string } }>("/api/v1/plugins/tldraw-agent/connect", async (request) => {
      const path = String(request.body?.path ?? "")
      const clientId = String(request.body?.clientId ?? "")
      resolveWorkspacePath(options.workspaceRoot, path)
      if (!clientId) throw new Error("clientId is required")
      const current = owners.get(path)
      if (!current || current.clientId === clientId || Date.now() - current.seenAt > 5_000) {
        owners.set(path, { clientId, seenAt: Date.now() })
      }
      return { ok: owners.get(path)?.clientId === clientId }
    })
    app.get<{ Querystring: { path?: string; clientId?: string } }>("/api/v1/plugins/tldraw-agent/actions", async (request) => {
      const path = String(request.query.path ?? "")
      const clientId = String(request.query.clientId ?? "")
      const owner = owners.get(path)
      if (!owner || owner.clientId !== clientId || Date.now() - owner.seenAt > 5_000) return { batches: [] }
      owner.seenAt = Date.now()
      return { batches: [...pending.values()].map((entry) => entry.batch).filter((batch) => batch.path === path) }
    })
    app.post<{ Body: { id?: string; path?: string; json?: string; expectedMtimeMs?: number } }>("/api/v1/plugins/tldraw-agent/commit", async (request, reply) => {
      try {
        const { id, path = "", json, expectedMtimeMs } = request.body ?? {}
        if (typeof json !== "string") throw new Error("json is required")
        const absolute = resolveWorkspacePath(options.workspaceRoot, path)
        if (typeof expectedMtimeMs === "number") {
          const current = await stat(absolute)
          if (Math.abs(current.mtimeMs - expectedMtimeMs) > 0.5) return reply.code(409).send({ error: { message: "file changed since it was loaded" } })
        }
        JSON.parse(json)
        await atomicWrite(absolute, json)
        const fileStat = await stat(absolute)
        if (id) {
          const requestEntry = pending.get(id)
          if (requestEntry) {
            clearTimeout(requestEntry.timer)
            pending.delete(id)
            requestEntry.resolve(toolResult(`Applied one action batch to ${path} and saved the native tldraw file.`, { path, mtimeMs: fileStat.mtimeMs }))
          }
        }
        return { ok: true, mtimeMs: fileStat.mtimeMs }
      } catch (error) {
        return reply.code(400).send({ error: { message: error instanceof Error ? error.message : String(error) } })
      }
    })
    app.addHook("onClose", async () => {
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.resolve(toolResult("Canvas server stopped.", undefined, true)) }
      pending.clear()
      owners.clear()
    })
  }
  return defineServerPlugin({
    id: TLDRAW_AGENT_PLUGIN_ID,
    label: "tldraw Canvas",
    routes,
    agentTools: [createCanvasTool(options.workspaceRoot, pending, options.bridge)],
    systemPrompt: "Use edit_tldraw_canvas for native .tldraw diagrams. Create the file, open it through workspace.open.path, then send related edits in one batch. The open tab and agent share the same live tldraw SDK Editor; the batch is saved once after application.",
  })
}

export default function defaultTldrawAgentServerPlugin(_options: unknown, context: { workspaceRoot: string; bridge?: UiBridge }): WorkspaceServerPlugin {
  return createTldrawAgentServerPlugin({ workspaceRoot: context.workspaceRoot, bridge: context.bridge })
}
