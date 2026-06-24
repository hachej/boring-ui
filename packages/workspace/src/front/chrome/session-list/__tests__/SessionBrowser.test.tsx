import { describe, it, expect, vi } from "vitest"
import { act, render, fireEvent, screen } from "@testing-library/react"
import { useEffect } from "react"
import { SessionBrowser } from "../SessionBrowser"
import { WorkspaceAttentionProvider, useWorkspaceAttention } from "../../../attention/WorkspaceAttentionProvider"
import type { SessionItem } from "../../../components/SessionList"

const now = Date.now()
const sample: SessionItem[] = [
  { id: "s1", title: "First session", updatedAt: now - 60_000 },
  { id: "s2", title: "Second session", updatedAt: now - 60 * 60_000 },
  { id: "s3", title: "Third session", updatedAt: now - 26 * 60 * 60_000 },
]

describe("SessionBrowser", () => {
  it("renders all sessions grouped by recency", () => {
    render(<SessionBrowser sessions={sample} activeId="s1" />)
    expect(screen.getByText(/First session/)).toBeInTheDocument()
    expect(screen.getByText(/Second session/)).toBeInTheDocument()
    expect(screen.getByText(/Third session/)).toBeInTheDocument()
  })

  it("calls onSwitch with the row's id when a non-active row is clicked", () => {
    const onSwitch = vi.fn()
    render(<SessionBrowser sessions={sample} activeId="s1" onSwitch={onSwitch} />)
    fireEvent.click(screen.getByText(/Second session/))
    expect(onSwitch).toHaveBeenCalledWith("s2")
  })

  it("calls onSwitch even when the same row is clicked again", () => {
    const onSwitch = vi.fn()
    render(<SessionBrowser sessions={sample} activeId="s1" onSwitch={onSwitch} />)
    fireEvent.click(screen.getByText(/First session/))
    expect(onSwitch).toHaveBeenCalledWith("s1")
  })

  it("highlights the active row with the active class set", () => {
    const { container } = render(<SessionBrowser sessions={sample} activeId="s2" />)
    const items = container.querySelectorAll("li")
    const second = Array.from(items).find((li) => li.textContent?.includes("Second session"))
    expect(second).toBeTruthy()
    // active rows get bg-foreground/[0.06]; check via class substring
    expect(second?.className).toMatch(/bg-foreground\/\[0\.06\]/)
  })

  it("does not require onSwitch — clicking is a no-op when omitted", () => {
    expect(() => {
      render(<SessionBrowser sessions={sample} activeId="s1" />)
      fireEvent.click(screen.getByText(/Second session/))
    }).not.toThrow()
  })

  it("calls onCreate when the new-session button is clicked", () => {
    const onCreate = vi.fn()
    render(<SessionBrowser sessions={sample} activeId="s1" onCreate={onCreate} />)
    fireEvent.click(screen.getByLabelText("New session"))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it("calls onDelete with the row id and does NOT also fire onSwitch", () => {
    const onSwitch = vi.fn()
    const onDelete = vi.fn()
    render(<SessionBrowser sessions={sample} activeId="s1" onSwitch={onSwitch} onDelete={onDelete} />)
    fireEvent.click(screen.getByLabelText(/Delete Second session/))
    expect(onDelete).toHaveBeenCalledWith("s2")
    expect(onSwitch).not.toHaveBeenCalled()
  })

  it("opens a row as a separate pane without also switching the active pane", () => {
    const onSwitch = vi.fn()
    const onOpenAsTab = vi.fn()
    render(<SessionBrowser sessions={sample} activeId="s1" onSwitch={onSwitch} onOpenAsTab={onOpenAsTab} />)

    fireEvent.click(screen.getByLabelText("Open Second session in chat pane"))

    expect(onOpenAsTab).toHaveBeenCalledWith("s2")
    expect(onSwitch).not.toHaveBeenCalled()
  })

  it("calls onLoadMore from the load-more footer", () => {
    const onLoadMore = vi.fn()
    render(<SessionBrowser sessions={sample} hasMore onLoadMore={onLoadMore} />)
    fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it("renders empty state when no sessions are supplied", () => {
    render(<SessionBrowser sessions={[]} />)
    expect(screen.getByText(/No sessions yet/)).toBeInTheDocument()
  })

  it("splits open sessions into an Active section above history", () => {
    render(<SessionBrowser sessions={sample} activeId="s1" openIds={["s1", "s3"]} />)

    expect(screen.getByText("Active")).toBeInTheDocument()
    expect(screen.getByText("History")).toBeInTheDocument()
    const activeSection = document.querySelector('[data-boring-workspace-part="session-active-section"]')
    expect(activeSection?.textContent).toContain("First session")
    expect(activeSection?.textContent).toContain("Third session")
    expect(activeSection?.textContent).not.toContain("Second session")
    // Open rows carry the open indicator dot.
    expect(activeSection?.querySelectorAll('[data-boring-workspace-part="session-open-dot"]')).toHaveLength(2)
  })

  it("collapses the Active and History sections", () => {
    render(<SessionBrowser sessions={sample} activeId="s1" openIds={["s1"]} />)

    fireEvent.click(screen.getByRole("button", { name: /Active/ }))
    const activeSection = document.querySelector('[data-boring-workspace-part="session-active-section"]')
    expect(activeSection?.querySelector("li")).toBeNull()

    // History starts collapsed when panes are open; clicking it expands.
    expect(screen.queryByText(/Second session/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /History/ }))
    expect(screen.getByText(/Second session/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /History/ }))
    expect(screen.queryByText(/Second session/)).not.toBeInTheDocument()
  })

  it("shows history expanded by default when no panes are open", () => {
    render(<SessionBrowser sessions={sample} activeId="s1" />)
    expect(screen.getByText(/Second session/)).toBeInTheDocument()
  })

  it("renders a Pinned section and toggles pin state", () => {
    const onTogglePin = vi.fn()
    // s1 open (Active, unpinned), s2 pinned.
    render(
      <SessionBrowser
        sessions={sample}
        activeId="s1"
        openIds={["s1"]}
        pinnedIds={["s2"]}
        onTogglePin={onTogglePin}
      />,
    )

    const pinnedSection = document.querySelector('[data-boring-workspace-part="session-pinned-section"]')
    expect(pinnedSection).toBeInTheDocument()
    expect(pinnedSection?.textContent).toContain("Second session")
    // A pinned session shows its toggle in the pinned state, and a pinned
    // session is pulled out of the Active section.
    expect(pinnedSection?.querySelector('[data-boring-state="pinned"]')).toBeInTheDocument()
    const activeSection = document.querySelector('[data-boring-workspace-part="session-active-section"]')
    expect(activeSection?.textContent).not.toContain("Second session")

    fireEvent.click(screen.getByRole("button", { name: /Unpin Second session/ }))
    expect(onTogglePin).toHaveBeenCalledWith("s2")

    // Pinning an un-pinned (Active) row.
    fireEvent.click(screen.getByRole("button", { name: /^Pin First session/ }))
    expect(onTogglePin).toHaveBeenCalledWith("s1")
  })

  it("shows a working badge while a session's chat panel streams", () => {
    render(<SessionBrowser sessions={sample} activeId="s1" />)

    act(() => {
      window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
        detail: { sessionId: "s2", working: true },
      }))
    })
    const badge = document.querySelector('[data-boring-badge="working"]')
    expect(badge).toBeInTheDocument()
    expect(badge?.closest("li")?.textContent).toContain("Second session")

    act(() => {
      window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
        detail: { sessionId: "s2", working: false },
      }))
    })
    expect(document.querySelector('[data-boring-badge="working"]')).toBeNull()
  })

  it("shows a needs-input badge for older waiting-for-input blockers", () => {
    function BlockSession({ sessionId }: { sessionId: string }) {
      const { addBlocker, removeBlocker } = useWorkspaceAttention()
      useEffect(() => {
        addBlocker({ id: `legacy:${sessionId}`, reason: "waiting_for_user_input", sessionId })
        return () => removeBlocker(`legacy:${sessionId}`)
      }, [addBlocker, removeBlocker, sessionId])
      return null
    }

    render(
      <WorkspaceAttentionProvider>
        <BlockSession sessionId="s3" />
        <SessionBrowser sessions={sample} activeId="s1" />
      </WorkspaceAttentionProvider>,
    )

    const badge = document.querySelector('[data-boring-badge="needs-input"]')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent("needs input")
    expect(badge?.closest("li")?.textContent).toContain("Third session")
  })

  it("rolls up attention badges into collapsed sections", () => {
    function BlockSession({ sessionId }: { sessionId: string }) {
      const { addBlocker, removeBlocker } = useWorkspaceAttention()
      useEffect(() => {
        addBlocker({ id: `review:${sessionId}`, reason: "pr-review.review", sessionId, sessionBadge: { kind: "review", label: "review" } })
        return () => removeBlocker(`review:${sessionId}`)
      }, [addBlocker, removeBlocker, sessionId])
      return null
    }

    render(
      <WorkspaceAttentionProvider>
        <BlockSession sessionId="s3" />
        <SessionBrowser sessions={sample} activeId="s1" openIds={["s1"]} />
      </WorkspaceAttentionProvider>,
    )

    expect(screen.queryByText(/Third session/)).not.toBeInTheDocument()
    const rollup = document.querySelector('[data-boring-badge="attention-rollup"]')
    expect(rollup).toBeInTheDocument()
    expect(rollup).toHaveTextContent("1")
  })

  it("shows a plugin-provided attention badge for session-scoped blockers", () => {
    function BlockSession({ sessionId }: { sessionId: string }) {
      const { addBlocker, removeBlocker } = useWorkspaceAttention()
      useEffect(() => {
        addBlocker({
          id: `ask:${sessionId}`,
          reason: "ask-user.question",
          sessionId,
          sessionBadge: { kind: "question", label: "question", tone: "attention" },
        })
        return () => removeBlocker(`ask:${sessionId}`)
      }, [addBlocker, removeBlocker, sessionId])
      return null
    }

    render(
      <WorkspaceAttentionProvider>
        <BlockSession sessionId="s3" />
        <SessionBrowser sessions={sample} activeId="s1" />
      </WorkspaceAttentionProvider>,
    )

    // A plugin attention badge outranks "working": send both signals for s3.
    act(() => {
      window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
        detail: { sessionId: "s3", working: true },
      }))
    })
    const badge = document.querySelector('[data-boring-badge="question"]')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent("question")
    expect(badge?.closest("li")?.textContent).toContain("Third session")
    expect(document.querySelector('[data-boring-badge="working"]')).toBeNull()
  })
})
