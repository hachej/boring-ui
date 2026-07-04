import type { FastifyRequest } from "fastify"
import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import { TASKS_PLUGIN_ID, TASKS_PLUGIN_LABEL } from "../shared"
import { createGitHubTaskSource } from "./githubSource"
import { createTaskSourceRegistry } from "./sourceRuntime"
import { createTaskSourceService, TaskSourceServiceError } from "./taskSourceService"

function workspaceIdFromRequest(request: FastifyRequest): string | undefined {
  const header = request.headers["x-boring-workspace-id"]
  if (typeof header === "string" && header.length > 0) return header
  const query = request.query as { workspaceId?: unknown } | undefined
  return typeof query?.workspaceId === "string" && query.workspaceId.length > 0 ? query.workspaceId : undefined
}

function responseError(cause: unknown) {
  if (cause instanceof TaskSourceServiceError) {
    return { ok: false, code: cause.code, error: cause.message }
  }
  return { ok: false, code: "TASK_SOURCE_ERROR", error: "Task source request failed." }
}

function statusFor(cause: unknown): number {
  return cause instanceof TaskSourceServiceError ? cause.status : 500
}

function stringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    throw new TaskSourceServiceError(400, "TASK_INVALID_BODY", "sourceIds must be an array of non-empty strings")
  }
  return value
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== "string" || value.length === 0) {
    throw new TaskSourceServiceError(400, "TASK_INVALID_BODY", `${key} must be a non-empty string`)
  }
  return value
}

function bodyObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new TaskSourceServiceError(400, "TASK_INVALID_BODY", "request body must be an object")
  }
  return body as Record<string, unknown>
}

export interface TasksServerPluginOptions {
  sources?: ReturnType<typeof createGitHubTaskSource>[]
}

export function createTasksServerPlugin(options: TasksServerPluginOptions = {}): WorkspaceServerPlugin {
  const registry = createTaskSourceRegistry(options.sources ?? [
    createGitHubTaskSource({ owner: "hachej", repo: "boring-ui" }),
  ])
  const service = createTaskSourceService(registry)

  return defineServerPlugin({
    id: TASKS_PLUGIN_ID,
    label: TASKS_PLUGIN_LABEL,
    routes: async (app) => {
      app.get("/api/boring-tasks/sources", async () => ({ ok: true, sources: service.listSources() }))

      app.post("/api/boring-tasks/sources/tasks/list", async (request, reply) => {
        try {
          const body = request.body === undefined ? {} : bodyObject(request.body)
          return { ok: true, ...(await service.listTasks({ workspaceId: workspaceIdFromRequest(request) }, { sourceIds: stringArray(body.sourceIds) })) }
        } catch (cause) {
          return reply.status(statusFor(cause)).send(responseError(cause))
        }
      })

      app.post("/api/boring-tasks/sources/tasks/move", async (request, reply) => {
        try {
          const body = bodyObject(request.body)
          const task = await service.moveTask({ workspaceId: workspaceIdFromRequest(request) }, {
            sourceId: requiredString(body, "sourceId"),
            taskId: requiredString(body, "taskId"),
            statusId: requiredString(body, "statusId"),
          })
          return { ok: true, task }
        } catch (cause) {
          return reply.status(statusFor(cause)).send(responseError(cause))
        }
      })
    },
  })
}

export default function defaultTasksServerPlugin(options?: TasksServerPluginOptions): WorkspaceServerPlugin {
  return createTasksServerPlugin(options)
}

export { createGitHubTaskSource, createGhCliGitHubIssueExecutor } from "./githubSource"
export { createTaskSourceRegistry } from "./sourceRuntime"
export { createTaskSourceService, TaskSourceServiceError } from "./taskSourceService"
