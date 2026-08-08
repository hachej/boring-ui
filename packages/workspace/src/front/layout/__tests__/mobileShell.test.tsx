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

  it("hides the close action when this is the sole remaining pane", () => {
    const onClosePane = vi.fn()
    render(
      <MobileSingleChatPane
        pane={{ id: "pane-a", title: "Planning" }}
        totalPanes={1}
        onClosePane={onClosePane}
        renderPane={() => <div>Transcript</div>}
      />,
    )

    expect(screen.queryByRole("button", { name: "Close Planning pane" })).toBeNull()
  })

  it("uses an accessible touch target for the close action when more than one pane exists", () => {
    const onClosePane = vi.fn()
    render(
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
        totalPanes={2}
        onClosePane={() => {}}
        renderPane={() => <div>Transcript</div>}
      />,
    )

    expect(screen.getByText("New chat")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Close New chat pane" })).toBeTruthy()
  })

  it("keeps the workspace return bar concise", () => {
    render(<MobileWorkspaceBar onBack={() => {}} />)
    expect(screen.getByText("Workspace")).toBeTruthy()
    expect(screen.queryByText("One active panel on mobile")).toBeNull()
  })

  it("tags both chat-bar pills for coarse-pointer target escalation", () => {
    render(<MobileChatBar canOpenNav canOpenWorkspace onOpenNav={() => {}} onOpenWorkspace={() => {}} />)

    for (const name of ["Sessions", "Workspace"]) {
      const pill = screen.getByRole("button", { name })
      expect(pill.className).toContain("mobile-shell-bar-action")
      expect(pill.className).toContain("motion-reduce:transition-none")
      expect(pill.className).toContain("focus-visible:ring-2")
    }
  })

  it("tags the workspace back pill for coarse-pointer target escalation", () => {
    render(<MobileWorkspaceBar onBack={() => {}} />)

    const back = screen.getByRole("button", { name: "Chat" })
    expect(back.className).toContain("mobile-shell-bar-action")
    expect(back.className).toContain("motion-reduce:transition-none")
  })

  it("pads the single-pane header for the status-bar inset", () => {
    render(
      <MobileSingleChatPane pane={{ id: "pane-a", title: "Planning" }} totalPanes={1} renderPane={() => <div>Transcript</div>} />,
    )

    const pane = screen.getByText("Planning").closest('[data-boring-workspace-part="mobile-chat-pane"]')
    const header = pane?.firstElementChild
    expect(header?.className).toContain("env(safe-area-inset-top)")
  })

  it("gives the close action a reduced-motion-safe hover and a focus ring", () => {
    render(
      <MobileSingleChatPane
        pane={{ id: "pane-a", title: "Planning" }}
        totalPanes={2}
        onClosePane={() => {}}
        renderPane={() => <div>Transcript</div>}
      />,
    )

    const close = screen.getByRole("button", { name: "Close Planning pane" })
    expect(close.className).toContain("motion-reduce:transition-none")
    expect(close.className).toContain("focus-visible:ring-2")
  })
})
