import { describe, it, expect, vi } from "vitest"
import { act, render, fireEvent, screen, waitFor } from "@testing-library/react"
import { useEffect } from "react"
import { SessionBrowser } from "../SessionBrowser"
import { WorkspaceAttentionProvider, useWorkspaceAttention } from "../../../attention/WorkspaceAttentionProvider"
import type { SessionItem } from "../../../components/SessionList"
import { decodeWorkspaceSessionDrag, workspaceSessionKey } from "../../../sessionIdentity"
import { COMPLETED_VISIBLE_MS } from "../../../sessionActivity"

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

  it("routes every colliding row action by Agent owner", () => {
    const colliding: SessionItem[] = [
      { id: "shared", agentTypeId: "alpha", title: "Alpha session", updatedAt: now },
      { id: "shared", agentTypeId: "beta", title: "Beta session", updatedAt: now - 1 },
    ]
    const onSwitch = vi.fn()
    const onOpenAsTab = vi.fn()
    const onTogglePin = vi.fn()
    const onDelete = vi.fn()
    render(
      <SessionBrowser
        sessions={colliding}
        activeRef={{ sessionId: "shared", agentTypeId: "beta" }}
        openRefs={[{ sessionId: "shared", agentTypeId: "alpha" }, { sessionId: "shared", agentTypeId: "beta" }]}
        pinnedRefs={[{ sessionId: "shared", agentTypeId: "alpha" }]}
        onSwitch={onSwitch}
        onOpenAsTab={onOpenAsTab}
        onTogglePin={onTogglePin}
        onDelete={onDelete}
      />,
    )

    const pinnedSection = document.querySelector('[data-boring-workspace-part="session-pinned-section"]')
    const activeSection = document.querySelector('[data-boring-workspace-part="session-active-section"]')
    expect(pinnedSection?.textContent).toContain("Alpha session")
    expect(pinnedSection?.textContent).not.toContain("Beta session")
    expect(activeSection?.textContent).toContain("Beta session")
    expect(activeSection?.textContent).not.toContain("Alpha session")
    expect(activeSection?.querySelector('[data-boring-state="selected"]')).toHaveTextContent("Beta session")

    fireEvent.click(screen.getByText("Beta session"))
    fireEvent.click(screen.getByLabelText("Open Beta session in chat pane"))
    fireEvent.click(screen.getByLabelText("Unpin Alpha session"))
    fireEvent.click(screen.getByLabelText("Delete Alpha session"))

    expect(onSwitch).toHaveBeenCalledWith("shared", "beta")
    expect(onOpenAsTab).toHaveBeenCalledWith("shared", "beta")
    expect(onTogglePin).toHaveBeenCalledWith("shared", "alpha")
    expect(onDelete).toHaveBeenCalledWith("shared", "alpha")
  })

  it("keeps raw legacy ids distinct from structured refs that match their encoded text", () => {
    const legacyCollisionId = workspaceSessionKey("shared", "alpha")
    const colliding: SessionItem[] = [
      { id: "shared", agentTypeId: "alpha", title: "Alpha addressed", updatedAt: now },
      { id: legacyCollisionId, title: "Legacy raw collision", updatedAt: now - 1 },
    ]
    const onSwitch = vi.fn()
    const onTogglePin = vi.fn()
    const onDelete = vi.fn()
    const setData = vi.fn()

    render(
      <SessionBrowser
        sessions={colliding}
        activeId={legacyCollisionId}
        openIds={[legacyCollisionId]}
        pinnedRefs={[{ sessionId: "shared", agentTypeId: "alpha" }]}
        onSwitch={onSwitch}
        onTogglePin={onTogglePin}
        onDelete={onDelete}
      />,
    )

    const pinnedSection = document.querySelector('[data-boring-workspace-part="session-pinned-section"]')
    const activeSection = document.querySelector('[data-boring-workspace-part="session-active-section"]')
    expect(pinnedSection).toHaveTextContent("Alpha addressed")
    expect(pinnedSection).not.toHaveTextContent("Legacy raw collision")
    expect(activeSection).toHaveTextContent("Legacy raw collision")
    expect(activeSection).not.toHaveTextContent("Alpha addressed")
    expect(activeSection?.querySelector('[data-boring-state="selected"]')).toHaveTextContent("Legacy raw collision")

    fireEvent.click(screen.getByText("Legacy raw collision"))
    fireEvent.click(screen.getByLabelText("Unpin Alpha addressed"))
    fireEvent.click(screen.getByLabelText("Delete Alpha addressed"))
    fireEvent.dragStart(screen.getByText("Alpha addressed").closest("li")!, {
      dataTransfer: { setData, effectAllowed: "" },
    })

    expect(onSwitch).toHaveBeenCalledWith(legacyCollisionId)
    expect(onTogglePin).toHaveBeenCalledWith("shared", "alpha")
    expect(onDelete).toHaveBeenCalledWith("shared", "alpha")
    const payload = setData.mock.calls.find(([type]) => type === "application/x-boring-chat-session")?.[1]
    expect(decodeWorkspaceSessionDrag(payload)).toEqual({ sessionId: "shared", agentTypeId: "alpha" })
  })

  it("writes an addressed drag payload without exposing an internal pane key", () => {
    const setData = vi.fn()
    render(<SessionBrowser sessions={[{ id: "shared", agentTypeId: "beta", title: "Beta shared" }]} />)
    fireEvent.dragStart(screen.getByText("Beta shared").closest("li")!, {
      dataTransfer: { setData, effectAllowed: "" },
    })

    const payload = setData.mock.calls.find(([type]) => type === "application/x-boring-chat-session")?.[1]
    expect(decodeWorkspaceSessionDrag(payload)).toEqual({ sessionId: "shared", agentTypeId: "beta" })
    expect(payload).not.toBe(workspaceSessionKey("shared", "beta"))
  })

  it("keeps working and attention badges scoped to colliding Agent owners", () => {
    const colliding: SessionItem[] = [
      { id: "shared", agentTypeId: "alpha", title: "Alpha shared", updatedAt: now },
      { id: "shared", agentTypeId: "beta", title: "Beta shared", updatedAt: now - 1 },
    ]
    function BlockAlpha() {
      const { addBlocker, removeBlocker } = useWorkspaceAttention()
      useEffect(() => {
        addBlocker({
          id: "alpha-question",
          reason: "ask-user.question",
          sessionId: "shared",
          agentTypeId: "alpha",
          sessionBadge: { kind: "question", label: "question" },
        })
        return () => removeBlocker("alpha-question")
      }, [addBlocker, removeBlocker])
      return null
    }

    render(
      <WorkspaceAttentionProvider>
        <BlockAlpha />
        <SessionBrowser sessions={colliding} />
      </WorkspaceAttentionProvider>,
    )
    act(() => {
      window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
        detail: { sessionId: "shared", agentTypeId: "beta", working: true },
      }))
    })

    expect(document.querySelector('[data-boring-badge="question"]')?.closest("li")).toHaveTextContent("Alpha shared")
    expect(document.querySelector('[data-boring-badge="working"]')?.closest("li")).toHaveTextContent("Beta shared")
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

  it("requests current working state when mounted after a chat panel", async () => {
    const onRequest = () => window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
      detail: { sessionId: "s2", working: true },
    }))
    window.addEventListener("boring:chat-session-status-request", onRequest)

    try {
      render(<SessionBrowser sessions={sample} activeId="s1" />)

      await waitFor(() => expect(document.querySelector('[data-boring-badge="working"]')?.closest("li"))
        .toHaveTextContent("Second session"))
    } finally {
      window.removeEventListener("boring:chat-session-status-request", onRequest)
    }
  })

  it("shows a done badge when a working session finishes, and retires it", () => {
    vi.useFakeTimers()
    try {
      render(<SessionBrowser sessions={sample} activeId="s1" />)

      act(() => {
        window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
          detail: { sessionId: "s2", working: true },
        }))
      })
      expect(document.querySelector('[data-boring-badge="completed"]')).toBeNull()

      act(() => {
        window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
          detail: { sessionId: "s2", working: false },
        }))
      })
      const badge = document.querySelector('[data-boring-badge="completed"]')
      expect(badge).toHaveTextContent("done")
      expect(badge?.closest("li")?.textContent).toContain("Second session")
      // Quiet by construction: no pulse, and the neutral tone the working chip uses.
      expect(badge?.className).toContain("bg-foreground/[0.07]")
      expect(badge?.innerHTML).not.toContain("animate-pulse")

      act(() => { vi.advanceTimersByTime(COMPLETED_VISIBLE_MS + 1) })
      expect(document.querySelector('[data-boring-badge="completed"]')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not mark idle sessions that never ran as done", () => {
    render(<SessionBrowser sessions={sample} activeId="s1" />)
    expect(document.querySelector('[data-boring-badge="completed"]')).toBeNull()
  })

  it("never shows done for an aborted run, and retires the chip when the abort lands late", () => {
    vi.useFakeTimers()
    try {
      const aborted: SessionItem[] = sample.map((s) => s.id === "s2" ? { ...s, status: "aborted" as const } : s)
      const view = render(<SessionBrowser sessions={sample} activeId="s1" />)

      // Outcome known at finish time: working -> not-working with the list
      // already carrying the cancelled outcome. No done badge, ever.
      act(() => {
        window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
          detail: { sessionId: "s2", working: true },
        }))
      })
      act(() => {
        view.rerender(<SessionBrowser sessions={aborted} activeId="s1" />)
      })
      act(() => {
        window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
          detail: { sessionId: "s2", working: false },
        }))
      })
      expect(document.querySelector('[data-boring-badge="completed"]')).toBeNull()

      // Outcome arrives late (event/list ordering): a bare finish shows the
      // chip optimistically, but the aborted status must retire it.
      act(() => {
        view.rerender(<SessionBrowser sessions={sample} activeId="s1" />)
      })
      act(() => {
        window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
          detail: { sessionId: "s2", working: true },
        }))
      })
      act(() => {
        window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
          detail: { sessionId: "s2", working: false },
        }))
      })
      expect(document.querySelector('[data-boring-badge="completed"]')).toBeInTheDocument()
      act(() => {
        view.rerender(<SessionBrowser sessions={aborted} activeId="s1" />)
      })
      expect(document.querySelector('[data-boring-badge="completed"]')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it("resets terminal badges when the workspace source switches onto a colliding id", () => {
    const { rerender } = render(<SessionBrowser sessions={sample} activeId="s1" activityWorkspaceId="ws-a" />)

    act(() => {
      window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
        detail: { workspaceId: "ws-a", sessionId: "s2", working: false, status: "error" },
      }))
    })
    expect(document.querySelector('[data-boring-badge="failed"]')).toBeInTheDocument()

    // Same session id under another workspace must start clean: cached state
    // from the previous source may not survive a source switch.
    rerender(<SessionBrowser sessions={sample} activeId="s1" activityWorkspaceId="ws-b" />)
    expect(document.querySelector('[data-boring-badge="failed"]')).toBeNull()
    expect(document.querySelector('[data-boring-badge="completed"]')).toBeNull()
  })

  it("ignores live terminal events tagged with a foreign workspace", () => {
    render(<SessionBrowser sessions={sample} activeId="s1" activityWorkspaceId="ws-b" />)

    act(() => {
      window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
        detail: { workspaceId: "ws-a", sessionId: "s2", working: false, status: "error" },
      }))
    })
    expect(document.querySelector('[data-boring-badge="failed"]')).toBeNull()
  })

  it("a foreign finish cannot complete a colliding working session", () => {
    vi.useFakeTimers()
    try {
      const { rerender } = render(<SessionBrowser sessions={sample} activeId="s1" activityWorkspaceId="ws-b" />)

      // The local colliding id starts streaming under ws-b.
      act(() => {
        window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
          detail: { workspaceId: "ws-b", sessionId: "s2", working: true },
        }))
      })
      expect(document.querySelector('[data-boring-badge="completed"]')).toBeNull()

      // A finish tagged with a foreign workspace targets a colliding id in
      // another source; it must not flip this row's working set and must not
      // manufacture a completed state here.
      act(() => {
        window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
          detail: { workspaceId: "ws-a", sessionId: "s2", working: false },
        }))
      })
      expect(document.querySelector('[data-boring-badge="completed"]')).toBeNull()

      // The row is still honestly working under its own scope.
      rerender(<SessionBrowser sessions={sample} activeId="s1" activityWorkspaceId="ws-b" />)
      expect(document.querySelector('[data-boring-badge="completed"]')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it("shows a failed badge for a session the server reports as errored", () => {
    const withError: SessionItem[] = [
      sample[0]!,
      { ...sample[1]!, status: "error" },
      sample[2]!,
    ]
    render(<SessionBrowser sessions={withError} activeId="s1" />)

    const badge = document.querySelector('[data-boring-badge="failed"]')
    expect(badge).toHaveTextContent("failed")
    expect(badge?.closest("li")?.textContent).toContain("Second session")
    expect(badge?.className).toContain("text-destructive")
    // Only the errored row is tinted; the list does not become a wall of red.
    expect(document.querySelectorAll('[data-boring-badge="failed"]')).toHaveLength(1)
  })

  it("shows a failed badge from live activity before the list refetches", () => {
    render(<SessionBrowser sessions={sample} activeId="s1" />)

    act(() => {
      window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
        detail: { sessionId: "s3", working: true, status: "running" },
      }))
    })
    act(() => {
      window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
        detail: { sessionId: "s3", working: false, status: "error" },
      }))
    })

    expect(document.querySelector('[data-boring-badge="failed"]')?.closest("li")?.textContent)
      .toContain("Third session")
    // A failure is not also reported as done.
    expect(document.querySelector('[data-boring-badge="completed"]')).toBeNull()
  })

  it("keeps the working badge while a session that previously failed runs again", () => {
    const withError: SessionItem[] = [sample[0]!, { ...sample[1]!, status: "error" }, sample[2]!]
    const { rerender } = render(<SessionBrowser sessions={withError} activeId="s1" />)
    expect(document.querySelector('[data-boring-badge="failed"]')).toBeInTheDocument()

    rerender(<SessionBrowser sessions={sample} activeId="s1" />)
    act(() => {
      window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
        detail: { sessionId: "s2", working: true, status: "running" },
      }))
    })

    expect(document.querySelector('[data-boring-badge="working"]')?.closest("li")?.textContent)
      .toContain("Second session")
    expect(document.querySelector('[data-boring-badge="failed"]')).toBeNull()
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
