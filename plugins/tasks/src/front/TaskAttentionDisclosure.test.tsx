import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import type { WorkspaceShellCapabilities } from "@hachej/boring-workspace/plugin"
import { TaskAttentionDisclosure } from "./TaskAttentionDisclosure"
import type { TaskAttentionItem } from "./useTaskAttention"

function shell(): WorkspaceShellCapabilities {
  return {
    openArtifact: vi.fn(() => ({ success: true as const })),
    openDetachedChat: vi.fn(() => ({ success: true as const })),
    openFullChat: vi.fn(() => ({ success: true as const })),
    openInboxItem: vi.fn(() => ({ success: true as const })),
    revealWorkspacePath: vi.fn(() => ({ success: true as const })),
    openBrowserLocalDetachedChat: vi.fn(() => ({ success: true as const })),
  }
}

const items: TaskAttentionItem[] = [
  { id: "q1", title: "Choose region", kind: "question", sessionId: "native-1", createdAt: new Date().toISOString(), blocker: { id: "q1", reason: "question" } },
  { id: "q2", title: "Approve release", kind: "approval", sessionId: "native-2", blocker: { id: "q2", reason: "approval" } },
]

describe("TaskAttentionDisclosure", () => {
  it("renders a calm count and opens exact Inbox/chat only after explicit expansion", async () => {
    const user = userEvent.setup()
    const capabilities = shell()
    render(<TaskAttentionDisclosure items={items} shell={capabilities} />)

    expect(screen.getByRole("button", { name: "Needs you · 2" })).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText("Choose region")).not.toBeInTheDocument()
    expect(capabilities.openInboxItem).not.toHaveBeenCalled()
    expect(capabilities.openDetachedChat).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Needs you · 2" }))
    expect(screen.getByText("Choose region")).toBeInTheDocument()
    expect(screen.getAllByText("Open in Inbox")).toHaveLength(2)
    expect(screen.getByText("question")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Open Inbox item Choose region" }))
    expect(capabilities.openInboxItem).toHaveBeenCalledWith("q1")
    await user.click(screen.getByRole("button", { name: "Open chat for Approve release" }))
    expect(capabilities.openDetachedChat).toHaveBeenCalledWith("native-2", { title: "Approve release" })
  })

  it("renders nothing for informational runs without Attention blockers", () => {
    const { container } = render(<TaskAttentionDisclosure items={[]} shell={shell()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
