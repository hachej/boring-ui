import { describe, expect, it, vi } from "vitest"
import { createTasksServerPlugin } from "./index"
import type { TaskSessionLinkWorkspace } from "./taskSessionLinkStore"

class MemoryWorkspace implements TaskSessionLinkWorkspace {
  readonly files = new Map<string, string>()
  async readFile(path: string) {
    const value = this.files.get(path)
    if (value === undefined) throw Object.assign(new Error("not found"), { code: "ENOENT" })
    return value
  }
  async writeFile(path: string, data: string) { this.files.set(path, data) }
  async mkdir() {}
  async rename(from: string, to: string) {
    this.files.set(to, this.files.get(from)!)
    this.files.delete(from)
  }
}

interface TestReply {
  statusCode: number
  payload: unknown
  status(code: number): TestReply
  send(payload: unknown): unknown
}

type Handler = (request: { body?: unknown }, reply: TestReply) => Promise<unknown>

function reply(): TestReply {
  return {
    statusCode: 200,
    payload: undefined as unknown,
    status(code: number) { this.statusCode = code; return this },
    send(payload: unknown) { this.payload = payload; return payload },
  }
}

async function routes(options: Parameters<typeof createTasksServerPlugin>[0]) {
  const handlers = new Map<string, Handler>()
  const app = {
    get() {},
    post(path: string, handler: Handler) { handlers.set(path, handler) },
  }
  const plugin = createTasksServerPlugin(options)
  await plugin.routes!(app as never, {} as never)
  return handlers
}

describe("task session link routes", () => {
  it("authorizes and idempotently links the exact native session", async () => {
    const workspace = new MemoryWorkspace()
    const authorizeSession = vi.fn(async () => undefined)
    const handlers = await routes({
      trusted: {
        actorResolver: async () => ({ workspaceId: "workspace-a", userId: "user-a" }),
        workspaceAgentDispatcherResolver: {
          resolve: vi.fn() as never,
          resolveWithWorkspace: async () => ({ dispatcher: {} as never, workspace: workspace as never }),
          authorizeSession,
        },
      },
    })
    const body = { adapterId: "github", taskId: "776", sessionId: "native-exact" }
    const first = await handlers.get("/api/boring-tasks/sessions/link")!({ body }, reply()) as { link: { id: string } }
    const second = await handlers.get("/api/boring-tasks/sessions/link")!({ body }, reply()) as { link: { id: string } }

    expect(second.link.id).toBe(first.link.id)
    expect(authorizeSession).toHaveBeenCalledWith(
      { workspaceId: "workspace-a", userId: "user-a" },
      "native-exact",
      expect.objectContaining({ request: expect.any(Object) }),
    )
    const listed = await handlers.get("/api/boring-tasks/sessions/list")!({ body: { adapterId: "github", taskId: "776" } }, reply()) as { links: unknown[] }
    expect(listed.links).toHaveLength(1)
  })

  it("returns stable validation and forbidden errors", async () => {
    const validationHandlers = await routes({ trusted: undefined })
    const invalidReply = reply()
    await validationHandlers.get("/api/boring-tasks/sessions/list")!({ body: { adapterId: "github", taskId: "776", extra: true } }, invalidReply)
    expect(invalidReply).toMatchObject({ statusCode: 400, payload: { code: "TASK_SESSION_INVALID_BODY" } })

    const forbiddenReply = reply()
    await validationHandlers.get("/api/boring-tasks/sessions/link")!({ body: { adapterId: "github", taskId: "776", sessionId: "native" } }, forbiddenReply)
    expect(forbiddenReply).toMatchObject({ statusCode: 403, payload: { code: "TASK_SESSION_FORBIDDEN" } })
  })

  it("unlinks a missing native session without loading its transcript", async () => {
    const workspace = new MemoryWorkspace()
    const authorizeSession = vi.fn(async () => undefined)
    const handlers = await routes({
      trusted: {
        actorResolver: async () => ({ workspaceId: "workspace-a", userId: "user-a" }),
        workspaceAgentDispatcherResolver: {
          resolve: vi.fn() as never,
          resolveWithWorkspace: async () => ({ dispatcher: {} as never, workspace: workspace as never }),
          authorizeSession,
        },
      },
    })
    const linked = await handlers.get("/api/boring-tasks/sessions/link")!({ body: { adapterId: "github", taskId: "776", sessionId: "later-missing" } }, reply()) as { link: { id: string } }
    authorizeSession.mockClear()
    await expect(handlers.get("/api/boring-tasks/sessions/unlink")!({ body: { linkId: linked.link.id } }, reply())).resolves.toMatchObject({ ok: true })
    expect(authorizeSession).not.toHaveBeenCalled()
  })
})
