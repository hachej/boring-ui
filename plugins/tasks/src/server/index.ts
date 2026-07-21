import { TASK_ERROR_CODES } from "../shared"
import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import { HANDOVER_OPERATION_DETAIL_KINDS, projectHandovers, type HandoverProjectionEvent } from "@hachej/boring-workspace/shared"
import type { WorkspaceAgentServerPluginContext } from "@hachej/boring-workspace/app/server"
import { TASKS_PLUGIN_ID, TASKS_PLUGIN_LABEL } from "../shared"
import { createGitHubTaskSource, createGhCliGitHubIssueExecutor, createWorkspaceGitHubTaskSource } from "./githubSource"
import { createTaskSourceRegistry, type BoringTaskSourceRegistry, type BoringTaskSourceRuntime } from "./sourceRuntime"
import { createTaskSourceService, TaskSourceServiceError } from "./taskSourceService"
import { FileTaskSessionLinkStore, TaskSessionLinkStoreError, type TaskSessionLinkWorkspace } from "./taskSessionLinkStore"
import { createTrustedTaskToolBindingResolver } from "./taskToolBinding"
import { createManageTasksTool } from "./manageTasksTool"
import {
  createTaskArtifactFolder,
  resolveTaskArtifactPath,
  taskArtifactFolderStatus,
  taskArtifactPathTemplate,
  TaskArtifactFolderError,
  type TaskArtifactIdentity,
  type TaskArtifactWorkspace,
} from "./taskArtifactFolder"

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

function exactTaskArtifactBody(body: unknown): TaskArtifactIdentity {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new TaskArtifactFolderError(TASK_ERROR_CODES.ARTIFACT_PATH_INVALID, "request body must be an object")
  }
  const value = body as Record<string, unknown>
  const keys = ["adapterId", "taskId", "number"] as const
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key as typeof keys[number]))) {
    throw new TaskArtifactFolderError(TASK_ERROR_CODES.ARTIFACT_PATH_INVALID, "request body must contain exactly adapterId, taskId, number")
  }
  return Object.fromEntries(keys.map((key) => {
    const normalized = typeof value[key] === "string" ? value[key].trim() : ""
    if (!normalized || sessionIdEncoder.encode(normalized).byteLength > MAX_SESSION_ID_BYTES) {
      throw new TaskArtifactFolderError(TASK_ERROR_CODES.ARTIFACT_PATH_INVALID, `${key} must be a bounded non-empty string`)
    }
    return [key, normalized]
  })) as unknown as TaskArtifactIdentity
}

function artifactResponseError(cause: unknown) {
  if (cause instanceof TaskArtifactFolderError) return { ok: false, code: cause.code, error: cause.message }
  if (cause instanceof TaskSourceServiceError) return { ok: false, code: cause.code, error: cause.message }
  return { ok: false, code: TASK_ERROR_CODES.ARTIFACT_WORKSPACE_ERROR, error: "Task artifact folder request failed." }
}

function artifactStatus(cause: unknown): number {
  if (cause instanceof TaskArtifactFolderError) return cause.status
  if (cause instanceof TaskSourceServiceError) return cause.status
  return 500
}

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
  service?: ReturnType<typeof createTaskSourceService>,
): void {
  const stores = new Map<string, FileTaskSessionLinkStore>()

  async function trustedStore(request: Parameters<TaskSessionLinkTrustedContext["actorResolver"]>[0]) {
    if (!trusted?.workspaceAgentDispatcherResolver.resolveWithWorkspace) {
      throw new TaskSessionRouteError(403, TASK_ERROR_CODES.SESSION_FORBIDDEN, "Task session links are unavailable.")
    }
    try {
      const actor = await trusted.actorResolver(request)
      if (trusted.actorVerifier && !await trusted.actorVerifier(actor)) throw new Error("actor verification failed")
      const binding = await trusted.workspaceAgentDispatcherResolver.resolveWithWorkspace(actor, { request })
      const workspace = binding.workspace as TaskSessionLinkWorkspace
      let store = stores.get(actor.workspaceId)
      if (!store) {
        store = new FileTaskSessionLinkStore(workspace)
        stores.set(actor.workspaceId, store)
      }
      return { actor, workspace, store, resolver: trusted.workspaceAgentDispatcherResolver }
    } catch (cause) {
      request.log?.warn({ err: cause }, "task session link trusted workspace resolution failed")
      throw new TaskSessionRouteError(403, TASK_ERROR_CODES.SESSION_FORBIDDEN, "Task session link access is forbidden.")
    }
  }

  app.post("/api/boring-tasks/sessions/list", async (request, reply) => {
    try {
      const body = exactSessionBody(request.body, ["adapterId", "taskId"])
      const { actor, store, resolver } = await trustedStore(request)
      if (!resolver.authorizeSession) throw new TaskSessionRouteError(403, TASK_ERROR_CODES.SESSION_FORBIDDEN, "Task session listing is unavailable.")
      const links = await store.list(body.adapterId as string, body.taskId as string)
      const authorizedLinks: typeof links = []
      for (const link of links) {
        try {
          await resolver.authorizeSession(actor, link.sessionId, { request })
          authorizedLinks.push(link)
        } catch {
          // Exact native session IDs are omitted when the caller cannot open them.
        }
      }
      return { ok: true, links: authorizedLinks }
    } catch (cause) {
      return reply.status(sessionStatus(cause)).send(sessionResponseError(cause))
    }
  })

  app.post("/api/boring-tasks/sessions/tasks", async (request, reply) => {
    try {
      const sessionIds = exactSessionIdsBody(request.body)
      const { actor, workspace, store, resolver } = await trustedStore(request)
      if (!service || !resolver.authorizeSession) {
        throw new TaskSessionRouteError(403, TASK_ERROR_CODES.SESSION_FORBIDDEN, "Task session provenance is unavailable.")
      }
      const resolution = await service.resolveSessionTasks(
        { workspaceId: actor.workspaceId, workspace: workspace as unknown as { readonly root: string } },
        sessionIds,
        {
          linkStore: store,
          authorizeSession: async (sessionId) => {
            try {
              await resolver.authorizeSession!(actor, sessionId, { request })
            } catch {
              throw new TaskSessionRouteError(403, TASK_ERROR_CODES.SESSION_FORBIDDEN, "Task session access is forbidden.")
            }
          },
        },
      )
      return { ok: true, ...resolution }
    } catch (cause) {
      return reply.status(sessionStatus(cause)).send(sessionResponseError(cause))
    }
  })

  app.post("/api/boring-tasks/sessions/handovers", async (request, reply) => {
    try {
      const sessionIds = exactSessionIdsBody(request.body, 20)
      const { actor, resolver } = await trustedStore(request)
      if (!resolver.readSessionRunDetails) {
        throw new TaskSessionRouteError(403, TASK_ERROR_CODES.SESSION_FORBIDDEN, "Task session Handover summaries are unavailable.")
      }
      const matches: Array<{ sessionId: string; handover: ReturnType<typeof projectHandovers>[number] }> = []
      const omittedSessionIds: string[] = []
      for (const sessionId of sessionIds) {
        try {
          const runs = await resolver.readSessionRunDetails(actor, sessionId, HANDOVER_OPERATION_DETAIL_KINDS, { request })
          let latestSuccessfulHandover: ReturnType<typeof projectHandovers>[number] | undefined
          for (const run of runs) {
            const events: HandoverProjectionEvent[] = [
              { type: "run-start", runId: run.runId },
              ...run.details.map((details, index) => ({ type: "tool-result" as const, entryId: `${run.terminalEntryId}:detail:${index}`, isError: false, details })),
              { type: "run-terminal", entryId: run.terminalEntryId, state: run.state, createdAt: run.createdAt },
            ]
            const projected = projectHandovers(events)[0]
            if (run.state === "success") latestSuccessfulHandover = projected
          }
          if (latestSuccessfulHandover) matches.push({ sessionId, handover: latestSuccessfulHandover })
          else omittedSessionIds.push(sessionId)
        } catch {
          omittedSessionIds.push(sessionId)
        }
      }
      return { ok: true, matches, omittedSessionIds }
    } catch (cause) {
      return reply.status(sessionStatus(cause)).send(sessionResponseError(cause))
    }
  })

  app.post("/api/boring-tasks/sessions/link", async (request, reply) => {
    try {
      const body = exactSessionBody(request.body, ["adapterId", "taskId", "sessionId"])
      const { actor, store, resolver } = await trustedStore(request)
      if (!resolver.authorizeSession) throw new TaskSessionRouteError(403, TASK_ERROR_CODES.SESSION_FORBIDDEN, "Task session linking is unavailable.")
      try {
        await resolver.authorizeSession(actor, body.sessionId, { request })
      } catch {
        throw new TaskSessionRouteError(403, TASK_ERROR_CODES.SESSION_FORBIDDEN, "Task session link access is forbidden.")
      }
      return { ok: true, link: await store.link({ adapterId: body.adapterId, taskId: body.taskId, sessionId: body.sessionId }) }
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
  const artifactTemplate = taskArtifactPathTemplate(options.config)

  const serviceContext = async (request: Parameters<TaskSessionLinkTrustedContext["actorResolver"]>[0]) => {
    if (!options.trusted) return { workspaceId: workspaceIdFromRequest(request), workspaceRoot: options.workspaceRoot }
    if (!options.trusted.workspaceAgentDispatcherResolver.resolveWithWorkspace) {
      throw new TaskSourceServiceError(403, TASK_ERROR_CODES.SOURCE_FORBIDDEN, "Task source access is forbidden.")
    }
    try {
      const actor = await options.trusted.actorResolver(request)
      if (options.trusted.actorVerifier && !await options.trusted.actorVerifier(actor)) throw new Error("actor verification failed")
      const binding = await options.trusted.workspaceAgentDispatcherResolver.resolveWithWorkspace(actor, { request })
      return { workspaceId: actor.workspaceId, workspace: binding.workspace }
    } catch {
      throw new TaskSourceServiceError(403, TASK_ERROR_CODES.SOURCE_FORBIDDEN, "Task source access is forbidden.")
    }
  }

  return defineServerPlugin({
    id: TASKS_PLUGIN_ID,
    label: TASKS_PLUGIN_LABEL,
    systemPrompt: "Use `manage_tasks` for explicit workspace task operations. Never infer task-session links from titles, prompts, branches, or generated IDs.",
    agentTools: [createManageTasksTool(service, createTrustedTaskToolBindingResolver(options.trusted))],
    routes: async (app) => {
      app.get("/api/boring-tasks/sources", async () => ({ ok: true, sources: service.listSources() }))

      app.post("/api/boring-tasks/sources/tasks/list", async (request, reply) => {
        try {
          const body = request.body === undefined ? {} : bodyObject(request.body)
          return { ok: true, ...(await service.listTasks(await serviceContext(request), { sourceIds: stringArray(body.sourceIds) })) }
        } catch (cause) {
          return reply.status(statusFor(cause)).send(responseError(cause))
        }
      })

      app.post("/api/boring-tasks/sources/tasks/move", async (request, reply) => {
        try {
          const body = bodyObject(request.body)
          const task = await service.moveTask(await serviceContext(request), {
            sourceId: requiredString(body, "sourceId"),
            taskId: requiredString(body, "taskId"),
            statusId: requiredString(body, "statusId"),
          })
          return { ok: true, task }
        } catch (cause) {
          return reply.status(statusFor(cause)).send(responseError(cause))
        }
      })

      app.post("/api/boring-tasks/artifact-folder/status", async (request, reply) => {
        try {
          const identity = exactTaskArtifactBody(request.body)
          const context = await serviceContext(request)
          if (!("workspace" in context) || !context.workspace) {
            throw new TaskArtifactFolderError(TASK_ERROR_CODES.ARTIFACT_WORKSPACE_UNAVAILABLE, "Task artifact folders require a trusted Workspace.", 403)
          }
          const path = resolveTaskArtifactPath(artifactTemplate, identity)
          return { ok: true, ...(await taskArtifactFolderStatus(context.workspace as TaskArtifactWorkspace, path)) }
        } catch (cause) {
          return reply.status(artifactStatus(cause)).send(artifactResponseError(cause))
        }
      })

      app.post("/api/boring-tasks/artifact-folder/create", async (request, reply) => {
        try {
          const identity = exactTaskArtifactBody(request.body)
          const context = await serviceContext(request)
          if (!("workspace" in context) || !context.workspace) {
            throw new TaskArtifactFolderError(TASK_ERROR_CODES.ARTIFACT_WORKSPACE_UNAVAILABLE, "Task artifact folders require a trusted Workspace.", 403)
          }
          const path = resolveTaskArtifactPath(artifactTemplate, identity)
          return { ok: true, ...(await createTaskArtifactFolder(context.workspace as TaskArtifactWorkspace, path)) }
        } catch (cause) {
          return reply.status(artifactStatus(cause)).send(artifactResponseError(cause))
        }
      })

      app.post("/api/boring-tasks/sources/tasks/delete", async (_request, reply) => {        return reply.status(409).send({
          ok: false,
          code: TASK_ERROR_CODES.DELETE_APPROVAL_REQUIRED,
          error: "Task deletion requires an authenticated one-shot human approval.",
        })
      })

      registerTaskSessionLinkRoutes(app, options.trusted, service)
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
  createTaskArtifactFolder,
  resolveTaskArtifactPath,
  taskArtifactFolderStatus,
  taskArtifactPathTemplate,
  TaskArtifactFolderError,
  DEFAULT_TASK_ARTIFACT_PATH_TEMPLATE,
  type TaskArtifactFolderErrorCode,
  type TaskArtifactIdentity,
  type TaskArtifactWorkspace,
} from "./taskArtifactFolder"
export {
  createTrustedTaskToolBindingResolver,
  TaskToolBindingError,
  type TaskToolBindingErrorCode,
  type TrustedTaskToolBinding,
  type TrustedTaskToolBindingResolver,
} from "./taskToolBinding"
