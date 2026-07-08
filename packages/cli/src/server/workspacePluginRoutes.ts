import type { FastifyInstance } from "fastify"
import { isAbsolute } from "node:path"
import type { LocalWorkspace, LocalWorkspaceRegistry } from "./localWorkspaces.js"

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return undefined
  return value.find((item): item is string => typeof item === "string")
}

function httpError(message: string, statusCode = 400): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number }
  error.statusCode = statusCode
  return error
}

function resolveWorkspaceIdFromRequest(request: { headers?: Record<string, unknown>; query?: unknown }): string {
  const headers = request.headers ?? {}
  const headerValue = headers["x-boring-workspace-id"]
    ?? Object.entries(headers).find(([key]) => key.toLowerCase() === "x-boring-workspace-id")?.[1]
  const query = request.query as Record<string, unknown> | undefined
  const raw = firstString(headerValue) ?? firstString(query?.workspaceId) ?? ""
  const workspaceId = raw.trim()
  if (!workspaceId) throw httpError("workspace id is required", 400)
  if (
    workspaceId.includes("\0")
    || workspaceId.includes("/")
    || workspaceId.includes("\\")
    || workspaceId.includes("..")
    || isAbsolute(workspaceId)
  ) {
    throw httpError("invalid workspace id", 400)
  }
  return workspaceId
}

async function requireWorkspace(registry: LocalWorkspaceRegistry, workspaceId: string): Promise<LocalWorkspace> {
  const workspace = await registry.get(workspaceId)
  if (!workspace) throw httpError("unknown workspace", 404)
  if (!workspace.available) throw httpError("workspace folder unavailable", 409)
  return workspace
}

function taskResponseError(cause: unknown) {
  if (cause instanceof Error && "status" in cause && "code" in cause) {
    return { ok: false, code: (cause as { code: unknown }).code, error: cause.message }
  }
  return { ok: false, code: "TASK_SOURCE_ERROR", error: "Task source request failed." }
}

function taskStatusFor(cause: unknown): number {
  const status = (cause as { status?: unknown })?.status ?? (cause as { statusCode?: unknown })?.statusCode
  return typeof status === "number" ? status : 500
}

function taskBodyObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    const error = new Error("request body must be an object") as Error & { status: number; code: string }
    error.status = 400
    error.code = "TASK_INVALID_BODY"
    throw error
  }
  return body as Record<string, unknown>
}

function taskStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    const error = new Error("sourceIds must be an array of non-empty strings") as Error & { status: number; code: string }
    error.status = 400
    error.code = "TASK_INVALID_BODY"
    throw error
  }
  return value
}

function taskRequiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== "string" || value.length === 0) {
    const error = new Error(`${key} must be a non-empty string`) as Error & { status: number; code: string }
    error.status = 400
    error.code = "TASK_INVALID_BODY"
    throw error
  }
  return value
}

function isPluginConfig(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

async function createWorkspaceTaskService(workspace: LocalWorkspace) {
  const tasks = await import("@hachej/boring-tasks/server")
  const registry = tasks.createTaskSourceRegistryFromConfig(workspace.plugins?.tasks, { workspaceRoot: workspace.path })
  return tasks.createTaskSourceService(registry)
}

export async function registerWorkspacePluginConfigRoutes(app: FastifyInstance, registry: LocalWorkspaceRegistry): Promise<void> {
  app.get("/api/v1/local-workspaces/:id/plugin-config/:pluginId", async (request, reply) => {
    const { id, pluginId } = request.params as { id: string; pluginId: string }
    if (!/^[a-zA-Z0-9_-]+$/.test(pluginId)) return reply.code(400).send({ error: "invalid plugin id" })
    const workspace = await registry.get(id)
    if (!workspace) return reply.code(404).send({ error: "workspace not found" })
    return { config: workspace.plugins?.[pluginId] ?? null }
  })

  app.put("/api/v1/local-workspaces/:id/plugin-config/:pluginId", async (request, reply) => {
    const { id, pluginId } = request.params as { id: string; pluginId: string }
    if (!/^[a-zA-Z0-9_-]+$/.test(pluginId)) return reply.code(400).send({ error: "invalid plugin id" })
    const body = request.body as { config?: unknown } | null | undefined
    const config = body?.config
    if (config !== null && !isPluginConfig(config)) {
      return reply.code(400).send({ error: "plugin config must be an object or null" })
    }
    try {
      const workspace = await registry.setPluginConfig(id, pluginId, config)
      return { workspace }
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : "workspace not found" })
    }
  })
}

export async function registerWorkspaceTaskRoutes(app: FastifyInstance, registry: LocalWorkspaceRegistry): Promise<void> {
  const workspaceFromRequest = async (request: { headers?: Record<string, unknown>; query?: unknown }) => {
    return await requireWorkspace(registry, resolveWorkspaceIdFromRequest(request))
  }

  app.get("/api/boring-tasks/sources", async (request, reply) => {
    try {
      const workspace = await workspaceFromRequest(request)
      const service = await createWorkspaceTaskService(workspace)
      return { ok: true, sources: service.listSources() }
    } catch (cause) {
      return reply.status(taskStatusFor(cause)).send(taskResponseError(cause))
    }
  })

  app.post("/api/boring-tasks/sources/tasks/list", async (request, reply) => {
    try {
      const workspace = await workspaceFromRequest(request)
      const body = request.body === undefined ? {} : taskBodyObject(request.body)
      const service = await createWorkspaceTaskService(workspace)
      return { ok: true, ...(await service.listTasks({ workspaceId: workspace.id, workspaceRoot: workspace.path }, { sourceIds: taskStringArray(body.sourceIds) })) }
    } catch (cause) {
      return reply.status(taskStatusFor(cause)).send(taskResponseError(cause))
    }
  })

  app.post("/api/boring-tasks/sources/tasks/move", async (request, reply) => {
    try {
      const workspace = await workspaceFromRequest(request)
      const body = taskBodyObject(request.body)
      const service = await createWorkspaceTaskService(workspace)
      const task = await service.moveTask({ workspaceId: workspace.id, workspaceRoot: workspace.path }, {
        sourceId: taskRequiredString(body, "sourceId"),
        taskId: taskRequiredString(body, "taskId"),
        statusId: taskRequiredString(body, "statusId"),
      })
      return { ok: true, task }
    } catch (cause) {
      return reply.status(taskStatusFor(cause)).send(taskResponseError(cause))
    }
  })
}
