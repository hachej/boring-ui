import type { WorkspaceAgentServerPluginContext } from "@hachej/boring-workspace/app/server"
import type { WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import {
  HANDOVER_OPERATION_DETAIL_KINDS,
  handoverOperationsFromDetails,
  projectHandovers,
  type HandoverProjectionEvent,
} from "@hachej/boring-workspace/shared"
import { TASK_ERROR_CODES } from "../shared"
import { type TaskManagementService, TaskSourceServiceError } from "./taskSourceService"
import {
  TaskSessionLinkStoreError,
  taskSessionLinkStoreForWorkspace,
  type TaskSessionLinkStore,
  type TaskSessionLinkWorkspace,
} from "./taskSessionLinkStore"
import {
  taskSessionLinkStoreWithEvents,
  type TaskSessionLinkEvent,
  type TaskSessionLinkEvents,
} from "./taskSessionLinkEvents"

export type TaskSessionLinkTrustedContext = NonNullable<WorkspaceAgentServerPluginContext["trusted"]>
type TaskRoutesApp = Parameters<NonNullable<WorkspaceServerPlugin["routes"]>>[0]

class TaskSessionRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: typeof TASK_ERROR_CODES.SESSION_INVALID_BODY | typeof TASK_ERROR_CODES.SESSION_FORBIDDEN,
    message: string,
  ) {
    super(message)
  }
}

function responseError(cause: unknown) {
  if (cause instanceof TaskSessionRouteError || cause instanceof TaskSessionLinkStoreError || cause instanceof TaskSourceServiceError) {
    return { ok: false, code: cause.code, error: cause.message }
  }
  return { ok: false, code: TASK_ERROR_CODES.SESSION_LINK_STORE_ERROR, error: "Task session link request failed." }
}

function statusFor(cause: unknown): number {
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
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new TaskSessionRouteError(400, TASK_ERROR_CODES.SESSION_INVALID_BODY, "request body must be an object")
  }
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

export function registerTaskSessionLinkRoutes(
  app: TaskRoutesApp,
  trusted: TaskSessionLinkTrustedContext | undefined,
  agentTypeId: string,
  service: TaskManagementService,
  events: TaskSessionLinkEvents,
): void {
  async function withTrustedStore<T>(
    request: Parameters<TaskSessionLinkTrustedContext["actorResolver"]>[0],
    run: (binding: {
      actor: Awaited<ReturnType<TaskSessionLinkTrustedContext["actorResolver"]>>
      workspace: TaskSessionLinkWorkspace
      store: TaskSessionLinkStore
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
        const workspace: TaskSessionLinkWorkspace = binding.workspace
        result = await run({
          actor,
          workspace,
          store: taskSessionLinkStoreWithEvents(taskSessionLinkStoreForWorkspace(workspace), actor.workspaceId, events),
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

  app.get("/api/boring-tasks/session-links/events", async (request, reply) => {
    const queued: TaskSessionLinkEvent[] = []
    let ready = false
    let cleanedUp = false
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let unsubscribe = () => {}
    const cleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      if (heartbeat) clearInterval(heartbeat)
      unsubscribe()
    }
    request.raw.once("close", cleanup)
    reply.raw.once("close", cleanup)
    const write = (event: "snapshot" | "change", data: unknown) => {
      if (reply.raw.destroyed || reply.raw.writableEnded) return
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }
    try {
      const snapshot = await withTrustedStore(request, async ({ actor, store }) => {
        unsubscribe = events.subscribe(actor.workspaceId, (event) => {
          if (ready) write("change", event)
          else queued.push(event)
        })
        if (!store.snapshotLinks) throw new TaskSessionLinkStoreError(TASK_ERROR_CODES.SESSION_LINK_STORE_ERROR, "Task session link snapshot is unavailable.")
        const cursor = events.cursor(actor.workspaceId)
        return events.snapshot(await store.snapshotLinks(), cursor)
      })
      if (cleanedUp || request.raw.destroyed || reply.raw.destroyed) {
        unsubscribe()
        return
      }
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      })
      ready = true
      write("snapshot", snapshot)
      for (const event of queued.sort((left, right) => left.revision - right.revision)) write("change", event)
      heartbeat = setInterval(() => {
        if (reply.raw.destroyed || reply.raw.writableEnded) cleanup()
        else reply.raw.write(": heartbeat\n\n")
      }, 15_000)
      reply.hijack()
    } catch (cause) {
      cleanup()
      if (request.raw.destroyed || reply.raw.destroyed) return
      return reply.status(statusFor(cause)).send(responseError(cause))
    }
  })

  app.post("/api/boring-tasks/sessions/tasks", async (request, reply) => {
    try {
      const sessionIds = exactSessionIdsBody(request.body)
      return await withTrustedStore(request, async ({ actor, workspace, store, resolver }) => {
        if (!resolver.authorizeSession) throw new TaskSessionRouteError(403, TASK_ERROR_CODES.SESSION_FORBIDDEN, "Task session provenance is unavailable.")
        const resolution = await service.resolveSessionTasks(
          { workspaceId: actor.workspaceId, workspace },
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
      return reply.status(statusFor(cause)).send(responseError(cause))
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
      return reply.status(statusFor(cause)).send(responseError(cause))
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
        const link = await store.link({ adapterId: body.adapterId, taskId: body.taskId, agentTypeId, sessionId: body.sessionId })
        return { ok: true as const, link, links: await store.list(link.adapterId, link.taskId) }
      })
    } catch (cause) {
      return reply.status(statusFor(cause)).send(responseError(cause))
    }
  })

  app.post("/api/boring-tasks/sessions/unlink", async (request, reply) => {
    try {
      const body = exactSessionBody(request.body, ["linkId"])
      return await withTrustedStore(request, async ({ store }) => ({
        ok: true as const,
        link: await service.unlinkSession(body.linkId, { linkStore: store }),
      }))
    } catch (cause) {
      return reply.status(statusFor(cause)).send(responseError(cause))
    }
  })
}
