import { useEffect } from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { WorkspaceAttentionProvider, useWorkspaceAttention } from "../../../attention/WorkspaceAttentionProvider"
import { workspaceSessionKey } from "../../../sessionIdentity"
import { AppLeftPane } from "../AppLeftPane"

const sessions = [
  { id: "s1", title: "First session" },
  { id: "s2", title: "Second session" },
]

function renderPane() {
  return render(
    <WorkspaceAttentionProvider>
      <AppLeftPane
        appTitle="Test"
        sessions={sessions}
        activeSessionId="s1"
        openSessionIds={["s1"]}
        pinnedSessionIds={[]}
        onCreateSession={vi.fn()}
        onOpenCommandPalette={vi.fn()}
        onSwitchSession={vi.fn()}
        onOpenSessionAsPane={vi.fn()}
        onToggleSessionPinned={vi.fn()}
      />
    </WorkspaceAttentionProvider>,
  )
}

describe("AppLeftPane", () => {
  it("preserves legacy sessions and working events without agentTypeId", () => {
    renderPane()

    expect(screen.getByText("Chats")).toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Agent" })).not.toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
        detail: { sessionId: "s2", working: true },
      }))
    })

    const badge = document.querySelector('[data-boring-badge="working"]')
    expect(badge).toBeInTheDocument()
    expect(badge?.closest('[data-boring-workspace-part="app-session-row"]')).toHaveTextContent("Second session")
  })

  it("groups addressed sessions by agent and switches agents", () => {
    const onSelectAgentTypeId = vi.fn()
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          agents={[
            { agentTypeId: "alpha", label: "Alpha" },
            { agentTypeId: "beta", label: "Beta" },
          ]}
          selectedAgentTypeId="alpha"
          onSelectAgentTypeId={onSelectAgentTypeId}
          sessions={[
            { id: "a1", agentTypeId: "alpha", title: "Alpha chat" },
          ]}
          activeSessionRef={{ sessionId: "a1", agentTypeId: "alpha" }}
          openSessionRefs={[{ sessionId: "a1", agentTypeId: "alpha" }]}
          pinnedSessionIds={[]}
          onCreateSession={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    expect(screen.getByText("Alpha chat")).toBeInTheDocument()
    expect(screen.getByText("No chats yet.")).toBeInTheDocument()
    fireEvent.change(screen.getByRole("combobox", { name: "Agent" }), { target: { value: "beta" } })
    expect(onSelectAgentTypeId).toHaveBeenCalledWith("beta")
  })

  it("shows a no-session empty state for every addressed agent", () => {
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          agents={[
            { agentTypeId: "alpha", label: "Alpha" },
            { agentTypeId: "beta", label: "Beta" },
          ]}
          selectedAgentTypeId="alpha"
          onSelectAgentTypeId={vi.fn()}
          sessions={[]}
          pinnedSessionIds={[]}
          onCreateSession={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    expect(screen.getByText("Alpha")).toBeInTheDocument()
    expect(screen.getByText("Beta")).toBeInTheDocument()
    expect(screen.getAllByText("No chats yet.")).toHaveLength(2)
  })

  it("does not render an app-left switcher for one addressed agent", () => {
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          agents={[{ agentTypeId: "alpha", label: "Alpha" }]}
          selectedAgentTypeId="alpha"
          onSelectAgentTypeId={vi.fn()}
          sessions={[{ id: "a1", agentTypeId: "alpha", title: "Alpha chat" }]}
          activeSessionRef={{ sessionId: "a1", agentTypeId: "alpha" }}
          openSessionRefs={[{ sessionId: "a1", agentTypeId: "alpha" }]}
          pinnedSessionIds={[]}
          onCreateSession={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    expect(screen.queryByRole("combobox", { name: "Agent" })).not.toBeInTheDocument()
  })

  it("shows a hover action for creating a quick popover chat", () => {
    const onCreateSession = vi.fn()
    const onCreatePopoverSession = vi.fn()
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          sessions={sessions}
          activeSessionId="s1"
          openSessionIds={["s1"]}
          pinnedSessionIds={[]}
          onCreateSession={onCreateSession}
          onCreatePopoverSession={onCreatePopoverSession}
          onOpenCommandPalette={vi.fn()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Quick chat" }))

    expect(onCreatePopoverSession).toHaveBeenCalledTimes(1)
    expect(onCreateSession).not.toHaveBeenCalled()
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
  })

  it("keeps the main New chat button as an action, not an active item", () => {
    const onCreateSession = vi.fn()
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          sessions={sessions}
          activeSessionId="s1"
          openSessionIds={["s1"]}
          pinnedSessionIds={[]}
          onCreateSession={onCreateSession}
          onCreatePopoverSession={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "New chat" }))
    expect(onCreateSession).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: "New chat" })).not.toHaveAttribute("data-active")
  })

  it("mutes the active session row when an overlay owns nav selection", () => {
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          sessions={sessions}
          activeSessionId="s1"
          muteActiveSession
          openSessionIds={["s1"]}
          pinnedSessionIds={[]}
          onCreateSession={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    expect(screen.getByText("First session").closest('[data-boring-workspace-part="app-session-row"]')).toHaveAttribute("data-boring-session-state", "open")
  })

  it("calls onSwitchSession when reselecting the active session", () => {
    const onSwitchSession = vi.fn()
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          sessions={sessions}
          activeSessionId="s1"
          openSessionIds={["s1"]}
          pinnedSessionIds={[]}
          onCreateSession={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onSwitchSession={onSwitchSession}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    fireEvent.click(screen.getByText("First session"))
    expect(onSwitchSession).toHaveBeenCalledWith("s1")
  })

  it("keeps the status badge area clickable for switching sessions", () => {
    const onSwitchSession = vi.fn()
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          sessions={sessions}
          activeSessionId="s1"
          openSessionIds={["s1"]}
          pinnedSessionIds={[]}
          onCreateSession={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onSwitchSession={onSwitchSession}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    act(() => {
      window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
        detail: { sessionId: "s2", working: true },
      }))
    })

    const badge = document.querySelector('[data-boring-badge="working"]')
    expect(badge).toBeInTheDocument()
    fireEvent.click(badge?.closest('[data-boring-workspace-part="app-session-row"]') as Element)
    expect(onSwitchSession).toHaveBeenCalledWith("s2")
  })

  it("keeps structured addressed refs distinct from a colliding raw legacy id", () => {
    const addressedKey = workspaceSessionKey("shared", "alpha")
    const onSwitchSession = vi.fn()
    const onToggleSessionPinned = vi.fn()
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          sessions={[
            { id: "shared", agentTypeId: "alpha", title: "Addressed session" },
            { id: addressedKey, title: "Legacy collision" },
          ]}
          activeSessionRef={{ sessionId: "shared", agentTypeId: "alpha" }}
          openSessionIds={[addressedKey]}
          pinnedSessionRefs={[{ sessionId: "shared", agentTypeId: "alpha" }]}
          onCreateSession={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onSwitchSession={onSwitchSession}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={onToggleSessionPinned}
        />
      </WorkspaceAttentionProvider>,
    )

    expect(screen.getByText("Addressed session").closest('[data-boring-workspace-part="app-session-row"]')).toHaveAttribute("data-boring-session-state", "active")
    expect(screen.getByText("Legacy collision").closest('[data-boring-workspace-part="app-session-row"]')).toHaveAttribute("data-boring-session-state", "open")
    fireEvent.click(screen.getByText("Addressed session"))
    fireEvent.click(screen.getByText("Legacy collision"))
    fireEvent.click(screen.getByRole("button", { name: "Unpin Addressed session" }))
    expect(onSwitchSession).toHaveBeenNthCalledWith(1, "shared", "alpha")
    expect(onSwitchSession).toHaveBeenNthCalledWith(2, addressedKey)
    expect(onToggleSessionPinned).toHaveBeenCalledWith("shared", "alpha")
  })

  it("shows question state beside session names", () => {
    function BlockSession() {
      const { addBlocker } = useWorkspaceAttention()
      useEffect(() => {
        addBlocker({
          id: "ask:s2",
          reason: "ask-user.question",
          sessionId: "s2",
          sessionBadge: { kind: "question", label: "question", tone: "attention", priority: 10 },
        })
      }, [addBlocker])
      return null
    }

    render(
      <WorkspaceAttentionProvider>
        <BlockSession />
        <AppLeftPane
          appTitle="Test"
          sessions={sessions}
          activeSessionId="s1"
          openSessionIds={["s1"]}
          pinnedSessionIds={[]}
          onCreateSession={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    const badge = document.querySelector('[data-boring-badge="question"]')
    expect(badge).toBeInTheDocument()
    expect(badge?.closest('[data-boring-workspace-part="app-session-row"]')).toHaveTextContent("Second session")
    expect(screen.getByText("question")).toBeInTheDocument()
  })
})
