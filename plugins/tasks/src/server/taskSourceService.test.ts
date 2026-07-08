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
      code: "TASK_SOURCE_NOT_FOUND",
    })
  })

  test("enforces move capability at source boundary", async () => {
    const service = createTaskSourceService(createTaskSourceRegistry([source({
      summary: () => ({ id: "source-a", label: "Source A", capabilities: { move: false } }),
      moveTask: undefined,
    })]))
    await expect(service.moveTask({}, { sourceId: "source-a", taskId: "1", statusId: "todo" })).rejects.toMatchObject({
      status: 409,
      code: "TASK_SOURCE_MOVE_UNSUPPORTED",
    })
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
      labels: [{ name: "state:queued" }, { name: "bug" }],
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

    await expect(github.moveTask?.({}, { taskId: "123", statusId: "active" })).resolves.toMatchObject({
      id: "123",
      adapterId: "github:hachej/boring-ui",
    })
    expect(executor.removeLabels).toHaveBeenCalledWith({ owner: "hachej", repo: "boring-ui", issueNumber: 123, labels: ["state:queued"] })
    expect(executor.addLabels).toHaveBeenCalledWith({ owner: "hachej", repo: "boring-ui", issueNumber: 123, labels: ["state:active"] })
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
      labels: [{ name: "state:ready" }],
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
    const github = createWorkspaceGitHubTaskSource({ detector, executorFactory })

    await expect(github.listTasks({ workspaceRoot: "/work/project" })).resolves.toMatchObject([
      { id: "7", adapterId: "github:workspace", statusId: "ready" },
    ])
    expect(detector.detectRepository).toHaveBeenCalledWith({ workspaceRoot: "/work/project" })
    expect(executorFactory).toHaveBeenCalledWith({ workspaceRoot: "/work/project", owner: "acme", repo: "project" })
    expect(executor.listIssues).toHaveBeenCalledWith({ owner: "acme", repo: "project", limit: 200, state: "open" })
  })
})
