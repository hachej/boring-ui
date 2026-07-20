import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import type { WorkspacePluginClient } from "@hachej/boring-workspace"
import type { WorkspaceShellCapabilities } from "@hachej/boring-workspace/plugin"
import type { BoringTaskCard } from "../shared"
import { TaskArtifactFolderButton } from "./TaskArtifactFolderButton"

const task: BoringTaskCard = {
  id: "776",
  number: "#776",
  title: "Bind task sessions",
  statusId: "ready-for-agent",
  adapterId: "github:workspace",
}

function shell(revealResult: ReturnType<WorkspaceShellCapabilities["revealWorkspacePath"]> = { success: true }): WorkspaceShellCapabilities {
  return {
    openArtifact: vi.fn(() => ({ success: true as const })),
    openDetachedChat: vi.fn(() => ({ success: true as const })),
    openFullChat: vi.fn(() => ({ success: true as const })),
    openInboxItem: vi.fn(() => ({ success: true as const })),
    revealWorkspacePath: vi.fn(() => revealResult),
    openBrowserLocalDetachedChat: vi.fn(() => ({ success: true as const })),
  }
}

describe("TaskArtifactFolderButton", () => {
  it("does nothing until clicked and reveals an existing folder", async () => {
    const user = userEvent.setup()
    const postJson = vi.fn(async () => ({ ok: true, path: "docs/issues/776", exists: true }))
    const shellCapabilities = shell()
    render(<TaskArtifactFolderButton task={task} shell={shellCapabilities} pluginClient={{ postJson: postJson as unknown as WorkspacePluginClient["postJson"] }} />)
    expect(postJson).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Open artifact folder for #776" }))
    expect(postJson).toHaveBeenCalledWith("/api/boring-tasks/artifact-folder/status", {
      adapterId: "github:workspace",
      taskId: "776",
      number: "#776",
    })
    expect(shellCapabilities.revealWorkspacePath).toHaveBeenCalledWith("docs/issues/776")
  })

  it("creates a missing folder only after explicit confirmation", async () => {
    const user = userEvent.setup()
    const postJson = vi.fn()
      .mockResolvedValueOnce({ ok: true, path: "docs/issues/776", exists: false })
      .mockResolvedValueOnce({ ok: true, path: "docs/issues/776", exists: true })
    const shellCapabilities = shell()
    vi.spyOn(window, "confirm").mockReturnValue(true)
    render(<TaskArtifactFolderButton task={task} shell={shellCapabilities} pluginClient={{ postJson: postJson as unknown as WorkspacePluginClient["postJson"] }} />)

    await user.click(screen.getByRole("button", { name: "Open artifact folder for #776" }))
    expect(window.confirm).toHaveBeenCalledWith("Create task folder at “docs/issues/776”?")
    expect(postJson).toHaveBeenNthCalledWith(2, "/api/boring-tasks/artifact-folder/create", {
      adapterId: "github:workspace",
      taskId: "776",
      number: "#776",
    })
    expect(shellCapabilities.revealWorkspacePath).toHaveBeenCalledWith("docs/issues/776")
  })

  it("cancels without creating or revealing", async () => {
    const user = userEvent.setup()
    const postJson = vi.fn(async () => ({ ok: true, path: "docs/issues/776", exists: false }))
    const shellCapabilities = shell()
    vi.spyOn(window, "confirm").mockReturnValue(false)
    render(<TaskArtifactFolderButton task={task} shell={shellCapabilities} pluginClient={{ postJson: postJson as unknown as WorkspacePluginClient["postJson"] }} />)

    await user.click(screen.getByRole("button", { name: "Open artifact folder for #776" }))
    expect(postJson).toHaveBeenCalledTimes(1)
    expect(shellCapabilities.revealWorkspacePath).not.toHaveBeenCalled()
  })

  it("falls back to the validated host event when plugin contexts are disconnected", async () => {
    const user = userEvent.setup()
    const postJson = vi.fn(async () => ({ ok: true, path: "docs/issues/776", exists: true }))
    const dispatch = vi.spyOn(window, "dispatchEvent")
    render(<TaskArtifactFolderButton
      task={task}
      shell={shell({ success: false, reason: "open-failed", message: "disconnected" })}
      pluginClient={{ postJson: postJson as unknown as WorkspacePluginClient["postJson"] }}
    />)

    await user.click(screen.getByRole("button", { name: "Open artifact folder for #776" }))
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "boring-workspace:reveal-workspace-path" })))
    dispatch.mockRestore()
  })
})
