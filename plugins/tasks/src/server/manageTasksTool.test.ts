import { TASK_ERROR_CODES } from "../shared"
import { describe, expect, it, vi } from "vitest"
import type { ToolExecContext } from "@hachej/boring-workspace"
import type { BoringTaskSessionLink } from "../shared"
import { createTasksServerPlugin } from "./index"
import { createManageTasksTool, manageTasksParameters, parseManageTasksInput } from "./manageTasksTool"
import type { BoringTaskSourceRuntime } from "./sourceRuntime"
import { createTaskSourceRegistry } from "./sourceRuntime"
import { createTaskSourceService } from "./taskSourceService"
import { TaskToolBindingError, type TrustedTaskToolBindingResolver } from "./taskToolBinding"

const task = { id: "1", number: "1", title: "One", statusId: "todo", adapterId: "source-a" }

function source(): BoringTaskSourceRuntime {
  return {
    summary: () => ({ id: "source-a", label: "Source A", capabilities: { move: true, delete: true, deleteEffect: "close" } }),
    getBoardConfig: async () => ({ adapterId: "source-a", columns: [{ id: "todo", title: "Todo" }, { id: "done", title: "Done" }] }),
    listTasks: async () => [task],
    getTask: async (_ctx, taskId) => taskId === task.id ? task : undefined,
    moveTask: async (_ctx, input) => ({ ...task, statusId: input.statusId }),
    deleteTask: async () => undefined,
  }
}

function fixture(options: { authorizeError?: boolean } = {}) {
  const links: BoringTaskSessionLink[] = []
  const linkStore = {
    list: vi.fn(async (adapterId: string, taskId: string) => links.filter((link) => link.adapterId === adapterId && link.taskId === taskId)),
    listBySessionIds: vi.fn(async (sessionIds: readonly string[]) => new Map(sessionIds.map((sessionId) => [sessionId, links.filter((link) => link.sessionId === sessionId)]))),
    link: vi.fn(async (input: { adapterId: string; taskId: string; sessionId: string }) => {
      const existing = links.find((link) => link.adapterId === input.adapterId && link.taskId === input.taskId && link.sessionId === input.sessionId)
      if (existing) return existing
      const link = { id: `link-${links.length + 1}`, ...input, createdAt: "2026-07-18T00:00:00.000Z" }
      links.push(link)
      return link
    }),
    unlink: vi.fn(async (linkId: string) => {
      const index = links.findIndex((link) => link.id === linkId)
      if (index < 0) throw Object.assign(new Error("Task session link was not found."), { code: TASK_ERROR_CODES.SESSION_LINK_MISSING })
      return links.splice(index, 1)[0]!
    }),
  }
  const authorizeSession = options.authorizeError
    ? vi.fn(async () => { throw new TaskToolBindingError(TASK_ERROR_CODES.TOOL_FORBIDDEN, "Task session access is forbidden.") })
    : vi.fn(async () => undefined)
  const resolve = vi.fn(async () => ({
    actor: { workspaceId: "workspace-a", userId: "user-a" },
    workspace: { root: "/workspace-a" } as never,
    linkStore,
    authorizeSession,
  }))
  const resolver: TrustedTaskToolBindingResolver = { resolve }
  const service = createTaskSourceService(createTaskSourceRegistry([source()]))
  return { tool: createManageTasksTool(service, resolver), links, linkStore, authorizeSession, resolve }
}

const context: ToolExecContext = {
  abortSignal: new AbortController().signal,
  toolCallId: "call-1",
  workspaceId: "workspace-a",
  userId: "user-a",
  sessionId: "native-current",
}

describe("manage_tasks schema and parser", () => {
  it("publishes exact discriminated action schemas", () => {
    const branches = manageTasksParameters.oneOf as Array<{ additionalProperties?: boolean }>
    expect(branches).toHaveLength(5)
    expect(branches.every((branch) => branch.additionalProperties === false)).toBe(true)
  })

  it.each([
    [{ action: "get", adapterId: "source-a", taskId: "1", extra: true }],
    [{ action: "move", adapterId: "source-a", taskId: "1" }],
    [{ action: "bind_session", adapterId: "source-a", taskId: "1", session: { id: "native", title: "forged" } }],
    [{ action: "bind_session", adapterId: "source-a", taskId: "1", session: "browser-local" }],
    [{ action: "unlink_session", linkId: "é".repeat(257) }],
    [{ action: "get", adapterId: "source-a", taskId: "1", workspaceId: "forged" }],
    [{ action: "delete", adapterId: "source-a", taskId: "1" }],
  ])("rejects invalid or spoofable input %o", (input) => {
    expect(() => parseManageTasksInput(input as Record<string, unknown>)).toThrow()
  })
})

describe("manage_tasks execution", () => {
  it("lists, gets, and moves tasks with structured results", async () => {
    const { tool } = fixture()
    await expect(tool.execute({ action: "list", adapterId: "source-a" }, context)).resolves.toMatchObject({
      details: { ok: true, action: "list", tasks: [{ id: "1" }] },
    })
    await expect(tool.execute({ action: "get", adapterId: "source-a", taskId: "1" }, context)).resolves.toMatchObject({
      details: { ok: true, action: "get", task: { id: "1" }, adapter: { summary: { capabilities: { deleteEffect: "close" } } }, links: [] },
    })
    await expect(tool.execute({ action: "move", adapterId: "source-a", taskId: "1", statusId: "done" }, context)).resolves.toMatchObject({
      details: { ok: true, action: "move", task: { id: "1", statusId: "done" } },
    })
  })

  it("binds the authoritative current session idempotently", async () => {
    const { tool, links, authorizeSession } = fixture()
    const input = { action: "bind_session", adapterId: "source-a", taskId: "1", session: "current" }
    const first = await tool.execute(input, context)
    const second = await tool.execute(input, context)
    expect(first).toMatchObject({ details: { ok: true, link: { sessionId: "native-current" } } })
    expect(second).toMatchObject({ details: { link: { id: (first.details as { link: { id: string } }).link.id } } })
    expect(links).toHaveLength(1)
    expect(authorizeSession).toHaveBeenCalledWith("native-current")
  })

  it("fails when current is absent and authorizes explicit ids without disclosure", async () => {
    const current = fixture()
    await expect(current.tool.execute(
      { action: "bind_session", adapterId: "source-a", taskId: "1", session: "current" },
      { ...context, sessionId: undefined },
    )).resolves.toMatchObject({ isError: true, details: { code: TASK_ERROR_CODES.SESSION_CURRENT_UNAVAILABLE } })
    expect(current.authorizeSession).not.toHaveBeenCalled()

    const denied = fixture({ authorizeError: true })
    await expect(denied.tool.execute(
      { action: "bind_session", adapterId: "source-a", taskId: "1", session: { id: "missing-or-denied" } },
      context,
    )).resolves.toMatchObject({ isError: true, details: { code: TASK_ERROR_CODES.TOOL_FORBIDDEN } })
  })

  it("unlinks by link id without authorizing the transcript", async () => {
    const fixtureValue = fixture()
    const bound = await fixtureValue.tool.execute(
      { action: "bind_session", adapterId: "source-a", taskId: "1", session: { id: "native-old" } },
      context,
    )
    fixtureValue.authorizeSession.mockClear()
    const linkId = (bound.details as { link: { id: string } }).link.id
    await expect(fixtureValue.tool.execute({ action: "unlink_session", linkId }, context)).resolves.toMatchObject({
      details: { ok: true, action: "unlink_session", link: { id: linkId } },
    })
    expect(fixtureValue.authorizeSession).not.toHaveBeenCalled()
  })

  it("registers exactly one manage_tasks tool in the Tasks server plugin", () => {
    const plugin = createTasksServerPlugin({ sources: [source()] })
    expect(plugin.agentTools?.map((tool) => tool.name)).toEqual(["manage_tasks"])
    expect(plugin.systemPrompt).toContain("Never infer")
  })
})
