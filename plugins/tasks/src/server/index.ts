import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import { TASKS_PLUGIN_ID, TASKS_PLUGIN_LABEL } from "../shared"
import { createGitHubTaskSource, createGhCliGitHubIssueExecutor, createWorkspaceGitHubTaskSource } from "./githubSource"
import { createTaskSourceRegistry, type BoringTaskSourceRegistry, type BoringTaskSourceRuntime } from "./sourceRuntime"
import { createTaskSourceService, TaskSourceServiceError } from "./taskSourceService"

function workspaceIdFromRequest(request: { headers: Record<string, string | string[] | undefined>; query?: unknown }): string | undefined {
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
  config?: unknown
  sources?: BoringTaskSourceRuntime[]
  workspaceRoot?: string
}

interface TaskProviderConfig {
  provider?: unknown
  repo?: unknown
}

function taskProvidersFromConfig(config: unknown): TaskProviderConfig[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return []
  const providers = (config as { providers?: unknown }).providers
  return Array.isArray(providers)
    ? providers.filter((provider): provider is TaskProviderConfig => Boolean(provider) && typeof provider === "object" && !Array.isArray(provider))
    : []
}

export function createTaskSourceRegistryFromConfig(config: unknown, options: { workspaceRoot?: string } = {}): BoringTaskSourceRegistry {
  const sources = taskProvidersFromConfig(config).flatMap((provider, index): BoringTaskSourceRuntime[] => {
    if (provider.provider !== "github") return []
    const repo = typeof provider.repo === "string" ? provider.repo.trim() : ""
    if (repo && repo !== "auto") {
      const [owner, name] = repo.split("/")
      if (!owner || !name) return []
      return [createGitHubTaskSource({
        owner,
        repo: name,
        executor: createGhCliGitHubIssueExecutor({ workspaceRoot: options.workspaceRoot }),
      })]
    }
    return [createWorkspaceGitHubTaskSource({
      workspaceRoot: options.workspaceRoot,
      sourceId: index === 0 ? "github:workspace" : `github:workspace:${index + 1}`,
    })]
  })
  return createTaskSourceRegistry(sources)
}

export function createTasksServerPlugin(options: TasksServerPluginOptions = {}): WorkspaceServerPlugin {
  const registry = options.sources
    ? createTaskSourceRegistry(options.sources)
    : createTaskSourceRegistryFromConfig(options.config, { workspaceRoot: options.workspaceRoot })
  const service = createTaskSourceService(registry)

  return defineServerPlugin({
    id: TASKS_PLUGIN_ID,
    label: TASKS_PLUGIN_LABEL,
    routes: async (app) => {
      app.get("/api/boring-tasks/sources", async () => ({ ok: true, sources: service.listSources() }))

      app.post("/api/boring-tasks/sources/tasks/list", async (request, reply) => {
        try {
          const body = request.body === undefined ? {} : bodyObject(request.body)
          return { ok: true, ...(await service.listTasks({ workspaceId: workspaceIdFromRequest(request), workspaceRoot: options.workspaceRoot }, { sourceIds: stringArray(body.sourceIds) })) }
        } catch (cause) {
          return reply.status(statusFor(cause)).send(responseError(cause))
        }
      })

      app.post("/api/boring-tasks/sources/tasks/move", async (request, reply) => {
        try {
          const body = bodyObject(request.body)
          const task = await service.moveTask({ workspaceId: workspaceIdFromRequest(request), workspaceRoot: options.workspaceRoot }, {
            sourceId: requiredString(body, "sourceId"),
            taskId: requiredString(body, "taskId"),
            statusId: requiredString(body, "statusId"),
          })
          return { ok: true, task }
        } catch (cause) {
          return reply.status(statusFor(cause)).send(responseError(cause))
        }
      })

      app.post("/api/boring-tasks/sources/tasks/delete", async (request, reply) => {
        try {
          const body = bodyObject(request.body)
          await service.deleteTask({ workspaceId: workspaceIdFromRequest(request), workspaceRoot: options.workspaceRoot }, {
            sourceId: requiredString(body, "sourceId"),
            taskId: requiredString(body, "taskId"),
          })
          return { ok: true }
        } catch (cause) {
          return reply.status(statusFor(cause)).send(responseError(cause))
        }
      })
    },
  })
}

export default function defaultTasksServerPlugin(options?: TasksServerPluginOptions, ctx?: { workspaceRoot?: string }): WorkspaceServerPlugin {
  return createTasksServerPlugin({ ...options, workspaceRoot: options?.workspaceRoot ?? ctx?.workspaceRoot })
}

export { createGitHubTaskSource, createWorkspaceGitHubTaskSource, createGhCliGitHubIssueExecutor, createGhCliGitHubRepositoryDetector } from "./githubSource"
export { createTaskSourceRegistry } from "./sourceRuntime"
export { createTaskSourceService, TaskSourceServiceError } from "./taskSourceService"
