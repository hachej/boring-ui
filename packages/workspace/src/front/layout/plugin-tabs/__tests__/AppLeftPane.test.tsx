import { useEffect } from "react"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { WorkspaceAttentionProvider, useWorkspaceAttention } from "../../../attention/WorkspaceAttentionProvider"
import { workspaceSessionKey } from "../../../sessionIdentity"
import { AppLeftPane, AppLeftRail } from "../AppLeftPane"
import { PluginTabsWorkspaceShell } from "../PluginTabsWorkspaceShell"

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
  it("places New chat at the top of Chats before the scrolling session list", () => {
    renderPane()

    const appNav = screen.getByLabelText("App navigation")
    const workspaceHeading = within(appNav).getByRole("heading", { name: "Workspace" })
    const chatsHeading = within(appNav).getByRole("heading", { name: "Chats" })
    const sessionScroll = appNav.querySelector('[data-boring-workspace-part="app-left-session-scroll"]')
    const newChat = appNav.querySelector('[data-boring-workspace-part="app-left-new-chat"]')

    expect(workspaceHeading.compareDocumentPosition(chatsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(chatsHeading.compareDocumentPosition(newChat as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect((newChat as Node).compareDocumentPosition(sessionScroll as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(sessionScroll).toContainElement(screen.getByText("First session"))
    expect(sessionScroll).not.toContainElement(screen.getByRole("button", { name: "New chat" }))
    expect(newChat).toContainElement(screen.getByRole("button", { name: "New chat" }))
  })

  it("renders a compact Agent tree with scoped chat actions and detail entry points", async () => {
    const user = userEvent.setup()
    const onCreateSession = vi.fn()
    const onCreateSplitSession = vi.fn()
    const onCreatePopoverSession = vi.fn()
    const onOpenAgentDetails = vi.fn()
    const onOpenAgentSettings = vi.fn()
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          agents={[
            { agentTypeId: "alpha", label: "Boring Alpha", sessionsStatus: "loaded" },
            { agentTypeId: "beta", label: "Boring Beta", sessionsStatus: "loaded" },
          ]}
          selectedAgentTypeId="alpha"
          pinnedSessionRefs={[{ agentTypeId: "alpha", sessionId: "alpha-one" }]}
          sessions={[
            { id: "alpha-one", agentTypeId: "alpha", title: "Alpha session" },
            { id: "beta-one", agentTypeId: "beta", title: "Beta session" },
          ]}
          onCreateSession={onCreateSession}
          onCreateSplitSession={onCreateSplitSession}
          onCreatePopoverSession={onCreatePopoverSession}
          onOpenAgentDetails={onOpenAgentDetails}
          onOpenAgentSettings={onOpenAgentSettings}
          onOpenCommandPalette={vi.fn()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    expect(screen.queryByLabelText("Filter chats by Agent")).not.toBeInTheDocument()
    expect(screen.getByText("Pinned chats")).toBeInTheDocument()
    const nestedAlphaRow = within(screen.getByRole("region", { name: "Boring Alpha sessions" })).getByText("Alpha session").closest('[data-boring-workspace-part="app-session-row"]')
    expect(nestedAlphaRow?.querySelector(".app-left-session-trailing svg")).toBeInTheDocument()
    const pinnedAlphaRow = screen.getAllByText("Alpha session")[0]!.closest('[data-boring-workspace-part="app-session-row"]')
    expect(pinnedAlphaRow).toHaveTextContent("Alpha")
    expect(screen.queryByTitle("Active session")).not.toBeInTheDocument()
    act(() => window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
      detail: { sessionId: "alpha-one", agentTypeId: "alpha", working: true },
    })))
    expect(screen.getAllByTitle("Active session")).toHaveLength(2)
    expect(pinnedAlphaRow).not.toHaveTextContent("working")
    expect(pinnedAlphaRow).toHaveTextContent("Alpha")
    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(1)
    await waitFor(() => expect(screen.getAllByText("Alpha session")).toHaveLength(2))
    expect(screen.queryByText("Beta session")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Start new chat with Boring Alpha" }))
    await user.click(screen.getByRole("button", { name: "Start split chat with Boring Alpha" }))
    await user.click(screen.getByRole("button", { name: "Start quick chat with Boring Alpha" }))
    expect(onCreateSession).toHaveBeenCalledWith("alpha")
    expect(onCreateSplitSession).toHaveBeenCalledWith("alpha")
    expect(onCreatePopoverSession).toHaveBeenCalledWith("alpha")
    await user.click(screen.getByRole("button", { name: "Choose Agent for new chat" }))
    await user.click(screen.getByRole("menuitem", { name: "Beta" }))
    expect(onCreateSession).toHaveBeenCalledWith("beta")

    await user.click(screen.getByRole("button", { name: "Collapse Boring Alpha; 1 session" }))
    expect(screen.queryByRole("region", { name: "Boring Alpha sessions" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Settings for Boring Alpha" }))
    await user.click(screen.getByRole("button", { name: "New chat with Boring Alpha" }))
    await user.click(screen.getByRole("button", { name: "New chat with Boring Alpha in split pane" }))
    await user.click(screen.getByRole("button", { name: "Quick chat with Boring Alpha" }))

    expect(onOpenAgentDetails).not.toHaveBeenCalled()
    expect(onOpenAgentSettings).toHaveBeenCalledWith("alpha")
    expect(onCreateSession).toHaveBeenCalledWith("alpha")
    expect(onCreateSplitSession).toHaveBeenCalledWith("alpha")
    expect(onCreatePopoverSession).toHaveBeenCalledWith("alpha")

    expect(screen.getByText("Beta session")).toBeInTheDocument()

    const filter = screen.getByRole("searchbox", { name: "Filter Agents" })
    await user.type(filter, "beta")
    expect(screen.queryByText("Alpha", { selector: ".app-left-agent-row span" })).not.toBeInTheDocument()
    expect(screen.getByText("Beta", { selector: ".app-left-agent-row span" })).toBeInTheDocument()
  })

  it("uses a flat Chats list in single-Agent and multi-project modes", () => {
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          layoutMode="multi-project"
          projects={[{ id: "project", name: "Project", sessions: [] }]}
          activeProjectId="project"
          agents={[{ agentTypeId: "solo", label: "Boring Solo", sessionsStatus: "loaded" }]}
          selectedAgentTypeId="solo"
          sessions={[]}
          onCreateSession={vi.fn()}
          onCreateSplitSession={vi.fn()}
          onCreatePopoverSession={vi.fn()}
          onOpenAgentDetails={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    expect(screen.getByRole("heading", { name: "Chats" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "New chat" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Select Boring Solo; 0 sessions" })).not.toBeInTheDocument()
    expect(screen.getByText("Project")).toBeInTheDocument()
  })

  it("renders icon-only collapsed shortcuts with accessible labels", () => {
    const onCreateSession = vi.fn()
    const onOpenCommandPalette = vi.fn()
    const onOpenTasks = vi.fn()
    render(
      <AppLeftRail
        actions={[
          { id: "tasks", label: "Tasks", icon: <span>T</span>, onClick: onOpenTasks, active: true },
          { id: "inbox", label: "Inbox", icon: null, trailing: "3", onClick: vi.fn() },
        ]}
        onCreateSession={onCreateSession}
        onOpenCommandPalette={onOpenCommandPalette}
      />,
    )

    const rail = screen.getByLabelText("Collapsed app navigation")
    fireEvent.click(within(rail).getByRole("button", { name: "Search" }))
    fireEvent.click(within(rail).getByRole("button", { name: "Tasks" }))
    fireEvent.click(within(rail).getByRole("button", { name: "New chat" }))

    expect(onOpenCommandPalette).toHaveBeenCalledOnce()
    expect(onOpenTasks).toHaveBeenCalledOnce()
    expect(onCreateSession).toHaveBeenCalledOnce()
    expect(within(rail).getByRole("button", { name: "Tasks" })).toHaveAttribute("aria-current", "page")
    expect(within(rail).getByRole("button", { name: "Inbox" }).querySelector("svg")).toBeInTheDocument()
    expect(within(rail).getByText("3")).toBeInTheDocument()
    expect(within(rail).queryByText("Search")).not.toBeInTheDocument()
    expect(within(rail).queryByText("New chat")).not.toBeInTheDocument()
  })

  it("keeps mobile drawer controls open for multi-step interactions", () => {
    const originalWidth = window.innerWidth
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 500 })
    const onProjectExpand = vi.fn()
    render(
      <PluginTabsWorkspaceShell
        collapsed={false}
        mobileShellEnabled
        leftPane={(
          <aside data-boring-workspace-part="app-left-pane" style={{ width: 420, minWidth: 420, maxWidth: 420 }}>
            <button type="button" onClick={onProjectExpand}>Expand project</button>
            <button type="button" data-boring-mobile-dismiss="true">Open chat</button>
          </aside>
        )}
        collapsedRail={<div>Rail</div>}
        onExpand={vi.fn()}
        onCollapse={vi.fn()}
      >
        <div>Content</div>
      </PluginTabsWorkspaceShell>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Open app navigation" }))
    const overlay = document.querySelector('[data-boring-workspace-part="app-left-mobile-overlay"]')
    expect(overlay).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Expand project" }))
    expect(onProjectExpand).toHaveBeenCalledOnce()
    expect(overlay).toBeInTheDocument()
    expect(overlay).toHaveClass("[&>[data-boring-workspace-part=app-left-pane]]:!w-full")
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }))
    expect(document.querySelector('[data-boring-workspace-part="app-left-mobile-overlay"]')).not.toBeInTheDocument()
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth })
  })

  it("distinguishes a loading chat list from an empty one", () => {
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          sessions={[]}
          sessionsLoading
          onCreateSession={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    expect(screen.getByText("Loading chats…")).toBeInTheDocument()
    expect(screen.queryByText("No chats yet.")).not.toBeInTheDocument()
  })

  it("shows working state beside session names", () => {
    renderPane()

    act(() => {
      window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
        detail: { sessionId: "s2", working: true },
      }))
    })

    const badge = document.querySelector('[data-boring-badge="working"]')
    expect(badge).toBeInTheDocument()
    expect(badge?.closest('[data-boring-workspace-part="app-session-row"]')).toHaveTextContent("Second session")
  })

  it("requests current working state when the session list mounts after the chat panel", async () => {
    const onRequest = () => window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
      detail: { sessionId: "s2", working: true },
    }))
    window.addEventListener("boring:chat-session-status-request", onRequest)

    try {
      renderPane()

      await waitFor(() => expect(document.querySelector('[data-boring-badge="working"]')
        ?.closest('[data-boring-workspace-part="app-session-row"]')).toHaveTextContent("Second session"))
    } finally {
      window.removeEventListener("boring:chat-session-status-request", onRequest)
    }
  })

  it("clears optimistic working state from an authoritative idle session refresh", async () => {
    const props = {
      appTitle: "Test",
      activeSessionId: "s1",
      openSessionIds: ["s1"],
      pinnedSessionIds: [],
      onCreateSession: vi.fn(),
      onOpenCommandPalette: vi.fn(),
      onSwitchSession: vi.fn(),
      onOpenSessionAsPane: vi.fn(),
      onToggleSessionPinned: vi.fn(),
    }
    const { rerender } = render(
      <WorkspaceAttentionProvider>
        <AppLeftPane {...props} sessions={sessions} />
      </WorkspaceAttentionProvider>,
    )
    act(() => window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
      detail: { sessionId: "s2", working: true },
    })))
    expect(document.querySelector('[data-boring-badge="working"]')).toBeInTheDocument()

    rerender(
      <WorkspaceAttentionProvider>
        <AppLeftPane {...props} sessions={sessions.map((session) => ({ ...session, status: "idle" as const }))} />
      </WorkspaceAttentionProvider>,
    )

    await waitFor(() => expect(document.querySelector('[data-boring-badge="working"]')).toBeNull())
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
    fireEvent.click(badge as Element)
    expect(onSwitchSession).toHaveBeenCalledWith("s2")
  })

  it("keeps structured addressed refs distinct from a colliding raw legacy id", async () => {
    const user = userEvent.setup()
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
    await user.click(screen.getByRole("button", { name: "Chat actions for Addressed session" }))
    await user.click(screen.getByRole("menuitem", { name: "Unpin chat" }))
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
