import { describe, expect, it, vi } from "vitest"
import type { WorkspacePluginClient } from "@hachej/boring-workspace"
import type { WorkspaceShellCapabilities } from "@hachej/boring-workspace/plugin"
import type { BoringTaskCard } from "../shared"
import { openBrowserLocalTaskChat } from "./TaskCard"

const task: BoringTaskCard = {
  id: "opaque-task-id",
  number: "#776",
  title: "Task session binding",
  statusId: "ready",
  adapterId: "github:workspace",
}

const anchor = { x: 0, y: 0, width: 10, height: 10, top: 0, right: 10, bottom: 10, left: 0 }

describe("task native session creation handoff", () => {
  it("links only after the browser-local chat reports first native persistence", async () => {
    let onNativeSessionPersisted: ((sessionId: string) => void | Promise<void>) | undefined
    const openBrowserLocalDetachedChat = vi.fn((options) => {
      onNativeSessionPersisted = options?.onNativeSessionPersisted
      return { success: true as const }
    })
    const shell = {
      openArtifact: vi.fn(),
      openDetachedChat: vi.fn(),
      openFullChat: vi.fn(),
      openInboxItem: vi.fn(),
      openBrowserLocalDetachedChat,
    } satisfies WorkspaceShellCapabilities
    const postJson = vi.fn(async () => ({ ok: true }))

    expect(openBrowserLocalTaskChat(task, anchor, shell, { postJson: postJson as unknown as WorkspacePluginClient["postJson"] })).toEqual({ success: true })
    expect(postJson).not.toHaveBeenCalled()
    expect(shell.openDetachedChat).not.toHaveBeenCalled()

    await onNativeSessionPersisted!("native-pi-exact")

    expect(postJson).toHaveBeenCalledTimes(1)
    expect(postJson).toHaveBeenCalledWith("/api/boring-tasks/sessions/link", {
      adapterId: "github:workspace",
      taskId: "opaque-task-id",
      sessionId: "native-pi-exact",
    })
  })

  it("falls back to the host event when plugin and host use separate context bundles", () => {
    const postJson = vi.fn(async () => ({ ok: true }))
    const dispatch = vi.spyOn(window, "dispatchEvent")
    const shell = {
      openArtifact: vi.fn(),
      openDetachedChat: vi.fn(),
      openFullChat: vi.fn(),
      openInboxItem: vi.fn(),
      openBrowserLocalDetachedChat: vi.fn(() => ({ success: false as const, reason: "open-failed" as const, message: "unavailable" })),
    } satisfies WorkspaceShellCapabilities

    expect(openBrowserLocalTaskChat(task, anchor, shell, { postJson: postJson as unknown as WorkspacePluginClient["postJson"] })).toEqual({ success: true })
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "boring-workspace:open-browser-local-detached-chat" }))
    expect(postJson).not.toHaveBeenCalled()
    dispatch.mockRestore()
  })

  it("creates no link when a browser-local chat closes unsent", () => {
    const postJson = vi.fn(async () => ({ ok: true }))
    const shell = {
      openArtifact: vi.fn(),
      openDetachedChat: vi.fn(),
      openFullChat: vi.fn(),
      openInboxItem: vi.fn(),
      openBrowserLocalDetachedChat: vi.fn(() => ({ success: true as const })),
    } satisfies WorkspaceShellCapabilities

    openBrowserLocalTaskChat(task, anchor, shell, { postJson: postJson as unknown as WorkspacePluginClient["postJson"] })

    expect(postJson).not.toHaveBeenCalled()
  })
})
