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

  it("groups addressed sessions by agent without redundant selector chrome and reports per-agent activity", () => {
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          agents={[
            { agentTypeId: "alpha", label: "Alpha", sessionsStatus: "loaded" },
            { agentTypeId: "beta", label: "Beta", sessionsStatus: "loading" },
          ]}
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
    expect(screen.getByText("Loading chats…")).toBeInTheDocument()
    expect(screen.queryByText("No chats yet.")).not.toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Agent" })).not.toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
        detail: { sessionId: "a1", agentTypeId: "alpha", working: true },
      }))
    })

    expect(screen.getByLabelText("Alpha streaming")).toHaveAttribute("data-boring-agent-activity", "streaming")
    expect(screen.getByLabelText("Beta idle")).toHaveAttribute("data-boring-agent-activity", "idle")
  })

  it("creates addressed chats from a collapsible agent list", () => {
    const onCreateSession = vi.fn()
    const onCreateSplitSession = vi.fn()
    const onCreatePopoverSession = vi.fn()
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          agents={[
            { agentTypeId: "alpha", label: "Alpha" },
            { agentTypeId: "beta", label: "Beta" },
          ]}
          sessions={[]}
          onCreateSession={onCreateSession}
          onCreateSplitSession={onCreateSplitSession}
          onCreatePopoverSession={onCreatePopoverSession}
          onOpenCommandPalette={vi.fn()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    const agentsToggle = screen.getByRole("button", { name: "Agents" })
    expect(agentsToggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("list", { name: "Agents available for new chat" })).not.toBeInTheDocument()

    fireEvent.click(agentsToggle)

    expect(agentsToggle).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("list", { name: "Agents available for new chat" })).toBeInTheDocument()
    expect(screen.getByRole("listitem", { name: "Alpha" })).toBeInTheDocument()
    expect(screen.getByRole("listitem", { name: "Beta" })).toBeInTheDocument()
    const betaAction = screen.getByRole("button", { name: "New chat with Beta" })
    const alphaSplitAction = screen.getByRole("button", { name: "New chat with Alpha in split" })
    const betaQuickAction = screen.getByRole("button", { name: "Quick chat with Beta" })
    expect(agentsToggle).toHaveClass("h-11", "[@media(hover:hover)_and_(min-width:640px)]:h-8")
    expect(betaAction).toHaveClass("h-full")
    expect(betaAction.parentElement).toHaveClass("h-11", "[@media(hover:hover)_and_(min-width:640px)]:h-8")
    expect(betaAction.querySelector(".lucide-plus")).toBeInTheDocument()
    expect(alphaSplitAction).toHaveClass("size-11", "[@media(hover:hover)_and_(min-width:640px)]:size-6")
    expect(alphaSplitAction.querySelector(".lucide-columns-2")).toBeInTheDocument()
    expect(betaQuickAction.querySelector(".lucide-zap")).toBeInTheDocument()
    expect(alphaSplitAction.parentElement).toHaveClass(
      "w-auto",
      "opacity-100",
      "[@media(hover:hover)_and_(min-width:640px)]:w-0",
      "[@media(hover:hover)_and_(min-width:640px)]:opacity-0",
    )

    fireEvent.click(betaAction)
    fireEvent.click(alphaSplitAction)
    fireEvent.click(betaQuickAction)

    expect(onCreateSession).toHaveBeenCalledWith("beta")
    expect(onCreateSplitSession).toHaveBeenCalledWith("alpha")
    expect(onCreatePopoverSession).toHaveBeenCalledWith("beta")
  })

  it("shows an empty state only for agents whose session source loaded authoritatively", () => {
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          agents={[
            { agentTypeId: "alpha", label: "Alpha", sessionsStatus: "loaded" },
            { agentTypeId: "beta", label: "Beta", sessionsStatus: "loading" },
          ]}
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

    expect(screen.getByLabelText("Alpha idle")).toBeInTheDocument()
    expect(screen.getByLabelText("Beta idle")).toBeInTheDocument()
    expect(screen.getAllByText("No chats yet.")).toHaveLength(1)
    expect(screen.getByText("Loading chats…")).toBeInTheDocument()
  })

  it("clears stale presence after definitive session deletion and agent removal", () => {
    const baseProps = {
      appTitle: "Test",
      activeSessionRef: { sessionId: "shared", agentTypeId: "alpha" },
      openSessionRefs: [{ sessionId: "shared", agentTypeId: "alpha" }],
      pinnedSessionIds: [],
      onCreateSession: vi.fn(),
      onOpenCommandPalette: vi.fn(),
      onSwitchSession: vi.fn(),
      onOpenSessionAsPane: vi.fn(),
      onToggleSessionPinned: vi.fn(),
    }
    const { rerender } = render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          {...baseProps}
          agents={[
            { agentTypeId: "alpha", label: "Alpha", sessionsStatus: "loaded" },
            { agentTypeId: "beta", label: "Beta", sessionsStatus: "loaded" },
          ]}
          sessions={[
            { id: "shared", agentTypeId: "alpha", title: "Alpha shared" },
            { id: "shared", agentTypeId: "beta", title: "Beta shared" },
          ]}
        />
      </WorkspaceAttentionProvider>,
    )

    act(() => {
      window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
        detail: { sessionId: "shared", agentTypeId: "alpha", working: true },
      }))
      window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
        detail: { sessionId: "shared", agentTypeId: "beta", working: true },
      }))
    })
    expect(screen.getByLabelText("Alpha streaming")).toBeInTheDocument()
    expect(screen.getByLabelText("Beta streaming")).toBeInTheDocument()

    rerender(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          {...baseProps}
          agents={[{ agentTypeId: "alpha", label: "Alpha", sessionsStatus: "loaded" }]}
          sessions={[]}
        />
      </WorkspaceAttentionProvider>,
    )

    expect(screen.getByLabelText("Alpha idle")).toBeInTheDocument()
    expect(screen.queryByLabelText("Beta streaming")).not.toBeInTheDocument()
    expect(document.querySelector('[data-boring-badge="working"]')).not.toBeInTheDocument()
  })

  it("keeps presence until every mounted owner releases the session and agent lease", () => {
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          agents={[
            { agentTypeId: "alpha", label: "Alpha", sessionsStatus: "loaded" },
            { agentTypeId: "beta", label: "Beta", sessionsStatus: "loaded" },
          ]}
          sessions={[{ id: "a1", agentTypeId: "alpha", title: "Alpha chat" }]}
          pinnedSessionIds={[]}
          onCreateSession={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    act(() => {
      window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
        detail: { sessionId: "a1", agentTypeId: "alpha", presenceOwnerId: "pane-one", working: true },
      }))
      window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
        detail: { sessionId: "a1", agentTypeId: "alpha", presenceOwnerId: "pane-two", working: true },
      }))
    })
    expect(screen.getByLabelText("Alpha streaming")).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
        detail: { sessionId: "a1", agentTypeId: "alpha", presenceOwnerId: "pane-one", working: false },
      }))
    })
    expect(screen.getByLabelText("Alpha streaming")).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
        detail: { sessionId: "a1", agentTypeId: "alpha", presenceOwnerId: "pane-two", working: false },
      }))
    })
    expect(screen.getByLabelText("Alpha idle")).toBeInTheDocument()
    expect(document.querySelector('[data-boring-badge="working"]')).not.toBeInTheDocument()
  })

  it("keeps pinned addressed sessions inside their owner group", () => {
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          agents={[
            { agentTypeId: "alpha", label: "Alpha", sessionsStatus: "loaded" },
            { agentTypeId: "beta", label: "Beta", sessionsStatus: "loaded" },
          ]}
          sessions={[
            { id: "shared", agentTypeId: "alpha", title: "Alpha shared" },
            { id: "shared", agentTypeId: "beta", title: "Beta pinned" },
          ]}
          pinnedSessionRefs={[{ sessionId: "shared", agentTypeId: "beta" }]}
          onCreateSession={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    expect(screen.queryByText("Pinned")).not.toBeInTheDocument()
    expect(screen.getByText("Alpha shared")).toBeInTheDocument()
    expect(screen.getByText("Beta pinned")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Unpin Beta pinned" })).toBeInTheDocument()
  })

  it("preserves addressed grouping in multi-project mode", () => {
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          layoutMode="multi-project"
          activeProjectId="project-a"
          projects={[{ id: "project-a", name: "Project A" }]}
          agents={[
            { agentTypeId: "alpha", label: "Alpha", sessionsStatus: "loaded" },
            { agentTypeId: "beta", label: "Beta", sessionsStatus: "loaded" },
          ]}
          sessions={[
            { id: "a1", agentTypeId: "alpha", title: "Alpha chat" },
            { id: "b1", agentTypeId: "beta", title: "Beta chat" },
          ]}
          onCreateSession={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    expect(screen.getByText("Alpha chat")).toBeInTheDocument()
    expect(screen.getByText("Beta chat")).toBeInTheDocument()
    expect(screen.getByLabelText("Alpha idle")).toBeInTheDocument()
    expect(screen.getByLabelText("Beta idle")).toBeInTheDocument()
    expect(screen.getByText("Project A")).toBeInTheDocument()
  })

  it("shows one named new-chat row without collapse chrome for one addressed agent", () => {
    const onCreateSession = vi.fn()
    const onCreateSplitSession = vi.fn()
    const onCreatePopoverSession = vi.fn()
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          agents={[{ agentTypeId: "alpha", label: "Alpha" }]}
          sessions={[{ id: "a1", agentTypeId: "alpha", title: "Alpha chat" }]}
          activeSessionRef={{ sessionId: "a1", agentTypeId: "alpha" }}
          openSessionRefs={[{ sessionId: "a1", agentTypeId: "alpha" }]}
          pinnedSessionIds={[]}
          onCreateSession={onCreateSession}
          onCreateSplitSession={onCreateSplitSession}
          onCreatePopoverSession={onCreatePopoverSession}
          onOpenCommandPalette={vi.fn()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    expect(screen.queryByRole("combobox", { name: "Agent" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Agents" })).not.toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Agents available for new chat" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "New chat with Alpha" }))
    fireEvent.click(screen.getByRole("button", { name: "New chat with Alpha in split" }))
    fireEvent.click(screen.getByRole("button", { name: "Quick chat with Alpha" }))

    expect(onCreateSession).toHaveBeenCalledWith("alpha")
    expect(onCreateSplitSession).toHaveBeenCalledWith("alpha")
    expect(onCreatePopoverSession).toHaveBeenCalledWith("alpha")
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
