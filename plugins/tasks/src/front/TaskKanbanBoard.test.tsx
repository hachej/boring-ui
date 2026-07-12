// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BoringTaskAdapter } from "../shared"
import { TaskKanbanBoard } from "./TaskKanbanBoard"

const postJson = vi.fn()
const getJson = vi.fn()
const openDetachedChat = vi.fn()
const pluginClient = { postJson, getJson }

vi.mock("@hachej/boring-workspace", () => ({
  useWorkspacePluginClient: () => pluginClient,
}))

vi.mock("@hachej/boring-workspace/plugin", () => ({
  useWorkspaceShellCapabilities: () => ({ openArtifact: vi.fn(), openDetachedChat }),
}))

function adapter(): BoringTaskAdapter {
  return {
    id: "github",
    label: "GitHub",
    capabilities: { move: false, delete: false },
    getBoardConfig: async () => ({ adapterId: "github", columns: [{ id: "ready", title: "Ready" }] }),
    listTasks: async () => [
      { id: "task-a", number: "#1", title: "Task A", statusId: "ready", adapterId: "github" },
      { id: "task-b", number: "#2", title: "Task B", statusId: "ready", adapterId: "github" },
    ],
  }
}

beforeEach(() => {
  postJson.mockReset()
  getJson.mockReset()
  openDetachedChat.mockReset()
  window.localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("TaskKanbanBoard task session activity", () => {
  it("pools card activity polling into one board-level request and does not overlap intervals", async () => {
    vi.useFakeTimers()
    const activityRequests: string[][] = []
    let resolveActivity: ((value: unknown) => void) | undefined
    postJson.mockImplementation((path: string, body: { taskId?: string; sessionIds?: string[] }) => {
      if (path === "/api/boring-tasks/sessions/list") {
        return Promise.resolve({
          links: [{
            id: `link-${body.taskId}`,
            workspaceId: "workspace-a",
            adapterId: "github",
            taskId: body.taskId,
            sessionId: body.taskId === "task-a" ? "pi-a" : "pi-b",
            title: body.taskId === "task-a" ? "Chat A" : "Chat B",
            createdAt: "2026-07-01T00:00:00.000Z",
          }],
        })
      }
      if (path === "/api/v1/agent/pi-chat/sessions/activity") {
        activityRequests.push(body.sessionIds ?? [])
        return new Promise((resolve) => { resolveActivity = resolve })
      }
      return Promise.reject(new Error(`unexpected post ${path}`))
    })

    const view = render(<TaskKanbanBoard adapters={[adapter()]} />)
    for (let index = 0; index < 5; index += 1) {
      await act(async () => { await Promise.resolve() })
    }
    expect(screen.getByText("Task A")).toBeInTheDocument()
    expect(screen.getByText("Task B")).toBeInTheDocument()
    expect(postJson.mock.calls.filter(([path]) => path === "/api/boring-tasks/sessions/list")).toHaveLength(2)

    await act(async () => { await vi.advanceTimersByTimeAsync(25) })
    expect(activityRequests).toEqual([["pi-a", "pi-b"]])

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(activityRequests).toHaveLength(1)

    view.unmount()
    resolveActivity?.({ activities: [{ sessionId: "pi-a", status: "working", source: "live-runtime" }], omittedSessionIds: [] })
    await act(async () => { await Promise.resolve(); await vi.advanceTimersByTimeAsync(60_000) })
    expect(activityRequests).toHaveLength(1)
  })
})
