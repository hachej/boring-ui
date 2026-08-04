import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { MobileChatBar, MobileSingleChatPane, MobileWorkspaceBar } from "../mobileShell"

describe("mobile chat chrome", () => {
  it("keeps the top bar concise and safe-area aware", () => {
    render(
      <MobileChatBar
        canOpenNav
        canOpenWorkspace
        onOpenNav={() => {}}
        onOpenWorkspace={() => {}}
      />,
    )

    const bar = screen.getByText("Chat").closest('[data-boring-workspace-part="mobile-chat-bar"]')
    expect(bar?.className).toContain("env(safe-area-inset-top)")
    expect(screen.queryByText("One active thread on mobile")).toBeNull()
  })

  it("omits close for the sole pane and keeps a touch target when multiple panes exist", () => {
    const onClosePane = vi.fn()
    const { rerender } = render(
      <MobileSingleChatPane
        pane={{ id: "pane-a", title: "Planning" }}
        totalPanes={1}
        onClosePane={onClosePane}
        renderPane={() => <div>Transcript</div>}
      />,
    )

    expect(screen.queryByRole("button", { name: "Close Planning pane" })).toBeNull()
    rerender(
      <MobileSingleChatPane
        pane={{ id: "pane-a", title: "Planning" }}
        totalPanes={2}
        onClosePane={onClosePane}
        renderPane={() => <div>Transcript</div>}
      />,
    )
    const close = screen.getByRole("button", { name: "Close Planning pane" })
    expect(close.className).toContain("size-11")
    fireEvent.click(close)
    expect(onClosePane).toHaveBeenCalledWith("pane-a")
  })

  it("normalizes machine UUID titles to New chat", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000"
    render(
      <MobileSingleChatPane
        pane={{ id, title: id }}
        totalPanes={1}
        onClosePane={() => {}}
        renderPane={() => <div>Transcript</div>}
      />,
    )

    expect(screen.getByText("New chat")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Close New chat pane" })).toBeNull()
  })

  it("keeps the workspace return bar concise", () => {
    render(<MobileWorkspaceBar onBack={() => {}} />)
    expect(screen.getByText("Workspace")).toBeTruthy()
    expect(screen.queryByText("One active panel on mobile")).toBeNull()
  })
})
