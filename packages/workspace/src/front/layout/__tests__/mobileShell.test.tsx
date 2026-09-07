import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { MobileChatBar, MobileSingleChatPane, MobileWorkspaceBar } from "../mobileShell"

describe("mobile chat chrome", () => {
  it("collapses to a single bar: nav pill, the real session title, workspace pill", () => {
    render(
      <MobileChatBar
        pane={{ id: "pane-a", title: "Planning" }}
        totalPanes={1}
        canOpenNav
        canOpenWorkspace
        onOpenNav={() => {}}
        onOpenWorkspace={() => {}}
      />,
    )

    const bar = document.querySelector('[data-boring-workspace-part="mobile-chat-bar"]')
    expect(bar).toBeTruthy()
    // The static "Chat" label used to sit between two copies of the real title.
    expect(screen.queryByText("Chat")).toBeNull()
    expect(screen.getByText("Planning")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Sessions" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Workspace" })).toBeTruthy()
  })

  it("carries the status-bar inset exactly once, on the bar itself", () => {
    render(
      <>
        <MobileChatBar
          pane={{ id: "pane-a", title: "Planning" }}
          totalPanes={1}
          canOpenNav={false}
          canOpenWorkspace={false}
          onOpenWorkspace={() => {}}
        />
        <MobileSingleChatPane pane={{ id: "pane-a", title: "Planning" }} renderPane={() => <div>Transcript</div>} />
      </>,
    )

    const bar = document.querySelector('[data-boring-workspace-part="mobile-chat-bar"]')
    expect(bar?.className).toContain("--sa-top")

    // The pane below the bar owns no header at all any more, so it cannot
    // re-apply the top inset under the bar that already applied it.
    const pane = document.querySelector('[data-boring-workspace-part="mobile-chat-pane"]')
    expect(pane?.className ?? "").not.toContain("--sa-top")
    for (const node of Array.from(pane?.querySelectorAll("*") ?? [])) {
      expect(node.className.toString()).not.toContain("--sa-top")
    }
  })

  it("reserves the leading gutter from the shared token on both bars", () => {
    const { unmount } = render(
      <MobileChatBar canOpenNav={false} canOpenWorkspace={false} onOpenWorkspace={() => {}} />,
    )
    const chatBar = document.querySelector('[data-boring-workspace-part="mobile-chat-bar"]')
    expect(chatBar?.className).toContain("--mobile-header-inset-start")
    expect(chatBar?.className).toContain("min-h-[var(--mobile-bar-height,3rem)]")
    unmount()

    render(<MobileWorkspaceBar onBack={() => {}} />)
    const workspaceBar = document.querySelector('[data-boring-workspace-part="mobile-workspace-bar"]')
    expect(workspaceBar?.className).toContain("--mobile-header-inset-start")
    expect(workspaceBar?.className).toContain("min-h-[var(--mobile-bar-height,3rem)]")
  })

  it("falls back to a generic title when no chat pane is open", () => {
    render(<MobileChatBar canOpenNav={false} canOpenWorkspace={false} onOpenWorkspace={() => {}} />)
    expect(screen.getByText("Chat")).toBeTruthy()
  })

  it("hides the close action when this is the sole remaining pane", () => {
    const onClosePane = vi.fn()
    render(
      <MobileChatBar
        pane={{ id: "pane-a", title: "Planning" }}
        totalPanes={1}
        canOpenNav={false}
        canOpenWorkspace={false}
        onOpenWorkspace={() => {}}
        onClosePane={onClosePane}
      />,
    )

    expect(screen.queryByRole("button", { name: "Close Planning pane" })).toBeNull()
  })

  it("uses an accessible touch target for the close action when more than one pane exists", () => {
    const onClosePane = vi.fn()
    render(
      <MobileChatBar
        pane={{ id: "pane-a", title: "Planning" }}
        totalPanes={2}
        canOpenNav={false}
        canOpenWorkspace={false}
        onOpenWorkspace={() => {}}
        onClosePane={onClosePane}
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
      <MobileChatBar
        pane={{ id, title: id }}
        totalPanes={2}
        canOpenNav={false}
        canOpenWorkspace={false}
        onOpenWorkspace={() => {}}
        onClosePane={() => {}}
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

  it("gives every bar pill a resting fill, a pressed state and a focus ring", () => {
    const { unmount } = render(
      <MobileChatBar canOpenNav canOpenWorkspace onOpenNav={() => {}} onOpenWorkspace={() => {}} />,
    )

    for (const name of ["Sessions", "Workspace"]) {
      const pill = screen.getByRole("button", { name })
      expect(pill.className).toContain("mobile-shell-bar-action")
      expect(pill.className).toContain("bg-muted/60")
      expect(pill.className).toContain("active:bg-muted")
      expect(pill.className).toContain("active:scale-[0.97]")
      expect(pill.className).toContain("motion-reduce:transition-none")
      expect(pill.className).toContain("focus-visible:ring-2")
    }
    unmount()

    render(<MobileWorkspaceBar onBack={() => {}} />)
    const back = screen.getByRole("button", { name: "Chat" })
    expect(back.className).toContain("mobile-shell-bar-action")
    expect(back.className).toContain("active:bg-muted")
    expect(back.className).toContain("motion-reduce:transition-none")
  })

  it("renders host-supplied actions in the merged bar", () => {
    render(
      <MobileChatBar
        canOpenNav={false}
        canOpenWorkspace={false}
        onOpenWorkspace={() => {}}
        actions={<button type="button">Search catalogs and commands</button>}
      />,
    )
    expect(screen.getByRole("button", { name: "Search catalogs and commands" })).toBeTruthy()
  })

  it("keeps the Agent alone in the subtitle and the pane count in a non-truncating pill", () => {
    render(
      <MobileChatBar
        pane={{ id: "pane-a", title: "Planning", agentLabel: "Coder" }}
        totalPanes={3}
        canOpenNav={false}
        canOpenWorkspace={false}
        onOpenWorkspace={() => {}}
      />,
    )

    const subtitle = document.querySelector('[data-boring-workspace-part="mobile-chat-pane-subtitle"]')
    // The explanatory sentence used to share this truncating 11px line and was
    // the first thing cut off; only the Agent is here now, at 12px.
    expect(subtitle?.textContent).toBe("Coder")
    expect(subtitle?.className).toContain("text-xs")

    const count = document.querySelector('[data-boring-workspace-part="mobile-chat-pane-count"]')
    expect(count?.className).toContain("shrink-0")
    expect(count?.className).not.toContain("truncate")
    expect(count?.textContent).toContain("1/3")
    // The sentence itself survives for assistive tech.
    expect(count?.textContent).toContain("split panes are disabled on mobile")
  })

  it("shows no subtitle and no count pill for a single pane without an Agent", () => {
    render(
      <MobileChatBar
        pane={{ id: "pane-a", title: "Planning" }}
        totalPanes={1}
        canOpenNav={false}
        canOpenWorkspace={false}
        onOpenWorkspace={() => {}}
      />,
    )
    expect(document.querySelector('[data-boring-workspace-part="mobile-chat-pane-subtitle"]')).toBeNull()
    expect(document.querySelector('[data-boring-workspace-part="mobile-chat-pane-count"]')).toBeNull()
  })

  it("gives the close action a reduced-motion-safe pressed state and a focus ring", () => {
    render(
      <MobileChatBar
        pane={{ id: "pane-a", title: "Planning" }}
        totalPanes={2}
        canOpenNav={false}
        canOpenWorkspace={false}
        onOpenWorkspace={() => {}}
        onClosePane={() => {}}
      />,
    )

    const close = screen.getByRole("button", { name: "Close Planning pane" })
    expect(close.className).toContain("motion-reduce:transition-none")
    expect(close.className).toContain("active:bg-muted")
    expect(close.className).toContain("focus-visible:ring-2")
  })

  it("renders the pane body without a header of its own", () => {
    render(<MobileSingleChatPane pane={{ id: "pane-a", title: "Planning" }} renderPane={() => <div>Transcript</div>} />)
    const pane = document.querySelector('[data-boring-workspace-part="mobile-chat-pane"]')
    expect(pane?.children.length).toBe(1)
    expect(pane?.firstElementChild?.getAttribute("data-boring-workspace-part")).toBe("chat-pane")
    expect(screen.getByText("Transcript")).toBeTruthy()
    expect(screen.queryByText("Planning")).toBeNull()
  })
})
