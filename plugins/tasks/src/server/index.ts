import { TASK_ERROR_CODES } from "../shared"
import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import { HANDOVER_OPERATION_DETAIL_KINDS, handoverOperationsFromDetails, projectHandovers, type HandoverProjectionEvent } from "@hachej/boring-workspace/shared"
import type { WorkspaceAgentServerPluginContext } from "@hachej/boring-workspace/app/server"
import { TASKS_PLUGIN_ID, TASKS_PLUGIN_LABEL } from "../shared"
import { createGitHubTaskSource, createGhCliGitHubIssueExecutor, createWorkspaceGitHubTaskSource } from "./githubSource"
import { createTaskSourceRegistry, type BoringTaskSourceContext, type BoringTaskSourceRegistry, type BoringTaskSourceRuntime } from "./sourceRuntime"
import { createTaskSourceService, TaskSourceServiceError } from "./taskSourceService"
import { FileTaskSessionLinkStore, TaskSessionLinkStoreError, type TaskSessionLinkWorkspace } from "./taskSessionLinkStore"
import { createTrustedTaskToolBindingResolver } from "./taskToolBinding"
import { createManageTasksTool } from "./manageTasksTool"

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
  return { ok: false, code: TASK_ERROR_CODES.SOURCE_ERROR, error: "Task source request failed." }
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

export type TaskSessionLinkTrustedContext = NonNullable<WorkspaceAgentServerPluginContext["trusted"]>
type TaskRoutesApp = Parameters<NonNullable<WorkspaceServerPlugin["routes"]>>[0]

export interface TasksServerPluginOptions {
  config?: unknown
  sources?: BoringTaskSourceRuntime[]
  workspaceRoot?: string
  trusted?: WorkspaceAgentServerPluginContext["trusted"]
  agentTypeId?: string
}

class TaskSessionRouteError extends Error {
  constructor(readonly status: number, readonly code: typeof TASK_ERROR_CODES.SESSION_INVALID_BODY | typeof TASK_ERROR_CODES.SESSION_FORBIDDEN, message: string) {
    super(message)
  }
}

function sessionResponseError(cause: unknown) {
  if (cause instanceof TaskSessionRouteError || cause instanceof TaskSessionLinkStoreError || cause instanceof TaskSourceServiceError) {
    return { ok: false, code: cause.code, error: cause.message }
  }
  return { ok: false, code: TASK_ERROR_CODES.SESSION_LINK_STORE_ERROR, error: "Task session link request failed." }
}

function sessionStatus(cause: unknown): number {
  if (cause instanceof TaskSessionRouteError || cause instanceof TaskSourceServiceError) return cause.status
  if (cause instanceof TaskSessionLinkStoreError) {
    if (cause.code === TASK_ERROR_CODES.SESSION_INVALID_BODY) return 400
    return cause.code === TASK_ERROR_CODES.SESSION_LINK_MISSING ? 404 : 500
  }
  return 500
}

const MAX_SESSION_ID_BYTES = 512
const sessionIdEncoder = new TextEncoder()

function exactSessionIdsBody(body: unknown, maxEntries = 50): string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new TaskSessionRouteError(400, TASK_ERROR_CODES.SESSION_INVALID_BODY, "request body must be an object")
  }
  const value = body as Record<string, unknown>
  if (Object.keys(value).length !== 1 || !("sessionIds" in value) || !Array.isArray(value.sessionIds)) {
    throw new TaskSessionRouteError(400, TASK_ERROR_CODES.SESSION_INVALID_BODY, "request body must contain exactly sessionIds")
  }
  if (value.sessionIds.length < 1 || value.sessionIds.length > maxEntries) {
    throw new TaskSessionRouteError(400, TASK_ERROR_CODES.SESSION_INVALID_BODY, `sessionIds must contain between 1 and ${maxEntries} entries`)
  }
  const unique: string[] = []
  const seen = new Set<string>()
  for (const entry of value.sessionIds) {
    const normalized = typeof entry === "string" ? entry.trim() : ""
    if (!normalized || sessionIdEncoder.encode(normalized).byteLength > MAX_SESSION_ID_BYTES) {
      throw new TaskSessionRouteError(400, TASK_ERROR_CODES.SESSION_INVALID_BODY, `sessionIds entries must be non-empty strings of at most ${MAX_SESSION_ID_BYTES} UTF-8 bytes`)
    }
    if (!seen.has(normalized)) unique.push(normalized)
    seen.add(normalized)
  }
  return unique
}

function exactSessionBody(body: unknown, keys: readonly string[]): Record<string, string> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new TaskSessionRouteError(400, TASK_ERROR_CODES.SESSION_INVALID_BODY, "request body must be an object")
  const value = body as Record<string, unknown>
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new TaskSessionRouteError(400, TASK_ERROR_CODES.SESSION_INVALID_BODY, `request body must contain exactly ${keys.join(", ")}`)
  }
  return Object.fromEntries(keys.map((key) => {
    const normalized = typeof value[key] === "string" ? value[key].trim() : ""
    if (!normalized || sessionIdEncoder.encode(normalized).byteLength > MAX_SESSION_ID_BYTES) {
      throw new TaskSessionRouteError(400, TASK_ERROR_CODES.SESSION_INVALID_BODY, `${key} must be a non-empty string of at most ${MAX_SESSION_ID_BYTES} UTF-8 bytes`)
    }
    return [key, normalized]
  }))
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

export function registerTaskSessionLinkRoutes(
  app: TaskRoutesApp,
  trusted: TaskSessionLinkTrustedContext | undefined,
  agentTypeId: string,
  service?: ReturnType<typeof createTaskSourceService>,
): void {
  async function withTrustedStore<T>(
    request: Parameters<TaskSessionLinkTrustedContext["actorResolver"]>[0],
    run: (binding: {
      actor: Awaited<ReturnType<TaskSessionLinkTrustedContext["actorResolver"]>>
      workspace: TaskSessionLinkWorkspace
      store: FileTaskSessionLinkStore
      resolver: TaskSessionLinkTrustedContext["workspaceAgentDispatcherResolver"]
    }) => Promise<T>,
  ): Promise<T> {
    if (!trusted?.workspaceAgentDispatcherResolver.runWithWorkspaceAgent) {
      throw new TaskSessionRouteError(403, TASK_ERROR_CODES.SESSION_FORBIDDEN, "Task session links are unavailable.")
    }
    try {
      const actor = await trusted.actorResolver(request)
      if (trusted.actorVerifier && !await trusted.actorVerifier(actor)) throw new Error("actor verification failed")
      let result: T | undefined
      await trusted.workspaceAgentDispatcherResolver.runWithWorkspaceAgent({
        agentTypeId,
        context: actor,
        requestId: request.id,
        request,
      }, async (binding) => {
        const workspace = binding.workspace as TaskSessionLinkWorkspace
        result = await run({
          actor,
          workspace,
          store: new FileTaskSessionLinkStore(workspace),
          resolver: trusted.workspaceAgentDispatcherResolver,
        })
      })
      return result as T
    } catch (cause) {
      if (cause instanceof TaskSessionRouteError || cause instanceof TaskSessionLinkStoreError || cause instanceof TaskSourceServiceError) throw cause
      request.log?.warn({ err: cause }, "task session link trusted workspace resolution failed")
      throw new TaskSessionRouteError(403, TASK_ERROR_CODES.SESSION_FORBIDDEN, "Task session link access is forbidden.")
    }
  }

  app.post("/api/boring-tasks/sessions/list", async (request, reply) => {
    try {
      const body = exactSessionBody(request.body, ["adapterId", "taskId"])
      return await withTrustedStore(request, async ({ actor, store, resolver }) => {
        if (!resolver.authorizeSession) throw new TaskSessionRouteError(403, TASK_ERROR_CODES.SESSION_FORBIDDEN, "Task session listing is unavailable.")
        const links = await store.list(body.adapterId, body.taskId)
        const disclosedLinks: Array<Omit<(typeof links)[number], "sessionId"> & { sessionId?: string }> = []
        for (const link of links) {
          try {
            await resolver.authorizeSession(actor, { agentTypeId: link.agentTypeId, sessionId: link.sessionId }, { request })
            disclosedLinks.push(link)
          } catch {
            const { sessionId: _redacted, ...redactedLink } = link
            disclosedLinks.push(redactedLink)
          }
        }
        return { ok: true as const, links: disclosedLinks }
      })
    } catch (cause) {
      return reply.status(sessionStatus(cause)).send(sessionResponseError(cause))
    }
  })

  app.post("/api/boring-tasks/sessions/tasks", async (request, reply) => {
    try {
      const sessionIds = exactSessionIdsBody(request.body)
      return await withTrustedStore(request, async ({ actor, workspace, store, resolver }) => {
        if (!service || !resolver.authorizeSession) throw new TaskSessionRouteError(403, TASK_ERROR_CODES.SESSION_FORBIDDEN, "Task session provenance is unavailable.")
        const resolution = await service.resolveSessionTasks(
          { workspaceId: actor.workspaceId, workspace: workspace as unknown as { readonly root: string } },
          sessionIds,
          {
            agentTypeId,
            linkStore: store,
            authorizeSession: async (sessionId) => {
              try {
                await resolver.authorizeSession!(actor, { agentTypeId, sessionId }, { request })
              } catch {
                throw new TaskSessionRouteError(403, TASK_ERROR_CODES.SESSION_FORBIDDEN, "Task session access is forbidden.")
              }
            },
          },
        )
        return { ok: true as const, ...resolution }
      })
    } catch (cause) {
      return reply.status(sessionStatus(cause)).send(sessionResponseError(cause))
    }
  })

  app.post("/api/boring-tasks/sessions/handovers", async (request, reply) => {
    try {
      const sessionIds = exactSessionIdsBody(request.body, 20)
      return await withTrustedStore(request, async ({ actor, resolver }) => {
        if (!resolver.readSessionRunDetails) throw new TaskSessionRouteError(403, TASK_ERROR_CODES.SESSION_FORBIDDEN, "Task session Handover summaries are unavailable.")
        const matches: Array<{ sessionId: string; handover: ReturnType<typeof projectHandovers>[number] }> = []
        const omittedSessionIds: string[] = []
        for (const sessionId of sessionIds) {
          try {
            const runs = await resolver.readSessionRunDetails(actor, { agentTypeId, sessionId }, HANDOVER_OPERATION_DETAIL_KINDS, { request })
            let latestSuccessfulHandover: ReturnType<typeof projectHandovers>[number] | undefined
            for (const run of runs) {
              const events: HandoverProjectionEvent[] = [
                { type: "run-start", runId: run.runId },
                ...run.details.map((details, index) => ({ type: "tool-result" as const, entryId: `${run.terminalEntryId}:detail:${index}`, isError: false, details })),
                { type: "run-terminal", entryId: run.terminalEntryId, state: run.state, createdAt: run.createdAt },
              ]
              const projected = projectHandovers(events)[0]
              if (run.state === "success" && run.details.some((detail) => handoverOperationsFromDetails(detail).length > 0)) latestSuccessfulHandover = projected
            }
            if (latestSuccessfulHandover) matches.push({ sessionId, handover: latestSuccessfulHandover })
            else omittedSessionIds.push(sessionId)
          } catch {
            omittedSessionIds.push(sessionId)
          }
        }
        return { ok: true as const, matches, omittedSessionIds }
      })
    } catch (cause) {
      return reply.status(sessionStatus(cause)).send(sessionResponseError(cause))
    }
  })

  app.post("/api/boring-tasks/sessions/link", async (request, reply) => {
    try {
      const body = exactSessionBody(request.body, ["adapterId", "taskId", "agentTypeId", "sessionId"])
      if (body.agentTypeId !== agentTypeId) throw new TaskSessionRouteError(403, TASK_ERROR_CODES.SESSION_FORBIDDEN, "Task session Agent is forbidden.")
      return await withTrustedStore(request, async ({ actor, store, resolver }) => {
        if (!resolver.authorizeSession) throw new TaskSessionRouteError(403, TASK_ERROR_CODES.SESSION_FORBIDDEN, "Task session linking is unavailable.")
        try {
          await resolver.authorizeSession(actor, { agentTypeId, sessionId: body.sessionId }, { request })
        } catch {
          throw new TaskSessionRouteError(403, TASK_ERROR_CODES.SESSION_FORBIDDEN, "Task session link access is forbidden.")
        }
        return { ok: true as const, link: await store.link({ adapterId: body.adapterId, taskId: body.taskId, agentTypeId, sessionId: body.sessionId }) }
      })
    } catch (cause) {
      return reply.status(sessionStatus(cause)).send(sessionResponseError(cause))
    }
  })

  app.post("/api/boring-tasks/sessions/unlink", async (request, reply) => {
    try {
      const body = exactSessionBody(request.body, ["linkId"])
      return await withTrustedStore(request, async ({ store }) => {
        const link = await store.unlink(body.linkId)
        const { sessionId: _redacted, ...redactedLink } = link
        return { ok: true as const, link: redactedLink }
      })
    } catch (cause) {
      return reply.status(sessionStatus(cause)).send(sessionResponseError(cause))
    }
  })
}

export function createTasksServerPlugin(options: TasksServerPluginOptions = {}): WorkspaceServerPlugin {
  const agentTypeId = options.agentTypeId?.trim()
  if (!agentTypeId) throw new Error("boring tasks requires a host-selected agentTypeId")
  const registry = options.sources
    ? createTaskSourceRegistry(options.sources)
    : createTaskSourceRegistryFromConfig(options.config, { workspaceRoot: options.workspaceRoot })
  const service = createTaskSourceService(registry)

  const withServiceContext = async <T>(
    request: Parameters<TaskSessionLinkTrustedContext["actorResolver"]>[0],
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
    systemPrompt: "Use `manage_tasks` for explicit workspace task operations. Never infer task-session links from titles, prompts, branches, or generated IDs.",
    agentTools: [createManageTasksTool(service, createTrustedTaskToolBindingResolver(options.trusted, agentTypeId))],
    routes: async (app) => {
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

      registerTaskSessionLinkRoutes(app, options.trusted, agentTypeId, service)
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
export {
  createTaskSourceService,
  TaskSourceServiceError,
  type TaskManagementService,
  type TaskSessionBindingContext,
  type TaskKeyInput,
  type TaskListInput,
  type TaskListOutput,
} from "./taskSourceService"
export {
  FileTaskSessionLinkStore,
  TaskSessionLinkStoreError,
  type TaskSessionLinkStore,
  type TaskSessionLinkStoreErrorCode,
  type TaskSessionLinkWorkspace,
} from "./taskSessionLinkStore"
export { createManageTasksTool, manageTasksParameters, parseManageTasksInput } from "./manageTasksTool"
export {
  createTrustedTaskToolBindingResolver,
  TaskToolBindingError,
  type TaskToolBindingErrorCode,
  type TrustedTaskToolBinding,
  type TrustedTaskToolBindingResolver,
} from "./taskToolBinding"
