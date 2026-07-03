import { defineRuntimeServerPlugin, type RuntimePluginContext } from "@hachej/boring-workspace/server"
import { createGitHubTaskSource } from "./githubSource"
import { createTaskSourceRegistry } from "./sourceRuntime"
import { createTaskSourceService, TaskSourceServiceError } from "./taskSourceService"

function workspaceIdFromContext(ctx: RuntimePluginContext): string | undefined {
  return ctx.headers.get("x-boring-workspace-id") ?? ctx.query.get("workspaceId") ?? undefined
}

function responseError(cause: unknown) {
  if (cause instanceof TaskSourceServiceError) {
    return { kind: "response" as const, status: cause.status, body: { ok: false, code: cause.code, error: cause.message } }
  }
  return { kind: "response" as const, status: 500, body: { ok: false, code: "TASK_SOURCE_ERROR", error: "Task source request failed." } }
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

const registry = createTaskSourceRegistry([
  createGitHubTaskSource({ owner: "hachej", repo: "boring-ui" }),
])
const service = createTaskSourceService(registry)

export default defineRuntimeServerPlugin({
  routes: async (router) => {
    router.get("/api/boring-tasks/sources", () => ({ ok: true, sources: service.listSources() }))

    router.post("/api/boring-tasks/sources/tasks/list", async (ctx) => {
      try {
        const body = ctx.body === undefined ? {} : bodyObject(ctx.body)
        return { ok: true, ...(await service.listTasks({ workspaceId: workspaceIdFromContext(ctx) }, { sourceIds: stringArray(body.sourceIds) })) }
      } catch (cause) {
        return responseError(cause)
      }
    })

    router.post("/api/boring-tasks/sources/tasks/move", async (ctx) => {
      try {
        const body = bodyObject(ctx.body)
        const task = await service.moveTask({ workspaceId: workspaceIdFromContext(ctx) }, {
          sourceId: requiredString(body, "sourceId"),
          taskId: requiredString(body, "taskId"),
          statusId: requiredString(body, "statusId"),
        })
        return { ok: true, task }
      } catch (cause) {
        return responseError(cause)
      }
    })
  },
})

export { createGitHubTaskSource, createGhCliGitHubIssueExecutor } from "./githubSource"
export { createTaskSourceRegistry } from "./sourceRuntime"
export { createTaskSourceService, TaskSourceServiceError } from "./taskSourceService"
