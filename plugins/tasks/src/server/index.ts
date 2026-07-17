import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import type { WorkspaceAgentServerPluginContext } from "@hachej/boring-workspace/app/server"
import { TASKS_PLUGIN_ID, TASKS_PLUGIN_LABEL } from "../shared"
import { createGitHubTaskSource, createGhCliGitHubIssueExecutor, createWorkspaceGitHubTaskSource } from "./githubSource"
import { createTaskSourceRegistry, type BoringTaskSourceRegistry, type BoringTaskSourceRuntime } from "./sourceRuntime"
import { createTaskSourceService, TaskSourceServiceError } from "./taskSourceService"
import { FileTaskSessionLinkStore, TaskSessionLinkStoreError, type TaskSessionLinkWorkspace } from "./taskSessionLinkStore"

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

export type TaskSessionLinkTrustedContext = NonNullable<WorkspaceAgentServerPluginContext["trusted"]>
type TaskRoutesApp = Parameters<NonNullable<WorkspaceServerPlugin["routes"]>>[0]

export interface TasksServerPluginOptions {
  config?: unknown
  sources?: BoringTaskSourceRuntime[]
  workspaceRoot?: string
  trusted?: WorkspaceAgentServerPluginContext["trusted"]
}

class TaskSessionRouteError extends Error {
  constructor(readonly status: number, readonly code: "TASK_SESSION_INVALID_BODY" | "TASK_SESSION_FORBIDDEN", message: string) {
    super(message)
  }
}

function sessionResponseError(cause: unknown) {
  if (cause instanceof TaskSessionRouteError || cause instanceof TaskSessionLinkStoreError) {
    return { ok: false, code: cause.code, error: cause.message }
  }
  return { ok: false, code: "TASK_SESSION_LINK_STORE_ERROR", error: "Task session link request failed." }
}

function sessionStatus(cause: unknown): number {
  if (cause instanceof TaskSessionRouteError) return cause.status
  if (cause instanceof TaskSessionLinkStoreError) return cause.code === "TASK_SESSION_LINK_MISSING" ? 404 : 500
  return 500
}

function exactSessionBody(body: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new TaskSessionRouteError(400, "TASK_SESSION_INVALID_BODY", "request body must be an object")
  const value = body as Record<string, unknown>
  if (Object.keys(value).length !== keys.length || keys.some((key) => typeof value[key] !== "string" || (value[key] as string).trim().length === 0) || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new TaskSessionRouteError(400, "TASK_SESSION_INVALID_BODY", `request body must contain exactly ${keys.join(", ")}`)
  }
  return value
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

export function registerTaskSessionLinkRoutes(app: TaskRoutesApp, trusted: TaskSessionLinkTrustedContext | undefined): void {
  const stores = new WeakMap<object, FileTaskSessionLinkStore>()

  async function trustedStore(request: Parameters<TaskSessionLinkTrustedContext["actorResolver"]>[0]) {
    if (!trusted?.workspaceAgentDispatcherResolver.resolveWithWorkspace) {
      throw new TaskSessionRouteError(403, "TASK_SESSION_FORBIDDEN", "Task session links are unavailable.")
    }
    try {
      const actor = await trusted.actorResolver(request)
      const binding = await trusted.workspaceAgentDispatcherResolver.resolveWithWorkspace(actor, { request })
      const workspace = binding.workspace as TaskSessionLinkWorkspace & object
      let store = stores.get(workspace)
      if (!store) {
        store = new FileTaskSessionLinkStore(workspace)
        stores.set(workspace, store)
      }
      return { actor, store, resolver: trusted.workspaceAgentDispatcherResolver }
    } catch (cause) {
      request.log?.warn({ err: cause }, "task session link trusted workspace resolution failed")
      throw new TaskSessionRouteError(403, "TASK_SESSION_FORBIDDEN", "Task session link access is forbidden.")
    }
  }

  app.post("/api/boring-tasks/sessions/list", async (request, reply) => {
    try {
      const body = exactSessionBody(request.body, ["adapterId", "taskId"])
      const { store } = await trustedStore(request)
      return { ok: true, links: await store.list(body.adapterId as string, body.taskId as string) }
    } catch (cause) {
      return reply.status(sessionStatus(cause)).send(sessionResponseError(cause))
    }
  })

  app.post("/api/boring-tasks/sessions/link", async (request, reply) => {
    try {
      const body = exactSessionBody(request.body, ["adapterId", "taskId", "sessionId"])
      const { actor, store, resolver } = await trustedStore(request)
      if (!resolver.authorizeSession) throw new TaskSessionRouteError(403, "TASK_SESSION_FORBIDDEN", "Task session linking is unavailable.")
      try {
        await resolver.authorizeSession(actor, body.sessionId as string, { request })
      } catch {
        throw new TaskSessionRouteError(403, "TASK_SESSION_FORBIDDEN", "Task session link access is forbidden.")
      }
      return { ok: true, link: await store.link({ adapterId: body.adapterId as string, taskId: body.taskId as string, sessionId: body.sessionId as string }) }
    } catch (cause) {
      return reply.status(sessionStatus(cause)).send(sessionResponseError(cause))
    }
  })

  app.post("/api/boring-tasks/sessions/unlink", async (request, reply) => {
    try {
      const body = exactSessionBody(request.body, ["linkId"])
      const { store } = await trustedStore(request)
      return { ok: true, link: await store.unlink(body.linkId as string) }
    } catch (cause) {
      return reply.status(sessionStatus(cause)).send(sessionResponseError(cause))
    }
  })
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

      registerTaskSessionLinkRoutes(app, options.trusted)
    },
  })
}

export default function defaultTasksServerPlugin(options?: TasksServerPluginOptions, ctx?: WorkspaceAgentServerPluginContext): WorkspaceServerPlugin {
  return createTasksServerPlugin({
    ...options,
    workspaceRoot: options?.workspaceRoot ?? ctx?.workspaceRoot,
    trusted: options?.trusted ?? ctx?.trusted,
  })
}

export { createGitHubTaskSource, createWorkspaceGitHubTaskSource, createGhCliGitHubIssueExecutor, createGhCliGitHubRepositoryDetector } from "./githubSource"
export { createTaskSourceRegistry } from "./sourceRuntime"
export { createTaskSourceService, TaskSourceServiceError } from "./taskSourceService"
export { FileTaskSessionLinkStore, TaskSessionLinkStoreError } from "./taskSessionLinkStore"
