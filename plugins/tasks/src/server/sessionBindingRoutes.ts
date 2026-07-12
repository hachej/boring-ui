import type { FastifyInstance } from "fastify"
import { TASK_ERROR_CODES } from "../shared/error-codes"
import type { TaskSessionPortProvider } from "./sessionPort"
import { TaskSourceServiceError } from "./taskSourceService"
import { TaskSessionBindingStoreError, type TaskSessionBindingStore } from "./sessionBindingStore"

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

export function registerTaskSessionBindingRoutes(app: FastifyInstance, options: {
  store: TaskSessionBindingStore
  sessionPortProvider: TaskSessionPortProvider
}): void {
  app.post("/api/boring-tasks/sessions/list", async (request, reply) => {
    try {
      const body = bodyObject(request.body)
      const { context } = options.sessionPortProvider.resolve(request)
      const links = await options.store.listBindings({
        workspaceId: context.workspaceId,
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
      const { context, port } = options.sessionPortProvider.resolve(request)
      const session = await port.findAuthorizedSession(context, sessionId)
      if (!session) throw new TaskSourceServiceError(404, "TASK_SESSION_NOT_FOUND", `Task session not found: ${sessionId}`)
      const link = await options.store.createBinding({
        workspaceId: context.workspaceId,
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
      const { context } = options.sessionPortProvider.resolve(request)
      await options.store.deleteBinding({
        workspaceId: context.workspaceId,
        bindingId: requiredString(body, "bindingId"),
      })
      return { ok: true }
    } catch (cause) {
      return reply.status(statusFor(cause)).send(responseError(cause))
    }
  })

  app.post("/api/boring-tasks/sessions/search", async (request, reply) => {
    try {
      const body = bodyObject(request.body)
      const { context, port } = options.sessionPortProvider.resolve(request)
      return { ok: true, sessions: await port.searchAuthorizedSessions(context, optionalString(body, "query") ?? "") }
    } catch (cause) {
      return reply.status(statusFor(cause)).send(responseError(cause))
    }
  })
}
