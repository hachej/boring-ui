import { beforeEach, describe, expect, it, vi } from "vitest"
import { waitFor } from "@testing-library/react"
import type { WorkspacePluginClient } from "@hachej/boring-workspace"
import { WORKSPACE_CHAT_PROMPT_ACCEPTED_EVENT } from "@hachej/boring-workspace/plugin"
import { resumePendingTaskChatBindings } from "./pendingTaskChatBindings"

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

beforeEach(() => window.sessionStorage.clear())

describe("pending task chat binding recovery", () => {
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
      detail: { agentTypeId: "alpha", sessionId: "another", clientNonce: "wrong" },
    }))
    expect(api.postJson).not.toHaveBeenCalled()
    window.dispatchEvent(new CustomEvent(WORKSPACE_CHAT_PROMPT_ACCEPTED_EVENT, {
      detail: { agentTypeId: "alpha", sessionId: "native-exact", clientNonce: "accepted" },
    }))
    await waitFor(() => expect(api.postJson).toHaveBeenCalledOnce())
  })
})
