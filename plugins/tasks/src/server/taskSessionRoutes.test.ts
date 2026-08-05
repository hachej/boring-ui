// @vitest-environment node
import { EventEmitter } from "node:events"
import { TASK_ERROR_CODES } from "../shared"
import { describe, expect, it, vi } from "vitest"
import { createTasksServerPlugin } from "./index"
import type { BoringTaskSourceRuntime } from "./sourceRuntime"
import type { TaskSessionLinkWorkspace } from "./taskSessionLinkStore"

class MemoryWorkspace implements TaskSessionLinkWorkspace {
  readonly root = "/workspace"
  readonly files = new Map<string, string>()
  readGate?: Promise<void>
  async readFile(path: string) {
    await this.readGate
    const value = this.files.get(path)
    if (value === undefined) throw Object.assign(new Error("not found"), { code: TASK_ERROR_CODES.WORKSPACE_FILE_MISSING })
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

type Handler = (request: any, reply: any) => Promise<unknown>

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
    get(path: string, handler: Handler) { handlers.set(path, handler) },
    post(path: string, handler: Handler) { handlers.set(path, handler) },
  }
  const plugin = createTasksServerPlugin({ agentTypeId: "alpha", ...options })
  await plugin.routes!(app as never, {} as never)
  return handlers
}

const runWithWorkspace = (workspace: MemoryWorkspace) => async (_input: unknown, run: (binding: unknown) => Promise<void>) => {
  await run({ workspace } as never)
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
          runWithWorkspaceAgent: runWithWorkspace(workspace) as never,
          resolveWithWorkspace: async () => ({ dispatcher: {} as never, workspace: workspace as never }),
          authorizeSession,
        },
      },
    })
    const body = { adapterId: "github", taskId: "776", agentTypeId: "alpha", sessionId: "native-exact" }
    const first = await handlers.get("/api/boring-tasks/sessions/link")!({ body }, reply()) as { link: { id: string } }
    const second = await handlers.get("/api/boring-tasks/sessions/link")!({ body }, reply()) as { link: { id: string } }

    expect(second.link.id).toBe(first.link.id)
    expect(authorizeSession).toHaveBeenCalledWith(
      { workspaceId: "workspace-a", userId: "user-a" },
      { agentTypeId: "alpha", sessionId: "native-exact" },
      expect.objectContaining({ request: expect.any(Object) }),
    )
  })

  it("streams an initial linked-session snapshot and workspace-scoped changes", async () => {
    const workspace = new MemoryWorkspace()
    const handlers = await routes({
      trusted: {
        actorResolver: async () => ({ workspaceId: "workspace-a", userId: "user-a" }),
        workspaceAgentDispatcherResolver: {
          resolve: vi.fn() as never,
          runWithWorkspaceAgent: runWithWorkspace(workspace) as never,
          resolveWithWorkspace: async () => ({ dispatcher: {} as never, workspace: workspace as never }),
          authorizeSession: async () => undefined,
        },
      },
    })
    const requestRaw = new EventEmitter()
    const responseRaw = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableEnded: false,
      writes: [] as string[],
      writeHead: vi.fn(),
      write(value: string) { this.writes.push(value); return true },
    })
    const streamReply = Object.assign(reply(), { raw: responseRaw, hijack: vi.fn() })
    await handlers.get("/api/boring-tasks/session-links/events")!({ id: "stream", headers: {}, query: { workspaceId: "workspace-a" }, raw: requestRaw }, streamReply)
    expect(responseRaw.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ "Content-Type": "text/event-stream" }))
    expect(responseRaw.writes.join("")).toContain('"tasks":[]')

    await handlers.get("/api/boring-tasks/sessions/link")!({
      id: "link",
      headers: {},
      body: { adapterId: "github", taskId: "776", agentTypeId: "alpha", sessionId: "native-secret" },
    }, reply())
    const frames = responseRaw.writes.join("")
    expect(frames).toContain("event: snapshot")
    expect(frames).toContain("event: change")
    expect(frames).toContain('"adapterId":"github"')
    expect(frames).toContain('"taskId":"776"')
    expect(frames).toContain('"sessionId":"native-secret"')
    expect(frames).toContain('"agentTypeId":"alpha"')
    requestRaw.emit("close")
  })

  it("replays a durable change that lands while the initial snapshot is reading", async () => {
    const workspace = new MemoryWorkspace()
    workspace.files.set(".pi/tasks/session-links.json", JSON.stringify({ version: 1, links: [] }))
    let releaseRead!: () => void
    workspace.readGate = new Promise<void>((resolve) => { releaseRead = resolve })
    const handlers = await routes({
      trusted: {
        actorResolver: async () => ({ workspaceId: "workspace-a", userId: "user-a" }),
        workspaceAgentDispatcherResolver: {
          resolve: vi.fn() as never,
          runWithWorkspaceAgent: runWithWorkspace(workspace) as never,
          resolveWithWorkspace: async () => ({ dispatcher: {} as never, workspace: workspace as never }),
          authorizeSession: async () => undefined,
        },
      },
    })
    const requestRaw = Object.assign(new EventEmitter(), { destroyed: false })
    const responseRaw = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableEnded: false,
      writes: [] as string[],
      writeHead: vi.fn(),
      write(value: string) { this.writes.push(value); return true },
    })
    const streamReply = Object.assign(reply(), { raw: responseRaw, hijack: vi.fn() })
    const stream = handlers.get("/api/boring-tasks/session-links/events")!({ id: "stream", headers: {}, query: { workspaceId: "workspace-a" }, raw: requestRaw }, streamReply)
    await Promise.resolve()
    const link = handlers.get("/api/boring-tasks/sessions/link")!({ id: "link", headers: {}, body: { adapterId: "github", taskId: "776", agentTypeId: "alpha", sessionId: "native" } }, reply())
    releaseRead()
    await Promise.all([stream, link])

    const frames = responseRaw.writes.join("")
    expect(frames).toContain('event: snapshot')
    expect(frames).toContain('"revision":0')
    expect(frames).toContain('event: change')
    expect(frames).toContain('"revision":1')
    requestRaw.emit("close")
  })

  it("does not write or retain a stream that disconnects during its initial snapshot", async () => {
    const workspace = new MemoryWorkspace()
    workspace.files.set(".pi/tasks/session-links.json", JSON.stringify({ version: 1, links: [] }))
    let releaseRead!: () => void
    workspace.readGate = new Promise<void>((resolve) => { releaseRead = resolve })
    const handlers = await routes({
      trusted: {
        actorResolver: async () => ({ workspaceId: "workspace-a", userId: "user-a" }),
        workspaceAgentDispatcherResolver: {
          resolve: vi.fn() as never,
          runWithWorkspaceAgent: runWithWorkspace(workspace) as never,
          resolveWithWorkspace: async () => ({ dispatcher: {} as never, workspace: workspace as never }),
          authorizeSession: async () => undefined,
        },
      },
    })
    const requestRaw = Object.assign(new EventEmitter(), { destroyed: false })
    const responseRaw = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableEnded: false,
      writes: [] as string[],
      writeHead: vi.fn(),
      write(value: string) { this.writes.push(value); return true },
    })
    const streamReply = Object.assign(reply(), { raw: responseRaw, hijack: vi.fn() })
    const stream = handlers.get("/api/boring-tasks/session-links/events")!({ id: "stream", headers: {}, query: { workspaceId: "workspace-a" }, raw: requestRaw }, streamReply)
    requestRaw.emit("close")
    releaseRead()
    await stream

    expect(responseRaw.writeHead).not.toHaveBeenCalled()
    expect(responseRaw.writes).toEqual([])
    expect(streamReply.hijack).not.toHaveBeenCalled()
  })

  it("reverse-resolves deduplicated authorized sessions without exposing denied, missing, or stale provenance", async () => {
    const workspace = new MemoryWorkspace()
    const authorizeSession = vi.fn(async (_actor, ref: { sessionId: string }) => {
      if (ref.sessionId === "denied" || ref.sessionId === "missing") throw new Error("not found")
    })
    const source: BoringTaskSourceRuntime = {
      summary: () => ({ id: "source-a", label: "Source A", capabilities: { move: true } }),
      getBoardConfig: async () => ({ adapterId: "source-a", columns: [{ id: "todo", title: "Todo" }] }),
      listTasks: async () => [],
      getTaskCard: async (_ctx, taskId) => taskId === "stale" ? undefined : {
        id: taskId,
        number: `#${taskId}`,
        title: `Task ${taskId}`,
        statusId: taskId === "1" ? "todo" : "done",
        adapterId: "source-a",
        url: `https://example.test/${taskId}`,
      },
      moveTask: async (_ctx, input) => ({ id: input.taskId, number: input.taskId, title: input.taskId, statusId: input.statusId, adapterId: "source-a" }),
    }
    const handlers = await routes({
      sources: [source],
      trusted: {
        actorResolver: async () => ({ workspaceId: "trusted-workspace", userId: "trusted-user" }),
        actorVerifier: async (actor) => actor.workspaceId === "trusted-workspace" && actor.userId === "trusted-user",
        workspaceAgentDispatcherResolver: {
          resolve: vi.fn() as never,
          runWithWorkspaceAgent: runWithWorkspace(workspace) as never,
          resolveWithWorkspace: async () => ({ dispatcher: {} as never, workspace: workspace as never }),
          authorizeSession,
        },
      },
    })
    for (const taskId of ["2", "1", "stale"]) {
      await handlers.get("/api/boring-tasks/sessions/link")!({ body: { adapterId: "source-a", taskId, agentTypeId: "alpha", sessionId: "native" } }, reply())
    }

    authorizeSession.mockClear()
    const response = await handlers.get("/api/boring-tasks/sessions/tasks")!({
      body: { sessionIds: ["native", "native", "denied", "unlinked", "missing"] },
      headers: { "x-boring-workspace-id": "forged-workspace", "x-boring-user-id": "forged-user" },
    }, reply())
    expect(response).toEqual({
      ok: true,
      matches: [{
        sessionId: "native",
        tasks: [
          { adapterId: "source-a", taskId: "1", number: "#1", title: "Task 1", statusId: "todo", url: "https://example.test/1" },
          { adapterId: "source-a", taskId: "2", number: "#2", title: "Task 2", statusId: "done", url: "https://example.test/2" },
        ],
      }],
      omittedSessionIds: ["denied", "unlinked", "missing"],
    })
    expect(authorizeSession.mock.calls.map((call) => call[1])).toEqual([
      { agentTypeId: "alpha", sessionId: "native" },
      { agentTypeId: "alpha", sessionId: "denied" },
      { agentTypeId: "alpha", sessionId: "unlinked" },
      { agentTypeId: "alpha", sessionId: "missing" },
    ])
    expect(authorizeSession.mock.calls.every((call) => call[0].workspaceId === "trusted-workspace" && call[0].userId === "trusted-user")).toBe(true)
  })

  it("returns only the latest successful structured Handover per authorized session", async () => {
    const artifact = (id: string) => ({ id, surfaceKind: "workspace.open.path", target: `docs/${id}.md`, title: id })
    const details = (id: string) => ({ kind: "boring.handover.operation", wireVersion: 1, operation: { action: "upsert", artifact: artifact(id) } })
    const readSessionRunDetails = vi.fn(async (_actor, ref: { sessionId: string }) => {
      if (ref.sessionId === "denied") throw new Error("not found")
      if (ref.sessionId === "cleared") return [
        { runId: "old", terminalEntryId: "old-terminal", state: "success" as const, details: [details("old")] },
        { runId: "clear", terminalEntryId: "clear-terminal", state: "success" as const, details: [{ kind: "boring.handover.operation", wireVersion: 1, operation: { action: "remove", artifactId: "old" } }] },
      ]
      return [
        { runId: "old", terminalEntryId: "old-terminal", state: "success" as const, details: [details("old")] },
        { runId: "failed", terminalEntryId: "failed-terminal", state: "error" as const, details: [details("failed")] },
        { runId: "latest", terminalEntryId: "latest-terminal", state: "success" as const, createdAt: "2026-01-02T00:00:00.000Z", details: [details("latest")] },
        { runId: "empty", terminalEntryId: "empty-terminal", state: "success" as const, details: [] },
      ]
    })
    const handlers = await routes({
      trusted: {
        actorResolver: async () => ({ workspaceId: "workspace-a", userId: "user-a" }),
        workspaceAgentDispatcherResolver: {
          resolve: vi.fn() as never,
          runWithWorkspaceAgent: async (_input, run) => { await run({ workspace: new MemoryWorkspace() } as never) },
          resolveWithWorkspace: async () => ({ dispatcher: {} as never, workspace: new MemoryWorkspace() as never }),
          authorizeSession: async () => undefined,
          readSessionRunDetails,
        },
      },
    })
    const response = await handlers.get("/api/boring-tasks/sessions/handovers")!({ body: { sessionIds: ["s1", "cleared", "denied"] } }, reply())
    expect(response).toEqual({
      ok: true,
      matches: [{ sessionId: "s1", handover: {
        id: "handover:latest-terminal",
        runId: "latest",
        terminalEntryId: "latest-terminal",
        createdAt: "2026-01-02T00:00:00.000Z",
        artifacts: [artifact("latest")],
      } }],
      omittedSessionIds: ["cleared", "denied"],
    })
    expect(JSON.stringify(response)).not.toContain("failed\"")
    expect(readSessionRunDetails).toHaveBeenCalledWith(
      { workspaceId: "workspace-a", userId: "user-a" },
      { agentTypeId: "alpha", sessionId: "s1" },
      ["boring.handover.operation", "boring.handover.operations"],
      expect.objectContaining({ request: expect.any(Object) }),
    )
  })

  it("bounds and strictly validates reverse session resolution", async () => {
    const handlers = await routes({ trusted: undefined })
    const handoverResponse = reply()
    await handlers.get("/api/boring-tasks/sessions/handovers")!({ body: { sessionIds: Array.from({ length: 21 }, (_, index) => `s-${index}`) } }, handoverResponse)
    expect(handoverResponse).toMatchObject({ statusCode: 400, payload: { code: TASK_ERROR_CODES.SESSION_INVALID_BODY } })
    for (const body of [
      { sessionIds: [], extra: true },
      { sessionIds: [] },
      { sessionIds: Array.from({ length: 51 }, (_, index) => `s-${index}`) },
      { sessionIds: ["é".repeat(257)] },
    ]) {
      const response = reply()
      await handlers.get("/api/boring-tasks/sessions/tasks")!({ body }, response)
      expect(response).toMatchObject({ statusCode: 400, payload: { code: TASK_ERROR_CODES.SESSION_INVALID_BODY } })
    }
  })

  it("returns stable validation and forbidden errors", async () => {
    const validationHandlers = await routes({ trusted: undefined })
    const invalidReply = reply()
    await validationHandlers.get("/api/boring-tasks/sessions/link")!({ body: { adapterId: "github", taskId: "776", agentTypeId: "alpha", sessionId: "native", extra: true } }, invalidReply)
    expect(invalidReply).toMatchObject({ statusCode: 400, payload: { code: TASK_ERROR_CODES.SESSION_INVALID_BODY } })

    const oversizedReply = reply()
    await validationHandlers.get("/api/boring-tasks/sessions/link")!({ body: { adapterId: "é".repeat(257), taskId: "776", agentTypeId: "alpha", sessionId: "native" } }, oversizedReply)
    expect(oversizedReply).toMatchObject({ statusCode: 400, payload: { code: TASK_ERROR_CODES.SESSION_INVALID_BODY } })

    const forbiddenReply = reply()
    await validationHandlers.get("/api/boring-tasks/sessions/link")!({ body: { adapterId: "github", taskId: "776", agentTypeId: "alpha", sessionId: "native" } }, forbiddenReply)
    expect(forbiddenReply).toMatchObject({ statusCode: 403, payload: { code: TASK_ERROR_CODES.SESSION_FORBIDDEN } })
  })

  it("returns the same forbidden response for denied and nonexistent native sessions", async () => {
    for (const reason of ["denied", "missing"]) {
      const handlers = await routes({
        trusted: {
          actorResolver: async () => ({ workspaceId: "workspace-a", userId: "user-a" }),
          workspaceAgentDispatcherResolver: {
            resolve: vi.fn() as never,
            runWithWorkspaceAgent: async (_input, run) => { await run({ workspace: new MemoryWorkspace() } as never) },
            resolveWithWorkspace: async () => ({ dispatcher: {} as never, workspace: new MemoryWorkspace() as never }),
            authorizeSession: async () => { throw new Error(reason) },
          },
        },
      })
      const response = reply()
      await handlers.get("/api/boring-tasks/sessions/link")!({ body: { adapterId: "github", taskId: "776", agentTypeId: "alpha", sessionId: `native-${reason}` } }, response)
      expect(response).toMatchObject({ statusCode: 403, payload: { code: TASK_ERROR_CODES.SESSION_FORBIDDEN, error: "Task session link access is forbidden." } })
    }
  })

  it("uses the Host-leased workspace for each store operation", async () => {
    const firstWorkspace = new MemoryWorkspace()
    const handlers = await routes({
      trusted: {
        actorResolver: async () => ({ workspaceId: "workspace-a", userId: "user-a" }),
        workspaceAgentDispatcherResolver: {
          resolve: vi.fn() as never,
          runWithWorkspaceAgent: runWithWorkspace(firstWorkspace) as never,
          resolveWithWorkspace: async () => ({ dispatcher: {} as never, workspace: firstWorkspace as never }),
          authorizeSession: async () => undefined,
        },
      },
    })
    await handlers.get("/api/boring-tasks/sessions/link")!({ body: { adapterId: " github ", taskId: " 776 ", agentTypeId: "alpha", sessionId: " native " } }, reply())
    expect(firstWorkspace.files.get(".pi/tasks/session-links.json")).toContain('"sessionId": "native"')
  })

  it("uses the trusted Workspace for task routes and disables unapproved delete", async () => {
    const workspace = new MemoryWorkspace()
    const contexts: unknown[] = []
    const deleteTask = vi.fn()
    const source: BoringTaskSourceRuntime = {
      summary: () => ({ id: "source-a", label: "Source A", capabilities: { move: true, delete: true, deleteEffect: "close" } }),
      getBoardConfig: () => ({ adapterId: "source-a", columns: [{ id: "todo", title: "Todo" }] }),
      listTasks: (ctx) => {
        contexts.push(ctx)
        return [{ id: "1", number: "1", title: "One", statusId: "todo", adapterId: "source-a" }]
      },
      moveTask: async (_ctx, input) => ({ id: input.taskId, number: input.taskId, title: "One", statusId: input.statusId, adapterId: "source-a" }),
      deleteTask,
    }
    const handlers = await routes({
      sources: [source],
      trusted: {
        actorResolver: async () => ({ workspaceId: "workspace-authorized", userId: "user-a" }),
        actorVerifier: async (actor) => actor.workspaceId === "workspace-authorized",
        workspaceAgentDispatcherResolver: {
          resolve: vi.fn() as never,
          runWithWorkspaceAgent: runWithWorkspace(workspace) as never,
          resolveWithWorkspace: async () => ({ dispatcher: {} as never, workspace: workspace as never }),
        },
      },
    })
    const listed = await handlers.get("/api/boring-tasks/sources/tasks/list")!(
      { body: { sourceIds: ["source-a"] }, headers: { "x-boring-workspace-id": "forged-workspace" } },
      reply(),
    ) as { tasks: unknown[] }
    expect(listed.tasks).toHaveLength(1)
    expect(contexts).toEqual([{ workspaceId: "workspace-authorized", workspace }])

    const deleteReply = reply()
    await handlers.get("/api/boring-tasks/sources/tasks/delete")!({ body: { sourceId: "source-a", taskId: "1" } }, deleteReply)
    expect(deleteReply).toMatchObject({ statusCode: 409, payload: { code: TASK_ERROR_CODES.DELETE_APPROVAL_REQUIRED } })
    expect(deleteTask).not.toHaveBeenCalled()
  })

  it("unlinks a missing native session without loading its transcript", async () => {
    const workspace = new MemoryWorkspace()
    const authorizeSession = vi.fn(async () => undefined)
    const handlers = await routes({
      trusted: {
        actorResolver: async () => ({ workspaceId: "workspace-a", userId: "user-a" }),
        workspaceAgentDispatcherResolver: {
          resolve: vi.fn() as never,
          runWithWorkspaceAgent: runWithWorkspace(workspace) as never,
          resolveWithWorkspace: async () => ({ dispatcher: {} as never, workspace: workspace as never }),
          authorizeSession,
        },
      },
    })
    const linked = await handlers.get("/api/boring-tasks/sessions/link")!({ body: { adapterId: "github", taskId: "776", agentTypeId: "alpha", sessionId: "later-missing" } }, reply()) as { link: { id: string } }
    authorizeSession.mockClear()
    const unlinked = await handlers.get("/api/boring-tasks/sessions/unlink")!({ body: { linkId: linked.link.id } }, reply()) as { ok: true; link: Record<string, unknown> }
    expect(unlinked).toMatchObject({ ok: true, link: { id: linked.link.id, sessionId: "later-missing" } })
    expect(authorizeSession).not.toHaveBeenCalled()
  })
})
