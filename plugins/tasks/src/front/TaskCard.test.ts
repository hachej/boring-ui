import { describe, expect, it, vi } from "vitest"
import type { WorkspacePluginClient } from "@hachej/boring-workspace"
import type { WorkspaceShellCapabilities } from "@hachej/boring-workspace/plugin"
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

function shell(): WorkspaceShellCapabilities {
  return {
    openArtifact: vi.fn(),
    openDetachedChat: vi.fn(() => ({ success: true as const })),
    openFullChat: vi.fn(),
    openInboxItem: vi.fn(),
  }
}

describe("task native session creation handoff", () => {
  it("mints, binds, then opens one addressed native session", async () => {
    const target = shell()
    const postJson = vi.fn()
      .mockResolvedValueOnce({ agentTypeId: "alpha", sessionId: "native-pi-exact" })
      .mockResolvedValueOnce({ ok: true })
    const deleteJson = vi.fn()

    await expect(createLinkedTaskChat(task, anchor, target, {
      agentTypeId: "alpha",
      postJson: postJson as WorkspacePluginClient["postJson"],
      deleteJson: deleteJson as WorkspacePluginClient["deleteJson"],
    })).resolves.toEqual({ success: true })

    expect(postJson.mock.calls).toEqual([
      ["/api/v1/agents/alpha/sessions", { title: "#776: Task session binding" }],
      ["/api/boring-tasks/sessions/link", {
        adapterId: "github:workspace",
        taskId: "opaque-task-id",
        agentTypeId: "alpha",
        sessionId: "native-pi-exact",
      }],
    ])
    expect(target.openDetachedChat).toHaveBeenCalledWith(
      { agentTypeId: "alpha", sessionId: "native-pi-exact" },
      expect.objectContaining({ composingEnabled: true }),
    )
    expect(deleteJson).not.toHaveBeenCalled()
  })

  it("rejects create responses that do not preserve canonical Agent ownership", async () => {
    const postJson = vi.fn().mockResolvedValueOnce({ sessionId: "native-without-owner" })
    const deleteJson = vi.fn(async () => undefined)
    const target = shell()

    await expect(createLinkedTaskChat(task, anchor, target, {
      agentTypeId: "alpha",
      postJson: postJson as WorkspacePluginClient["postJson"],
      deleteJson: deleteJson as WorkspacePluginClient["deleteJson"],
    })).rejects.toThrow("invalid addressed session")
    expect(postJson).toHaveBeenCalledTimes(1)
    expect(deleteJson).toHaveBeenCalledWith("/api/v1/agents/alpha/sessions/native-without-owner")
    expect(target.openDetachedChat).not.toHaveBeenCalled()
  })

  it("deletes the new empty session when durable task binding fails", async () => {
    const postJson = vi.fn()
      .mockResolvedValueOnce({ agentTypeId: "alpha", sessionId: "native-pi-exact" })
      .mockRejectedValueOnce(new Error("link failed"))
    const deleteJson = vi.fn(async () => undefined)

    await expect(createLinkedTaskChat(task, anchor, shell(), {
      agentTypeId: "alpha",
      postJson: postJson as WorkspacePluginClient["postJson"],
      deleteJson: deleteJson as WorkspacePluginClient["deleteJson"],
    })).rejects.toThrow("link failed")
    expect(deleteJson).toHaveBeenCalledWith("/api/v1/agents/alpha/sessions/native-pi-exact")
  })
})
