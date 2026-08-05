import { TASK_ERROR_CODES, TASKS_PLUGIN_ID, TASKS_PLUGIN_LABEL } from "../shared"
import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import type { WorkspaceAgentServerPluginContext } from "@hachej/boring-workspace/app/server"
import type { BeadsOperations } from "./beadsOperations"
import { createTaskSourceRegistryFromConfig } from "./sourceConfig"
import { createTaskSourceRegistry, type BoringTaskSourceContext, type BoringTaskSourceRuntime } from "./sourceRuntime"
import { createTaskSourceService, TaskSourceServiceError } from "./taskSourceService"
import { createTrustedTaskToolBindingResolver } from "./taskToolBinding"
import { createManageTasksTool } from "./manageTasksTool"
import { registerTaskSessionLinkRoutes } from "./taskSessionRoutes"
import { TaskSessionLinkEvents } from "./taskSessionLinkEvents"

function workspaceIdFromRequest(request: { headers: Record<string, string | string[] | undefined>; query?: unknown }): string | undefined {
  const header = request.headers["x-boring-workspace-id"]
  if (typeof header === "string" && header.length > 0) return header
  const query = request.query as { workspaceId?: unknown } | undefined
  return typeof query?.workspaceId === "string" && query.workspaceId.length > 0 ? query.workspaceId : undefined
}

function responseError(cause: unknown) {
  if (cause instanceof TaskSourceServiceError) {
    return { ok: false, code: cause.code, error: cause.message, message: cause.message, retryable: cause.retryable }
  }
  return { ok: false, code: TASK_ERROR_CODES.SOURCE_ERROR, error: "Task source request failed.", message: "Task source request failed.", retryable: true }
}

function statusFor(cause: unknown): number {
  return cause instanceof TaskSourceServiceError ? cause.status : 500
}

function stringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    throw new TaskSourceServiceError(400, TASK_ERROR_CODES.INVALID_BODY, "sourceIds must be an array of non-empty strings")
  }
  return value
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== "string" || value.length === 0) {
    throw new TaskSourceServiceError(400, TASK_ERROR_CODES.INVALID_BODY, `${key} must be a non-empty string`)
  }
  return value
}

function bodyObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new TaskSourceServiceError(400, TASK_ERROR_CODES.INVALID_BODY, "request body must be an object")
  }
  return body as Record<string, unknown>
}

export interface TasksServerPluginOptions {
  config?: unknown
  sources?: BoringTaskSourceRuntime[]
  workspaceRoot?: string
  trusted?: WorkspaceAgentServerPluginContext["trusted"]
  agentTypeId?: string
  /** Required by hosts that inject this as a prebuilt plugin instead of a resolved package artifact. */
  contentDigest?: string
  /** Trusted Workspace-bound read capability. Request/config data cannot supply it. */
  beadsOperations?: BeadsOperations
}

export function createTasksServerPlugin(options: TasksServerPluginOptions = {}): WorkspaceServerPlugin {
  const agentTypeId = options.agentTypeId?.trim()
  if (!agentTypeId) throw new Error("boring tasks requires a host-selected agentTypeId")
  const registry = options.sources
    ? createTaskSourceRegistry(options.sources)
    : createTaskSourceRegistryFromConfig(options.config, {
        workspaceRoot: options.workspaceRoot,
        beadsOperations: options.beadsOperations,
      })
  const service = createTaskSourceService(registry)
  const sessionLinkEvents = new TaskSessionLinkEvents()

  const withServiceContext = async <T>(
    request: Parameters<NonNullable<WorkspaceAgentServerPluginContext["trusted"]>["actorResolver"]>[0],
    run: (context: BoringTaskSourceContext) => Promise<T>,
  ): Promise<T> => {
    if (!options.trusted) return await run({ workspaceId: workspaceIdFromRequest(request), workspaceRoot: options.workspaceRoot })
    const resolver = options.trusted.workspaceAgentDispatcherResolver
    if (!resolver.runWithWorkspaceAgent) throw new TaskSourceServiceError(403, TASK_ERROR_CODES.SOURCE_FORBIDDEN, "Task source access is forbidden.")
    try {
      const actor = await options.trusted.actorResolver(request)
      if (options.trusted.actorVerifier && !await options.trusted.actorVerifier(actor)) throw new Error("actor verification failed")
      let result: T | undefined
      await resolver.runWithWorkspaceAgent({ agentTypeId, context: actor, requestId: request.id, request }, async (lease) => {
        result = await run({ workspaceId: actor.workspaceId, workspace: lease.workspace })
      })
      return result as T
    } catch {
      throw new TaskSourceServiceError(403, TASK_ERROR_CODES.SOURCE_FORBIDDEN, "Task source access is forbidden.")
    }
  }

  return defineServerPlugin({
    id: TASKS_PLUGIN_ID,
    label: TASKS_PLUGIN_LABEL,
    ...(options.contentDigest?.trim() ? { contentDigest: options.contentDigest.trim() } : {}),
    systemPrompt: "Use `manage_tasks` for explicit workspace task operations. Never infer task-session links from titles, prompts, branches, or generated IDs.",
    agentTools: [createManageTasksTool(service, createTrustedTaskToolBindingResolver(options.trusted, agentTypeId, sessionLinkEvents))],
    routes: async (app) => {
      if (options.beadsOperations?.dispose) {
        app.addHook("onClose", async () => options.beadsOperations?.dispose?.())
      }
      app.get("/api/boring-tasks/sources", async () => ({ ok: true, sources: service.listSources() }))

      app.post("/api/boring-tasks/sources/tasks/list", async (request, reply) => {
        try {
          const body = request.body === undefined ? {} : bodyObject(request.body)
          return await withServiceContext(request, async (context) => ({
            ok: true as const,
            ...(await service.listTasks(context, { sourceIds: stringArray(body.sourceIds) })),
          }))
        } catch (cause) {
          return reply.status(statusFor(cause)).send(responseError(cause))
        }
      })

      app.post("/api/boring-tasks/sources/tasks/get", async (request, reply) => {
        try {
          const body = bodyObject(request.body)
          return await withServiceContext(request, async (context) => ({
            ok: true as const,
            detail: await service.getTaskDetail(context, {
              sourceId: requiredString(body, "sourceId"),
              taskId: requiredString(body, "taskId"),
            }),
          }))
        } catch (cause) {
          return reply.status(statusFor(cause)).send(responseError(cause))
        }
      })

      app.post("/api/boring-tasks/sources/tasks/move", async (request, reply) => {
        try {
          const body = bodyObject(request.body)
          return await withServiceContext(request, async (context) => ({
            ok: true as const,
            task: await service.moveTask(context, {
              sourceId: requiredString(body, "sourceId"),
              taskId: requiredString(body, "taskId"),
              statusId: requiredString(body, "statusId"),
            }),
          }))
        } catch (cause) {
          return reply.status(statusFor(cause)).send(responseError(cause))
        }
      })

      app.post("/api/boring-tasks/sources/tasks/delete", async (_request, reply) => {
        return reply.status(409).send({
          ok: false,
          code: TASK_ERROR_CODES.DELETE_APPROVAL_REQUIRED,
          error: "Task deletion requires an authenticated one-shot human approval.",
        })
      })

      registerTaskSessionLinkRoutes(app, options.trusted, agentTypeId, service, sessionLinkEvents)
    },
  })
}

export default function defaultTasksServerPlugin(options?: TasksServerPluginOptions, ctx?: WorkspaceAgentServerPluginContext): WorkspaceServerPlugin {
  return createTasksServerPlugin({
    ...options,
    workspaceRoot: options?.workspaceRoot ?? ctx?.workspaceRoot,
    trusted: options?.trusted ?? ctx?.trusted,
    agentTypeId: options?.agentTypeId ?? ctx?.agentTypeId,
  })
}

export { createGitHubTaskSource, createWorkspaceGitHubTaskSource, createGhCliGitHubIssueExecutor, createGhCliGitHubRepositoryDetector } from "./githubSource"
export { createTaskSourceRegistry } from "./sourceRuntime"
export { createTaskSourceRegistryFromConfig } from "./sourceConfig"
export { createTaskSourceService, TaskSourceServiceError } from "./taskSourceService"
export { TASK_DETAIL_LIMITS, TaskDetailValidationError, validateTaskDetail } from "./taskDtoValidation"
export { BEADS_SOURCE_ID, SUPPORTED_BEADS_VERSION, createBeadsTaskSource } from "./beadsSource"
export {
  BeadsOperationError,
  createWorkspaceBeadsOperations,
  isAllowedBeadsReadArgs,
  isValidBeadId,
  type BeadsOperations,
  type BeadsReadLimits,
  type BeadsWorkspaceAuthority,
} from "./beadsOperations"
