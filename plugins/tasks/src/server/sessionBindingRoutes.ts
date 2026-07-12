import type { FastifyInstance } from "fastify"
import { TASK_ERROR_CODES } from "../shared/error-codes"
import { TaskSourceServiceError } from "./taskSourceService"
import { TaskSessionBindingStoreError, type TaskSessionBindingStore } from "./sessionBindingStore"

const DEFAULT_WORKSPACE_ID = "default"

function workspaceIdFromRequest(request: { headers: Record<string, string | string[] | undefined>; query?: unknown }): string | undefined {
  const header = request.headers["x-boring-workspace-id"]
  if (typeof header === "string" && header.length > 0) return header
  const query = request.query as { workspaceId?: unknown } | undefined
  return typeof query?.workspaceId === "string" && query.workspaceId.length > 0 ? query.workspaceId : undefined
}

function requestWorkspaceId(request: { headers: Record<string, string | string[] | undefined>; query?: unknown }): string {
  return workspaceIdFromRequest(request) ?? DEFAULT_WORKSPACE_ID
}

function responseError(cause: unknown) {
  if (cause instanceof TaskSourceServiceError || cause instanceof TaskSessionBindingStoreError) {
    return { ok: false, code: cause.code, error: cause.message }
  }
  return { ok: false, code: TASK_ERROR_CODES.TASK_SOURCE_ERROR, error: "Task source request failed." }
}

function statusFor(cause: unknown): number {
  if (cause instanceof TaskSourceServiceError || cause instanceof TaskSessionBindingStoreError) return cause.status
  return 500
}

function bodyObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new TaskSourceServiceError(400, "TASK_INVALID_BODY", "request body must be an object")
  }
  return body as Record<string, unknown>
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== "string" || value.length === 0) {
    throw new TaskSourceServiceError(400, "TASK_INVALID_BODY", `${key} must be a non-empty string`)
  }
  return value
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  if (value === undefined) return undefined
  if (typeof value !== "string" || value.length === 0) {
    throw new TaskSourceServiceError(400, "TASK_INVALID_BODY", `${key} must be a non-empty string when provided`)
  }
  return value
}

async function authorizeSessionForLink(
  app: FastifyInstance,
  request: { headers: Record<string, string | string[] | undefined> },
  sessionId: string,
): Promise<{ id: string; title?: string }> {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/agent/pi-chat/sessions?limit=1&activeSessionId=${encodeURIComponent(sessionId)}`,
    headers: request.headers,
  })
  if (response.statusCode >= 400) {
    throw new TaskSourceServiceError(response.statusCode, "TASK_SESSION_AUTHORIZATION_FAILED", "Unable to authorize task session.")
  }
  const body = response.json()
  const sessions = Array.isArray(body) ? body : []
  const session = sessions.find((entry): entry is { id: string; title?: string } => Boolean(entry) && typeof entry === "object" && (entry as { id?: unknown }).id === sessionId)
  if (!session) throw new TaskSourceServiceError(404, "TASK_SESSION_NOT_FOUND", `Task session not found: ${sessionId}`)
  return session
}

export function registerTaskSessionBindingRoutes(app: FastifyInstance, options: { store: TaskSessionBindingStore }): void {
  app.post("/api/boring-tasks/sessions/list", async (request, reply) => {
    try {
      const body = bodyObject(request.body)
      const links = await options.store.listBindings({
        workspaceId: requestWorkspaceId(request),
        adapterId: requiredString(body, "adapterId"),
        taskId: requiredString(body, "taskId"),
      })
      return { ok: true, links }
    } catch (cause) {
      return reply.status(statusFor(cause)).send(responseError(cause))
    }
  })

  app.post("/api/boring-tasks/sessions/link", async (request, reply) => {
    try {
      const body = bodyObject(request.body)
      const sessionId = requiredString(body, "sessionId")
      const session = await authorizeSessionForLink(app, request, sessionId)
      const link = await options.store.createBinding({
        workspaceId: requestWorkspaceId(request),
        adapterId: requiredString(body, "adapterId"),
        taskId: requiredString(body, "taskId"),
        sessionId,
        title: optionalString(body, "title") ?? session.title,
      })
      return { ok: true, link }
    } catch (cause) {
      return reply.status(statusFor(cause)).send(responseError(cause))
    }
  })

  app.post("/api/boring-tasks/sessions/unlink", async (request, reply) => {
    try {
      const body = bodyObject(request.body)
      await options.store.deleteBinding({
        workspaceId: requestWorkspaceId(request),
        bindingId: requiredString(body, "bindingId"),
      })
      return { ok: true }
    } catch (cause) {
      return reply.status(statusFor(cause)).send(responseError(cause))
    }
  })
}
