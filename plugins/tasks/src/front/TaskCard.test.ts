import { describe, expect, it, vi } from "vitest"
import { waitFor } from "@testing-library/react"
import type { WorkspacePluginClient } from "@hachej/boring-workspace"
import {
  WORKSPACE_CHAT_PROMPT_ACCEPTED_EVENT,
  type WorkspaceShellCapabilities,
} from "@hachej/boring-workspace/plugin"
import type { BoringTaskCard } from "../shared"
import { createLinkedTaskChat } from "./TaskCard"

const task: BoringTaskCard = {
  id: "opaque-task-id",
  number: "#776",
  title: "Task session binding",
  statusId: "ready",
  adapterId: "github:workspace",
}
const anchor = { x: 0, y: 0, width: 10, height: 10, top: 0, right: 10, bottom: 10, left: 0 }

function shell(overrides: Partial<WorkspaceShellCapabilities> = {}): WorkspaceShellCapabilities {
  return {
    openArtifact: vi.fn(),
    createChatSession: vi.fn(async () => ({ success: true as const, ref: { agentTypeId: "alpha", sessionId: "native-pi-exact" } })),
    deleteChatSession: vi.fn(async () => ({ success: true as const })),
    openDetachedChat: vi.fn(() => ({ success: true as const })),
    openFullChat: vi.fn(),
    openInboxItem: vi.fn(),
    ...overrides,
  }
}

function client(postJson = vi.fn(), deleteJson = vi.fn()) {
  return {
    value: {
      workspaceId: "workspace",
      agentTypeId: "alpha",
      postJson: postJson as WorkspacePluginClient["postJson"],
      deleteJson: deleteJson as WorkspacePluginClient["deleteJson"],
    },
    postJson,
    deleteJson,
  }
}

function promptAccepted(agentTypeId = "alpha", sessionId = "native-pi-exact") {
  window.dispatchEvent(new CustomEvent(WORKSPACE_CHAT_PROMPT_ACCEPTED_EVENT, {
    detail: { workspaceId: "workspace", agentTypeId, sessionId, clientNonce: "nonce-1" },
  }))
}

describe("task native session creation handoff", () => {
  it("publishes the canonical session immediately but binds only after its first accepted prompt", async () => {
    const target = shell()
    const api = client(vi.fn().mockResolvedValue({ ok: true }))

    await expect(createLinkedTaskChat(task, anchor, target, api.value)).resolves.toEqual({ success: true })

    expect(target.createChatSession).toHaveBeenCalledWith({ title: "#776: Task session binding" })
    expect(target.openDetachedChat).toHaveBeenCalledWith(
      { agentTypeId: "alpha", sessionId: "native-pi-exact" },
      expect.objectContaining({ composingEnabled: true }),
    )
    expect(api.postJson).not.toHaveBeenCalled()

    promptAccepted("alpha", "another-session")
    expect(api.postJson).not.toHaveBeenCalled()
    promptAccepted()
    await waitFor(() => expect(api.postJson).toHaveBeenCalledWith("/api/boring-tasks/sessions/link", {
      adapterId: "github:workspace",
      taskId: "opaque-task-id",
      agentTypeId: "alpha",
      sessionId: "native-pi-exact",
    }))
    promptAccepted()
    expect(api.postJson).toHaveBeenCalledTimes(1)
  })

  it("deletes a canonical create result that does not preserve Agent ownership", async () => {
    const target = shell({
      createChatSession: vi.fn(async () => ({ success: true as const, ref: { agentTypeId: "beta", sessionId: "native-other" } })),
    })
    const api = client(vi.fn(), vi.fn(async () => undefined))

    await expect(createLinkedTaskChat(task, anchor, target, api.value)).rejects.toThrow("invalid addressed session")
    expect(target.deleteChatSession).toHaveBeenCalledWith({ agentTypeId: "beta", sessionId: "native-other" })
    expect(api.deleteJson).not.toHaveBeenCalled()
    expect(target.openDetachedChat).not.toHaveBeenCalled()
  })

  it("deletes and reconciles an empty session when detached placement fails", async () => {
    const target = shell({
      openDetachedChat: vi.fn(() => ({ success: false as const, reason: "placement-failed" as const, message: "no room" })),
    })
    const api = client(vi.fn(), vi.fn(async () => undefined))

    await expect(createLinkedTaskChat(task, anchor, target, api.value)).resolves.toMatchObject({ success: false })
    expect(api.postJson).not.toHaveBeenCalled()
    expect(target.deleteChatSession).toHaveBeenCalledWith({ agentTypeId: "alpha", sessionId: "native-pi-exact" })
    expect(api.deleteJson).not.toHaveBeenCalled()
    promptAccepted()
    expect(api.postJson).not.toHaveBeenCalled()
  })

  it("surfaces a failed shell-owned rollback after detached placement failure", async () => {
    const target = shell({
      openDetachedChat: vi.fn(() => ({ success: false as const, reason: "placement-failed" as const, message: "no room" })),
      deleteChatSession: vi.fn(async () => ({ success: false as const, reason: "open-failed" as const, message: "delete denied" })),
    })
    const api = client()

    await expect(createLinkedTaskChat(task, anchor, target, api.value)).rejects.toThrow("Task chat rollback failed: delete denied")
  })

  it("does not open a chat when canonical creation fails", async () => {
    const target = shell({
      createChatSession: vi.fn(async () => ({ success: false as const, reason: "create-failed" as const, message: "unavailable" })),
    })
    const api = client()

    await expect(createLinkedTaskChat(task, anchor, target, api.value)).rejects.toThrow("unavailable")
    expect(target.openDetachedChat).not.toHaveBeenCalled()
    expect(api.deleteJson).not.toHaveBeenCalled()
  })
})
