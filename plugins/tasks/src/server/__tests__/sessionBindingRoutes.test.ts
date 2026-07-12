import Fastify from "fastify"
import { describe, expect, it, vi } from "vitest"
import { TASK_ERROR_CODES } from "../../shared/error-codes"
import type { TaskSessionPortProvider } from "../sessionPort"
import { FileTaskSessionBindingStore } from "../sessionBindingStore"
import { registerTaskSessionBindingRoutes } from "../sessionBindingRoutes"

function buildApp(options: {
  authorizedSessions?: Array<{ id: string; title: string; createdAt?: string; updatedAt?: string }>
  store?: FileTaskSessionBindingStore
  workspaceId?: string
} = {}) {
  const app = Fastify()
  const authorizedSessions = options.authorizedSessions ?? [{ id: "pi-1", title: "Session One" }]
  const findAuthorizedSession = vi.fn(async (_context, sessionId: string) => {
    const found = authorizedSessions.find((session) => session.id === sessionId)
    return found ? { ...found, createdAt: found.createdAt ?? "2026-07-01T00:00:00.000Z", updatedAt: found.updatedAt ?? "2026-07-01T00:00:00.000Z" } : null
  })
  const provider: TaskSessionPortProvider = {
    // This intentionally ignores caller headers/query/body: it represents a
    // host-authenticated workspace resolver.
    resolve: () => ({
      context: { workspaceId: options.workspaceId ?? "workspace-a", authSubject: "user-a" },
      port: {
        findAuthorizedSession,
        searchAuthorizedSessions: async () => [],
      },
    }),
  }
  const store = options.store ?? new FileTaskSessionBindingStore("/tmp/boring-task-route-unused")
  registerTaskSessionBindingRoutes(app, { store, sessionPortProvider: provider })
  return { app, store, findAuthorizedSession }
}

describe("task session binding routes", () => {
  it("uses the host workspace scope despite forged header/query/body values", async () => {
    const { app, store, findAuthorizedSession } = buildApp()
    const foreign = await store.createBinding({ workspaceId: "workspace-b", adapterId: "github", taskId: "1", sessionId: "pi-foreign" })

    const linked = await app.inject({
      method: "POST",
      url: "/api/boring-tasks/sessions/link?workspaceId=workspace-b",
      headers: { "x-boring-workspace-id": "workspace-b" },
      payload: { workspaceId: "workspace-b", adapterId: "github", taskId: "1", sessionId: "pi-1" },
    })
    expect(linked.statusCode).toBe(200)
    expect(linked.json().link).toMatchObject({ workspaceId: "workspace-a", sessionId: "pi-1", title: "Session One" })
    expect(findAuthorizedSession).toHaveBeenCalledWith({ workspaceId: "workspace-a", authSubject: "user-a" }, "pi-1")

    const hidden = await app.inject({
      method: "POST",
      url: "/api/boring-tasks/sessions/list?workspaceId=workspace-b",
      headers: { "x-boring-workspace-id": "workspace-b" },
      payload: { adapterId: "github", taskId: "1", workspaceId: "workspace-b" },
    })
    expect(hidden.json().links).toHaveLength(1)
    expect(hidden.json().links[0]).toMatchObject({ workspaceId: "workspace-a", sessionId: "pi-1" })

    const forgedUnlink = await app.inject({
      method: "POST",
      url: "/api/boring-tasks/sessions/unlink?workspaceId=workspace-b",
      headers: { "x-boring-workspace-id": "workspace-b" },
      payload: { bindingId: foreign.id, workspaceId: "workspace-b" },
    })
    expect(forgedUnlink.statusCode).toBe(404)
    await expect(store.listBindings({ workspaceId: "workspace-b", adapterId: "github", taskId: "1" })).resolves.toEqual([foreign])
    await app.close()
  })

  it("authorizes through the typed port, supports search, and rejects invalid input before persistence", async () => {
    const store = new FileTaskSessionBindingStore("/tmp/boring-task-route-unused-missing")
    const createBinding = vi.spyOn(store, "createBinding")
    const { app, findAuthorizedSession } = buildApp({ store, authorizedSessions: [] })

    const invalid = await app.inject({ method: "POST", url: "/api/boring-tasks/sessions/list", payload: { adapterId: "github" } })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json()).toMatchObject({ ok: false, code: TASK_ERROR_CODES.TASK_INVALID_BODY })

    const missing = await app.inject({ method: "POST", url: "/api/boring-tasks/sessions/link", payload: { adapterId: "github", taskId: "1", sessionId: "pi-missing" } })
    expect(missing.statusCode).toBe(404)
    expect(missing.json()).toMatchObject({ ok: false, code: TASK_ERROR_CODES.TASK_SESSION_NOT_FOUND })
    expect(findAuthorizedSession).toHaveBeenCalledTimes(1)
    expect(createBinding).not.toHaveBeenCalled()
    await app.close()
  })
})
