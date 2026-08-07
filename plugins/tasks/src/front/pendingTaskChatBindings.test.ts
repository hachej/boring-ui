import { beforeEach, describe, expect, it, vi } from "vitest"
import { waitFor } from "@testing-library/react"
import { WorkspacePluginClientRequestError, type WorkspacePluginClient } from "@hachej/boring-workspace"
import { WORKSPACE_CHAT_PROMPT_ACCEPTED_EVENT } from "@hachej/boring-workspace/plugin"
import { registerPendingTaskChatBinding, resetPendingTaskChatBindingsForTests, resumePendingTaskChatBindings } from "./pendingTaskChatBindings"

const storageKey = "boring-tasks:pending-chat-bindings:v1"
const pending = {
  workspaceId: "workspace-a",
  adapterId: "github:workspace",
  taskId: "776",
  agentTypeId: "alpha",
  sessionId: "native-exact",
}

function client(turnCount: number) {
  const postJson = vi.fn(async () => ({ ok: true }))
  return {
    value: {
      workspaceId: "workspace-a",
      agentTypeId: "alpha",
      getJson: vi.fn(async () => ({ summary: { turnCount } })) as WorkspacePluginClient["getJson"],
      postJson: postJson as WorkspacePluginClient["postJson"],
    },
    postJson,
  }
}

beforeEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  resetPendingTaskChatBindingsForTests()
  window.sessionStorage.clear()
})

describe("pending task chat binding recovery", () => {
  it("uses the latest plugin client when a pending binding outlives its provider", async () => {
    const first = client(0)
    const latest = client(0)
    registerPendingTaskChatBinding(pending, first.value)
    registerPendingTaskChatBinding(pending, latest.value)

    window.dispatchEvent(new CustomEvent(WORKSPACE_CHAT_PROMPT_ACCEPTED_EVENT, {
      detail: { workspaceId: "workspace-a", agentTypeId: "alpha", sessionId: "native-exact", clientNonce: "accepted" },
    }))

    await waitFor(() => expect(latest.postJson).toHaveBeenCalledOnce())
    expect(first.postJson).not.toHaveBeenCalled()
  })

  it("does not accept a colliding addressed session event from another workspace", async () => {
    const api = client(0)
    registerPendingTaskChatBinding(pending, api.value)

    window.dispatchEvent(new CustomEvent(WORKSPACE_CHAT_PROMPT_ACCEPTED_EVENT, {
      detail: { workspaceId: "workspace-b", agentTypeId: "alpha", sessionId: "native-exact", clientNonce: "other-workspace" },
    }))
    window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
      detail: { workspaceId: "workspace-b", agentTypeId: "alpha", sessionId: "native-exact", working: true },
    }))
    await Promise.resolve()

    expect(api.postJson).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem(storageKey)).toBe(JSON.stringify([pending]))
  })

  it("does not restore a stale client when a replaced provider reaches capped recovery", async () => {
    vi.useFakeTimers()
    const first = client(0)
    first.postJson.mockRejectedValue(new TypeError("old client offline"))
    const latest = client(0)
    latest.postJson.mockRejectedValue(new TypeError("service unavailable"))
    registerPendingTaskChatBinding(pending, first.value)
    window.dispatchEvent(new CustomEvent(WORKSPACE_CHAT_PROMPT_ACCEPTED_EVENT, {
      detail: { workspaceId: "workspace-a", agentTypeId: "alpha", sessionId: "native-exact", clientNonce: "accepted" },
    }))
    await Promise.resolve()
    await Promise.resolve()
    expect(first.postJson).toHaveBeenCalledOnce()

    registerPendingTaskChatBinding(pending, latest.value)
    await vi.runAllTimersAsync()
    expect(first.postJson).toHaveBeenCalledOnce()
    expect(latest.postJson).toHaveBeenCalledTimes(5)

    latest.postJson.mockResolvedValue({ ok: true })
    window.dispatchEvent(new Event("focus"))
    await vi.runAllTimersAsync()
    expect(latest.postJson).toHaveBeenCalledTimes(6)
    expect(window.sessionStorage.getItem(storageKey)).toBe("[]")
  })

  it("binds accepted in-memory intent when sessionStorage is unavailable", async () => {
    const api = client(0)
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage unavailable") })
    registerPendingTaskChatBinding(pending, api.value)

    window.dispatchEvent(new CustomEvent(WORKSPACE_CHAT_PROMPT_ACCEPTED_EVENT, {
      detail: { workspaceId: "workspace-a", agentTypeId: "alpha", sessionId: "native-exact", clientNonce: "accepted" },
    }))

    await waitFor(() => expect(api.postJson).toHaveBeenCalledOnce())
  })

  it("binds a persisted intent after reload when the exact session already has a turn", async () => {
    window.sessionStorage.setItem(storageKey, JSON.stringify([pending]))
    const api = client(1)

    resumePendingTaskChatBindings(api.value)

    await waitFor(() => expect(api.postJson).toHaveBeenCalledWith("/api/boring-tasks/sessions/link", {
      adapterId: "github:workspace",
      taskId: "776",
      agentTypeId: "alpha",
      sessionId: "native-exact",
    }))
    expect(window.sessionStorage.getItem(storageKey)).toBe("[]")
  })

  it("keeps an empty recovered session provisional until its exact prompt is accepted", async () => {
    window.sessionStorage.setItem(storageKey, JSON.stringify([pending]))
    const api = client(0)

    resumePendingTaskChatBindings(api.value)
    await Promise.resolve()
    expect(api.postJson).not.toHaveBeenCalled()
    window.dispatchEvent(new CustomEvent(WORKSPACE_CHAT_PROMPT_ACCEPTED_EVENT, {
      detail: { workspaceId: "workspace-a", agentTypeId: "alpha", sessionId: "another", clientNonce: "wrong" },
    }))
    expect(api.postJson).not.toHaveBeenCalled()
    window.dispatchEvent(new CustomEvent(WORKSPACE_CHAT_PROMPT_ACCEPTED_EVENT, {
      detail: { workspaceId: "workspace-a", agentTypeId: "alpha", sessionId: "native-exact", clientNonce: "accepted" },
    }))
    await waitFor(() => expect(api.postJson).toHaveBeenCalledOnce())
  })

  it("binds from Workspace activity when the detached chat closes before its prompt response", async () => {
    window.sessionStorage.setItem(storageKey, JSON.stringify([pending]))
    const api = client(0)

    resumePendingTaskChatBindings(api.value)
    window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
      detail: { workspaceId: "workspace-a", agentTypeId: "alpha", sessionId: "native-exact", working: true },
    }))

    await waitFor(() => expect(api.postJson).toHaveBeenCalledOnce())
    expect(window.sessionStorage.getItem(storageKey)).toBe("[]")
  })

  it("binds two task intents that deliberately share one accepted session", async () => {
    const second = { ...pending, adapterId: "beads:workspace", taskId: "bead-2" }
    window.sessionStorage.setItem(storageKey, JSON.stringify([pending, second]))
    const api = client(0)

    resumePendingTaskChatBindings(api.value)
    window.dispatchEvent(new CustomEvent(WORKSPACE_CHAT_PROMPT_ACCEPTED_EVENT, {
      detail: { workspaceId: "workspace-a", agentTypeId: "alpha", sessionId: "native-exact", clientNonce: "accepted" },
    }))

    await waitFor(() => expect(api.postJson).toHaveBeenCalledTimes(2))
    const calls = api.postJson.mock.calls as unknown as Array<[string, unknown]>
    expect(calls.map(([, body]) => body)).toEqual(expect.arrayContaining([
      expect.objectContaining({ adapterId: "github:workspace", taskId: "776" }),
      expect.objectContaining({ adapterId: "beads:workspace", taskId: "bead-2" }),
    ]))
    expect(window.sessionStorage.getItem(storageKey)).toBe("[]")
  })

  it("drops terminal binding failures instead of retrying forever", async () => {
    window.sessionStorage.setItem(storageKey, JSON.stringify([pending]))
    const api = client(1)
    api.postJson.mockRejectedValue(new WorkspacePluginClientRequestError("forbidden", 403))

    resumePendingTaskChatBindings(api.value)

    await waitFor(() => expect(api.postJson).toHaveBeenCalledOnce())
    expect(window.sessionStorage.getItem(storageKey)).toBe("[]")
  })

  it("caps transient retries without discarding accepted binding intent", async () => {
    vi.useFakeTimers()
    window.sessionStorage.setItem(storageKey, JSON.stringify([pending]))
    const api = client(1)
    api.postJson.mockRejectedValue(new TypeError("network unavailable"))

    resumePendingTaskChatBindings(api.value)
    await vi.runAllTimersAsync()

    expect(api.postJson).toHaveBeenCalledTimes(6)
    expect(window.sessionStorage.getItem(storageKey)).toBe(JSON.stringify([pending]))

    api.postJson.mockResolvedValue({ ok: true })
    window.dispatchEvent(new Event("focus"))
    await vi.runAllTimersAsync()
    expect(api.postJson).toHaveBeenCalledTimes(7)
    expect(window.sessionStorage.getItem(storageKey)).toBe("[]")
  })

  it("keeps one capped retry chain when recovery races prompt acceptance", async () => {
    vi.useFakeTimers()
    window.sessionStorage.setItem(storageKey, JSON.stringify([pending]))
    let resolveSnapshot!: (snapshot: { summary: { turnCount: number } }) => void
    const postJson = vi.fn(async () => { throw new TypeError("network unavailable") })
    const api = {
      workspaceId: "workspace-a",
      agentTypeId: "alpha",
      getJson: vi.fn(() => new Promise((resolve) => { resolveSnapshot = resolve })) as WorkspacePluginClient["getJson"],
      postJson: postJson as WorkspacePluginClient["postJson"],
    }

    resumePendingTaskChatBindings(api)
    window.dispatchEvent(new CustomEvent(WORKSPACE_CHAT_PROMPT_ACCEPTED_EVENT, {
      detail: { workspaceId: "workspace-a", agentTypeId: "alpha", sessionId: "native-exact", clientNonce: "accepted" },
    }))
    await Promise.resolve()
    resolveSnapshot({ summary: { turnCount: 1 } })
    await vi.runAllTimersAsync()

    expect(postJson).toHaveBeenCalledTimes(6)
    expect(window.sessionStorage.getItem(storageKey)).toBe(JSON.stringify([pending]))
  })
})
