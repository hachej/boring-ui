import Fastify from "fastify"
import { describe, expect, it, vi } from "vitest"
import { TASK_ERROR_CODES } from "../../shared/error-codes"
import { FileTaskSessionBindingStore } from "../sessionBindingStore"
import { registerTaskSessionBindingRoutes } from "../sessionBindingRoutes"

function buildApp(options: {
  authorizedSessions?: Array<{ id: string; title: string }>
  store?: FileTaskSessionBindingStore
} = {}) {
  const app = Fastify()
  const authorizedSessions = options.authorizedSessions ?? [{ id: "pi-1", title: "Session One" }]
  const authCalls: Array<{ url: string; workspaceId?: string }> = []
  app.get("/api/v1/agent/pi-chat/sessions", async (request) => {
    const query = request.query as { activeSessionId?: string }
    authCalls.push({ url: request.url, workspaceId: request.headers["x-boring-workspace-id"] as string | undefined })
    return authorizedSessions.filter((session) => !query.activeSessionId || session.id === query.activeSessionId)
  })
  const store = options.store ?? new FileTaskSessionBindingStore("/tmp/boring-task-route-unused")
  registerTaskSessionBindingRoutes(app, { store })
  return { app, store, authCalls }
}

describe("task session binding routes", () => {
  it("lists, authorizes, idempotently links, and unlinks with host-derived workspace context", async () => {
    const { app, authCalls } = buildApp()

    const linked = await app.inject({
      method: "POST",
      url: "/api/boring-tasks/sessions/link",
      headers: { "x-boring-workspace-id": "workspace-a" },
      payload: { workspaceId: "forged", adapterId: "github", taskId: "1", sessionId: "pi-1" },
    })
    expect(linked.statusCode).toBe(200)
    expect(linked.json().link).toMatchObject({ workspaceId: "workspace-a", adapterId: "github", taskId: "1", sessionId: "pi-1", title: "Session One" })
    expect(authCalls).toEqual([{ url: "/api/v1/agent/pi-chat/sessions?limit=1&activeSessionId=pi-1", workspaceId: "workspace-a" }])

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/boring-tasks/sessions/link",
      headers: { "x-boring-workspace-id": "workspace-a" },
      payload: { adapterId: "github", taskId: "1", sessionId: "pi-1", title: "Ignored" },
    })
    expect(duplicate.statusCode).toBe(200)
    expect(duplicate.json().link.id).toBe(linked.json().link.id)
    expect(duplicate.json().link.title).toBe("Session One")

    const hiddenFromOtherWorkspace = await app.inject({
      method: "POST",
      url: "/api/boring-tasks/sessions/list",
      headers: { "x-boring-workspace-id": "workspace-b" },
      payload: { adapterId: "github", taskId: "1" },
    })
    expect(hiddenFromOtherWorkspace.json().links).toEqual([])

    const listed = await app.inject({
      method: "POST",
      url: "/api/boring-tasks/sessions/list",
      headers: { "x-boring-workspace-id": "workspace-a" },
      payload: { adapterId: "github", taskId: "1" },
    })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().links).toHaveLength(1)

    const unlinked = await app.inject({
      method: "POST",
      url: "/api/boring-tasks/sessions/unlink",
      headers: { "x-boring-workspace-id": "workspace-a" },
      payload: { bindingId: linked.json().link.id, workspaceId: "forged" },
    })
    expect(unlinked.statusCode).toBe(200)

    const empty = await app.inject({
      method: "POST",
      url: "/api/boring-tasks/sessions/list",
      headers: { "x-boring-workspace-id": "workspace-a" },
      payload: { adapterId: "github", taskId: "1" },
    })
    expect(empty.json().links).toEqual([])
    await app.close()
  })

  it("rejects missing fields and unavailable sessions before persistence", async () => {
    const store = new FileTaskSessionBindingStore("/tmp/boring-task-route-unused-missing")
    const createBinding = vi.spyOn(store, "createBinding")
    const { app } = buildApp({ store, authorizedSessions: [] })

    const invalid = await app.inject({ method: "POST", url: "/api/boring-tasks/sessions/list", payload: { adapterId: "github" } })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json()).toMatchObject({ ok: false, code: TASK_ERROR_CODES.TASK_INVALID_BODY })

    const missing = await app.inject({
      method: "POST",
      url: "/api/boring-tasks/sessions/link",
      payload: { adapterId: "github", taskId: "1", sessionId: "pi-missing" },
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json()).toMatchObject({ ok: false, code: TASK_ERROR_CODES.TASK_SESSION_NOT_FOUND })
    expect(createBinding).not.toHaveBeenCalled()
    await app.close()
  })
})
