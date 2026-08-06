// @vitest-environment node

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

  test("isolates a failing source and redacts its raw failure", async () => {
    const healthy = source()
    const failing = source({
      summary: () => ({ id: "source-b", label: "Source B", capabilities: { move: false } }),
      getBoardConfig: () => ({ adapterId: "source-b", columns: [{ id: "open", title: "Open" }] }),
      listTasks: () => { throw new Error("secret stderr from /private/workspace") },
    })
    const service = createTaskSourceService(createTaskSourceRegistry([healthy, failing]))

    await expect(service.listTasks({})).resolves.toEqual({
      configs: { "source-a": { adapterId: "source-a", columns: [{ id: "todo", title: "Todo" }] } },
      tasks: [{ id: "1", number: "1", title: "One", statusId: "todo", adapterId: "source-a" }],
      errors: {
        "source-b": {
          sourceId: "source-b",
          code: "TASK_SOURCE_LIST_FAILED",
          message: "Task source failed to load.",
          retryable: true,
          stale: false,
        },
      },
    })
  })

  test("rejects an explicitly requested unknown source before loading known sources", async () => {
    const listTasks = vi.fn(source().listTasks)
    const service = createTaskSourceService(createTaskSourceRegistry([source({ listTasks })]))
    await expect(service.listTasks({}, { sourceIds: ["source-a", "missing"] })).rejects.toMatchObject({
      status: 404,
      code: "TASK_SOURCE_NOT_FOUND",
    })
    expect(listTasks).not.toHaveBeenCalled()
  })

  test("dispatches generic detail and returns stable unsupported/not-found errors", async () => {
    const detailSource = source({
      summary: () => ({ id: "source-a", label: "Source A", capabilities: { move: false, detail: true } }),
      getTask: (_ctx, input) => input.taskId === "1" ? {
        task: { id: "1", number: "1", title: "One", statusId: "todo", adapterId: "source-a" },
        body: "Full body",
        metadata: [],
        relations: [],
      } : undefined,
    })
    const service = createTaskSourceService(createTaskSourceRegistry([detailSource]))
    await expect(service.getTaskDetail({}, { sourceId: "source-a", taskId: "1" })).resolves.toMatchObject({ body: "Full body" })
    await expect(service.getTaskDetail({}, { sourceId: "source-a", taskId: "missing" })).rejects.toMatchObject({
      status: 404,
      code: "TASK_NOT_FOUND",
      retryable: false,
    })

    const unsupported = createTaskSourceService(createTaskSourceRegistry([source()]))
    await expect(unsupported.getTaskDetail({}, { sourceId: "source-a", taskId: "1" })).rejects.toMatchObject({
      status: 409,
      code: "TASK_SOURCE_DETAIL_UNSUPPORTED",
    })
  })

  test("uses the closed error definition table as status/retry authority", () => {
    expect(new TaskSourceServiceError(500, "TASK_GITHUB_COMMAND_FAILED", "redacted", false)).toMatchObject({
      status: 502,
      retryable: true,
    })
    expect(new TaskSourceServiceError(502, "TASK_SOURCE_ERROR", "redacted", true)).toMatchObject({
      status: 500,
      retryable: true,
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
    const service = createTaskSourceService(createTaskSourceRegistry([source({ getTaskCard: direct })]))
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
    const link = { id: "link", adapterId: "source-a", taskId: "1", agentTypeId: "alpha", sessionId: "native", createdAt: "2026-07-18T00:00:00.000Z" }
    const linkStore = {
      list: vi.fn(async () => [link]),
      listBySessionIds: vi.fn(async (sessionIds: readonly string[]) => new Map(sessionIds.map((sessionId) => [sessionId, sessionId === "native" ? [link] : []]))),
      link: vi.fn(async () => { events.push("link"); return link }),
      unlink: vi.fn(async () => link),
    }
    const service = createTaskSourceService(createTaskSourceRegistry([source({
      getTaskCard: async (_ctx, taskId) => {
        events.push("task")
        return taskId === "1" ? { id: "1", number: "1", title: "One", statusId: "todo", adapterId: "source-a" } : undefined
      },
    })]))
    await expect(service.bindSession({}, { adapterId: "source-a", taskId: "1", sessionId: "native" }, {
      agentTypeId: "alpha",
      linkStore,
      authorizeSession: async () => { events.push("authorize") },
    })).resolves.toEqual(link)
    expect(events).toEqual(["task", "authorize", "link"])
    await expect(service.listSessionLinks({ adapterId: "source-a", taskId: "1" }, { linkStore })).resolves.toEqual([link])
    await expect(service.unlinkSession("link", { linkStore })).resolves.toEqual(link)
  })

  test("reverse-resolves authorized sessions to deterministic exact task summaries", async () => {
    const links = [
      { id: "z", adapterId: "source-a", taskId: "2", agentTypeId: "alpha", sessionId: "native", createdAt: "2026-07-18T00:00:00.000Z" },
      { id: "a", adapterId: "source-a", taskId: "1", agentTypeId: "alpha", sessionId: "native", createdAt: "2026-07-18T00:00:00.000Z" },
      { id: "stale", adapterId: "source-a", taskId: "missing", agentTypeId: "alpha", sessionId: "native", createdAt: "2026-07-18T00:00:00.000Z" },
    ]
    const listBySessionIds = vi.fn(async (sessionIds: readonly string[]) => new Map(sessionIds.map((sessionId) => [sessionId, sessionId === "native" ? links : []])))
    const service = createTaskSourceService(createTaskSourceRegistry([source({
      getTaskCard: async (_ctx, taskId) => taskId === "missing" ? undefined : {
        id: taskId,
        number: `#${taskId}`,
        title: `Task ${taskId}`,
        statusId: taskId === "1" ? "todo" : "done",
        adapterId: "source-a",
        url: `https://example.test/${taskId}`,
      },
    })]))
    const resolution = await service.resolveSessionTasks({}, ["native", "denied", "unlinked"], {
      agentTypeId: "alpha",
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
      getTaskCard: async () => ({ id: "1", number: "1", title: "One", statusId: "todo", adapterId: "source-a" }),
      deleteTask,
    })]))

    // Delete has no link-store input; binding cleanup remains a separate explicit operation.
    await expect(service.deleteTask({}, { adapterId: "source-a", taskId: "1" })).resolves.toBeUndefined()
    expect(deleteTask).toHaveBeenCalledWith({}, { taskId: "1" })
  })
})

describe("github task source", () => {
  test("associates exact issue references without matching longer issue numbers", async () => {
    const issues = [1, 10].map((number) => ({
      number,
      title: `Issue ${number}`,
      body: null,
      url: `https://github.test/issues/${number}`,
      state: "OPEN" as const,
      labels: [],
    }))
    const executor: GitHubIssueExecutor = {
      listIssues: vi.fn(async () => issues),
      listPullRequests: vi.fn(async () => [
        { number: 101, title: "Fix #10", state: "OPEN" },
        { number: 102, title: "Fix #1 exactly", state: "OPEN" },
        { number: 103, title: "URL for ten", body: "https://github.test/issues/10", state: "OPEN" },
        { number: 104, title: "URL for one", body: "https://github.test/issues/1", state: "OPEN" },
      ]),
      viewIssue: vi.fn(async ({ issueNumber }) => issues.find((issue) => issue.number === issueNumber)!),
      addLabels: vi.fn(async () => undefined),
      removeLabels: vi.fn(async () => undefined),
      closeIssue: vi.fn(async () => undefined),
      reopenIssue: vi.fn(async () => undefined),
    }
    const github = createGitHubTaskSource({ owner: "hachej", repo: "boring-ui", executor })

    const tasks = await github.listTasks({})

    expect(tasks.find((task) => task.id === "1")?.pullRequests?.map((pr) => pr.number)).toEqual(["#102", "#104"])
    expect(tasks.find((task) => task.id === "10")?.pullRequests?.map((pr) => pr.number)).toEqual(["#101", "#103"])
  })

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
