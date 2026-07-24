import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkspaceAttentionBlocker } from "@hachej/boring-workspace"
import type { BoringTaskCard } from "../shared"
import { taskAttentionKey, useTaskAttention } from "./useTaskAttention"

let blockers: WorkspaceAttentionBlocker[] = []
const { postJson, pluginClient } = vi.hoisted(() => {
  const postJson = vi.fn()
  return { postJson, pluginClient: { postJson } }
})

vi.mock("@hachej/boring-workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hachej/boring-workspace")>()
  return {
    ...actual,
    useWorkspaceAttention: () => ({ blockers }),
    useWorkspacePluginClient: () => pluginClient,
  }
})

const tasks: BoringTaskCard[] = [
  { id: "1", number: "#1", title: "One", statusId: "todo", adapterId: "github" },
  { id: "2", number: "#2", title: "Two", statusId: "todo", adapterId: "github" },
]

function blocker(id: string, sessionId: string): WorkspaceAttentionBlocker {
  return {
    id,
    reason: "plugin.question",
    label: `Question ${id}`,
    sessionId,
    inbox: { kind: "question", sourceLabel: "question", createdAt: "2026-01-01T00:00:00.000Z", artifacts: [] },
  }
}

describe("useTaskAttention", () => {
  beforeEach(() => {
    blockers = []
    postJson.mockReset()
  })

  it("joins generic Inbox blockers to every loaded explicitly linked task", async () => {
    blockers = [blocker("q1", "session-a"), blocker("q2", "session-a")]
    postJson.mockResolvedValueOnce({
      ok: true,
      matches: [{ sessionId: "session-a", tasks: tasks.map((task) => ({ adapterId: task.adapterId, taskId: task.id, number: task.number, title: task.title, statusId: task.statusId })) }],
      omittedSessionIds: [],
    })
    const { result } = renderHook(() => useTaskAttention(tasks))
    await waitFor(() => expect(result.current.get(taskAttentionKey(tasks[0]!))).toHaveLength(2))
    expect(result.current.get(taskAttentionKey(tasks[1]!))?.map((item) => item.id)).toEqual(["q1", "q2"])
    expect(postJson).toHaveBeenCalledWith("/api/boring-tasks/sessions/tasks", { sessionIds: ["session-a"] })

    postJson.mockResolvedValueOnce({ ok: true, matches: [], omittedSessionIds: ["session-a"] })
    window.dispatchEvent(new Event("boring-workspace:task-provenance-changed"))
    await waitFor(() => expect(postJson).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.size).toBe(0))
  })

  it("clears resolved blockers and treats denied/unavailable provenance as no attention", async () => {
    blockers = [blocker("q1", "denied")]
    postJson.mockResolvedValue({ ok: true, matches: [], omittedSessionIds: ["denied"] })
    const { result, rerender } = renderHook(() => useTaskAttention(tasks))
    await waitFor(() => expect(postJson).toHaveBeenCalledTimes(1))
    expect(result.current.size).toBe(0)

    blockers = []
    rerender()
    await waitFor(() => expect(result.current.size).toBe(0))

    blockers = [blocker("q2", "session-error")]
    postJson.mockRejectedValue(new Error("Tasks unavailable"))
    rerender()
    await waitFor(() => expect(postJson).toHaveBeenCalledTimes(2))
    expect(result.current.size).toBe(0)
  })
})
