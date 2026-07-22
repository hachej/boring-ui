import { TASK_ERROR_CODES } from "../shared"
import { describe, expect, test, vi } from "vitest"
import type { BoringTaskSourceRuntime } from "./sourceRuntime"
import { createTaskSourceRegistry } from "./sourceRuntime"
import { createTaskSourceService, TaskSourceServiceError } from "./taskSourceService"
import { createGitHubTaskSource, createWorkspaceGitHubTaskSource, type GitHubIssueExecutor } from "./githubSource"

function source(overrides: Partial<BoringTaskSourceRuntime> = {}): BoringTaskSourceRuntime {
  return {
    summary: () => ({ id: "source-a", label: "Source A", capabilities: { move: true } }),
    getBoardConfig: () => ({ adapterId: "source-a", columns: [{ id: "todo", title: "Todo" }] }),
    listTasks: () => [{ id: "1", number: "1", title: "One", statusId: "todo", adapterId: "source-a" }],
    moveTask: (_ctx, input) => ({ id: input.taskId, number: input.taskId, title: "One", statusId: input.statusId, adapterId: "source-a" }),
    ...overrides,
  }
}

describe("task source service", () => {
  test("lists source configs and tasks through generic registry", async () => {
    const service = createTaskSourceService(createTaskSourceRegistry([source()]))
    await expect(service.listTasks({}, { sourceIds: ["source-a"] })).resolves.toMatchObject({
      configs: { "source-a": { adapterId: "source-a" } },
      tasks: [{ id: "1", adapterId: "source-a" }],
    })
  })

  test("rejects unknown sources with stable error", async () => {
    const service = createTaskSourceService(createTaskSourceRegistry([]))
    await expect(service.moveTask({}, { sourceId: "missing", taskId: "1", statusId: "todo" })).rejects.toMatchObject({
      status: 404,
      code: TASK_ERROR_CODES.SOURCE_NOT_FOUND,
    })
  })

  test("filters and bounds managed task lists", async () => {
    const service = createTaskSourceService(createTaskSourceRegistry([source({
      listTasks: () => [
        { id: "1", number: "1", title: "Alpha bug", statusId: "todo", adapterId: "source-a", tags: ["bug"] },
        { id: "2", number: "2", title: "Beta", statusId: "done", adapterId: "source-a" },
      ],
    })]))
    await expect(service.listTasks({}, { adapterId: "source-a", statusId: "todo", query: "BUG", limit: 1 }))
      .resolves.toMatchObject({ tasks: [{ id: "1" }] })
    await expect(service.listTasks({}, { limit: 101 })).rejects.toMatchObject({ code: TASK_ERROR_CODES.INVALID_BODY })
  })

  test("uses exact adapter lookup with a bounded legacy fallback", async () => {
    const direct = vi.fn(async () => ({ id: "1", number: "1", title: "Direct", statusId: "todo", adapterId: "source-a" }))
    const service = createTaskSourceService(createTaskSourceRegistry([source({ getTask: direct })]))
    await expect(service.getTask({}, { adapterId: "source-a", taskId: "1" })).resolves.toMatchObject({ title: "Direct" })
    expect(direct).toHaveBeenCalledWith({}, "1")

    const fallback = createTaskSourceService(createTaskSourceRegistry([source()]))
    await expect(fallback.getTask({}, { adapterId: "source-a", taskId: "missing" })).rejects.toMatchObject({ code: TASK_ERROR_CODES.NOT_FOUND })
  })

  test("validates destination status before native mutation", async () => {
    const moveTask = vi.fn()
    const service = createTaskSourceService(createTaskSourceRegistry([source({ moveTask })]))
    await expect(service.moveTask({}, { adapterId: "source-a", taskId: "1", statusId: "missing" }))
      .rejects.toMatchObject({ code: TASK_ERROR_CODES.STATUS_NOT_FOUND })
    expect(moveTask).not.toHaveBeenCalled()
  })

  test("verifies task then authorizes session before binding", async () => {
    const events: string[] = []
    const link = { id: "link", adapterId: "source-a", taskId: "1", sessionId: "native", createdAt: "2026-07-18T00:00:00.000Z" }
    const linkStore = {
      list: vi.fn(async () => [link]),
      listBySessionIds: vi.fn(async (sessionIds: readonly string[]) => new Map(sessionIds.map((sessionId) => [sessionId, sessionId === "native" ? [link] : []]))),
      link: vi.fn(async () => { events.push("link"); return link }),
      unlink: vi.fn(async () => link),
    }
    const service = createTaskSourceService(createTaskSourceRegistry([source({
      getTask: async (_ctx, taskId) => {
        events.push("task")
        return taskId === "1" ? { id: "1", number: "1", title: "One", statusId: "todo", adapterId: "source-a" } : undefined
      },
    })]))
    await expect(service.bindSession({}, { adapterId: "source-a", taskId: "1", sessionId: "native" }, {
      linkStore,
      authorizeSession: async () => { events.push("authorize") },
    })).resolves.toEqual(link)
    expect(events).toEqual(["task", "authorize", "link"])
    await expect(service.listSessionLinks({ adapterId: "source-a", taskId: "1" }, { linkStore })).resolves.toEqual([link])
    await expect(service.unlinkSession("link", { linkStore })).resolves.toEqual(link)
  })

  test("reverse-resolves authorized sessions to deterministic exact task summaries", async () => {
    const links = [
      { id: "z", adapterId: "source-a", taskId: "2", sessionId: "native", createdAt: "2026-07-18T00:00:00.000Z" },
      { id: "a", adapterId: "source-a", taskId: "1", sessionId: "native", createdAt: "2026-07-18T00:00:00.000Z" },
      { id: "stale", adapterId: "source-a", taskId: "missing", sessionId: "native", createdAt: "2026-07-18T00:00:00.000Z" },
    ]
    const listBySessionIds = vi.fn(async (sessionIds: readonly string[]) => new Map(sessionIds.map((sessionId) => [sessionId, sessionId === "native" ? links : []])))
    const service = createTaskSourceService(createTaskSourceRegistry([source({
      getTask: async (_ctx, taskId) => taskId === "missing" ? undefined : {
        id: taskId,
        number: `#${taskId}`,
        title: `Task ${taskId}`,
        statusId: taskId === "1" ? "todo" : "done",
        adapterId: "source-a",
        url: `https://example.test/${taskId}`,
      },
    })]))
    const resolution = await service.resolveSessionTasks({}, ["native", "denied", "unlinked"], {
      linkStore: {
        list: vi.fn(async () => []),
        listBySessionIds,
        link: vi.fn(),
        unlink: vi.fn(),
      },
      authorizeSession: async (sessionId) => {
        if (sessionId === "denied") throw new Error("not found")
      },
    })
    expect(listBySessionIds).toHaveBeenCalledTimes(1)
    expect(listBySessionIds).toHaveBeenCalledWith(["native", "unlinked"])
    expect(resolution).toEqual({
      matches: [{
        sessionId: "native",
        tasks: [
          { adapterId: "source-a", taskId: "1", number: "#1", title: "Task 1", statusId: "todo", url: "https://example.test/1" },
          { adapterId: "source-a", taskId: "2", number: "#2", title: "Task 2", statusId: "done", url: "https://example.test/2" },
        ],
      }],
      omittedSessionIds: ["denied", "unlinked"],
    })
  })

  test("enforces move and delete capability at source boundary", async () => {
    const service = createTaskSourceService(createTaskSourceRegistry([source({
      summary: () => ({ id: "source-a", label: "Source A", capabilities: { move: false, delete: false } }),
      moveTask: undefined,
      deleteTask: undefined,
    })]))
    await expect(service.moveTask({}, { sourceId: "source-a", taskId: "1", statusId: "todo" })).rejects.toMatchObject({
      status: 409,
      code: TASK_ERROR_CODES.SOURCE_MOVE_UNSUPPORTED,
    })
    await expect(service.deleteTask({}, { sourceId: "source-a", taskId: "1" })).rejects.toMatchObject({
      status: 409,
      code: TASK_ERROR_CODES.SOURCE_DELETE_UNSUPPORTED,
    })
  })

  test("executes deleteTask and does not cascade to links", async () => {
    const deleteTask = vi.fn(async () => undefined)
    const service = createTaskSourceService(createTaskSourceRegistry([source({
      summary: () => ({ id: "source-a", label: "Source A", capabilities: { move: true, delete: true, deleteEffect: "close" } }),
      getTask: async () => ({ id: "1", number: "1", title: "One", statusId: "todo", adapterId: "source-a" }),
      deleteTask,
    })]))

    // Delete has no link-store input; binding cleanup remains a separate explicit operation.
    await expect(service.deleteTask({}, { adapterId: "source-a", taskId: "1" })).resolves.toBeUndefined()
    expect(deleteTask).toHaveBeenCalledWith({}, { taskId: "1" })
  })
})

describe("github task source", () => {
  test("maps generic status moves to GitHub labels through executor last mile", async () => {
    const issue = {
      number: 123,
      title: "Move me",
      body: null,
      url: "https://github.test/issue/123",
      state: "OPEN" as const,
      labels: [{ name: "needs-triage" }, { name: "bug" }],
    }
    const executor: GitHubIssueExecutor = {
      listIssues: vi.fn(async () => [issue]),
      viewIssue: vi.fn(async () => issue),
      addLabels: vi.fn(async () => undefined),
      removeLabels: vi.fn(async () => undefined),
      closeIssue: vi.fn(async () => undefined),
      reopenIssue: vi.fn(async () => undefined),
    }
    const github = createGitHubTaskSource({ owner: "hachej", repo: "boring-ui", executor })

    await expect(github.moveTask?.({}, { taskId: "123", statusId: "ready-for-agent" })).resolves.toMatchObject({
      id: "123",
      adapterId: "github:hachej/boring-ui",
    })
    expect(executor.removeLabels).toHaveBeenCalledWith({ owner: "hachej", repo: "boring-ui", issueNumber: 123, labels: ["needs-triage"] })
    expect(executor.addLabels).toHaveBeenCalledWith({ owner: "hachej", repo: "boring-ui", issueNumber: 123, labels: ["ready-for-agent"] })
  })

  test("rejects unknown GitHub status before native mutation", async () => {
    const executor: GitHubIssueExecutor = {
      listIssues: vi.fn(async () => []),
      viewIssue: vi.fn(async () => { throw new Error("should not view") }),
      addLabels: vi.fn(async () => undefined),
      removeLabels: vi.fn(async () => undefined),
      closeIssue: vi.fn(async () => undefined),
      reopenIssue: vi.fn(async () => undefined),
    }
    const github = createGitHubTaskSource({ owner: "hachej", repo: "boring-ui", executor })

    await expect(github.moveTask?.({}, { taskId: "123", statusId: "mystery" })).rejects.toBeInstanceOf(TaskSourceServiceError)
    expect(executor.viewIssue).not.toHaveBeenCalled()
  })

  test("auto workspace GitHub source detects the repo from the workspace root", async () => {
    const issue = {
      number: 7,
      title: "Workspace issue",
      body: null,
      url: "https://github.test/acme/project/issues/7",
      state: "OPEN" as const,
      labels: [{ name: "ready-for-human" }],
    }
    const executor: GitHubIssueExecutor = {
      listIssues: vi.fn(async () => [issue]),
      viewIssue: vi.fn(async () => issue),
      addLabels: vi.fn(async () => undefined),
      removeLabels: vi.fn(async () => undefined),
      closeIssue: vi.fn(async () => undefined),
      reopenIssue: vi.fn(async () => undefined),
    }
    const detector = { detectRepository: vi.fn(async () => ({ owner: "acme", repo: "project" })) }
    const executorFactory = vi.fn(() => executor)
    const github = createWorkspaceGitHubTaskSource({ workspaceRoot: "/work/project", detector, executorFactory })

    await expect(github.listTasks({ workspace: { root: "/workspace" } })).resolves.toMatchObject([
      { id: "7", adapterId: "github:workspace", statusId: "ready-for-human" },
    ])
    expect(detector.detectRepository).toHaveBeenCalledWith({ workspaceRoot: "/work/project" })
    expect(executorFactory).toHaveBeenCalledWith({ workspaceRoot: "/work/project", owner: "acme", repo: "project" })
    expect(executor.listIssues).toHaveBeenCalledWith({ owner: "acme", repo: "project", limit: 200, state: "open" })
  })
})
