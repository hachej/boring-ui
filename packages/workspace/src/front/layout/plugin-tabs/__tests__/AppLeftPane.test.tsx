import { useEffect, useState } from "react"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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

  it("renders collapsible Workspace, Agents, Pinned, and Chats sections in order", () => {
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
            { id: "b1", agentTypeId: "beta", title: "Beta pinned" },
          ]}
          activeSessionRef={{ sessionId: "a1", agentTypeId: "alpha" }}
          openSessionRefs={[{ sessionId: "a1", agentTypeId: "alpha" }]}
          pinnedSessionRefs={[{ sessionId: "b1", agentTypeId: "beta" }]}
          onCreateSession={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          actions={[{ id: "inbox", label: "Inbox", icon: null, onClick: vi.fn() }]}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    expect([...document.querySelectorAll('[data-boring-workspace-part="app-left-pane-section"]')]
      .map((section) => section.getAttribute("data-boring-section"))).toEqual([
      "workspace",
      "agents",
      "pinned",
      "chats",
    ])
    const workspace = screen.getByRole("region", { name: "Workspace" })
    const workspaceToggle = screen.getByRole("button", { name: "Workspace" })
    expect(workspaceToggle).toHaveAttribute("aria-expanded", "true")
    expect(within(workspace).getByRole("button", { name: "Search" })).toBeInTheDocument()
    expect(within(workspace).getByRole("button", { name: "Inbox" })).toBeInTheDocument()
    fireEvent.click(workspaceToggle)
    expect(workspaceToggle).toHaveAttribute("aria-expanded", "false")
    expect(within(workspace).queryByRole("button", { name: "Search" })).not.toBeInTheDocument()
    expect(within(workspace).queryByRole("button", { name: "Inbox" })).not.toBeInTheDocument()
    expect(document.querySelector('[data-boring-workspace-part="app-left-agent-sessions"]')).not.toBeInTheDocument()
    expect(within(screen.getByRole("region", { name: "Chats" })).getByText("Alpha chat")).toBeInTheDocument()
    expect(within(screen.getByRole("region", { name: "Pinned" })).getByText("Beta pinned")).toBeInTheDocument()
    expect(within(screen.getByRole("region", { name: "Alpha agent" })).queryByText("Alpha chat")).not.toBeInTheDocument()
    expect(within(screen.getByRole("region", { name: "Beta agent" })).queryByText("Beta pinned")).not.toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Agent" })).not.toBeInTheDocument()

    const agentsToggle = screen.getByRole("button", { name: "Agents" })
    expect(agentsToggle).toHaveAttribute("aria-expanded", "true")
    fireEvent.click(agentsToggle)
    expect(agentsToggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("region", { name: "Alpha agent" })).not.toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "Beta agent" })).not.toBeInTheDocument()
    fireEvent.click(agentsToggle)
    expect(agentsToggle).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("region", { name: "Alpha agent" })).toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Beta agent" })).toBeInTheDocument()

    const pinned = screen.getByRole("region", { name: "Pinned" })
    const pinnedToggle = screen.getByRole("button", { name: "Pinned" })
    expect(pinnedToggle).toHaveAttribute("aria-expanded", "true")
    fireEvent.click(pinnedToggle)
    expect(pinnedToggle).toHaveAttribute("aria-expanded", "false")
    expect(within(pinned).queryByText("Beta pinned")).not.toBeInTheDocument()
    fireEvent.click(pinnedToggle)
    expect(pinnedToggle).toHaveAttribute("aria-expanded", "true")
    expect(within(pinned).getByText("Beta pinned")).toBeInTheDocument()

    const chats = screen.getByRole("region", { name: "Chats" })
    const chatsToggle = screen.getByRole("button", { name: "Chats" })
    expect(chatsToggle).toHaveAttribute("aria-expanded", "true")
    fireEvent.click(chatsToggle)
    expect(chatsToggle).toHaveAttribute("aria-expanded", "false")
    expect(within(chats).queryByText("Alpha chat")).not.toBeInTheDocument()
    fireEvent.click(chatsToggle)
    expect(chatsToggle).toHaveAttribute("aria-expanded", "true")
    expect(within(chats).getByText("Alpha chat")).toBeInTheDocument()

    const agentRow = within(screen.getByRole("region", { name: "Alpha agent" }))
      .getByText("Alpha")
      .closest('[data-boring-workspace-part="app-agent-row"]')
    const sessionRow = screen.getByText("Alpha chat").closest('[data-boring-workspace-part="app-session-row"]')
    const pinnedSessionRow = screen.getByText("Beta pinned").closest('[data-boring-workspace-part="app-session-row"]')
    const sharedGeometry = [
      "h-11",
      "gap-2",
      "rounded-md",
      "border",
      "border-transparent",
      "px-2.5",
      "[@media(hover:hover)_and_(min-width:640px)]:h-8",
      "[@media(hover:hover)_and_(min-width:640px)]:py-1",
    ]
    expect(agentRow).toHaveClass(...sharedGeometry)
    expect(sessionRow).toHaveClass(...sharedGeometry)
    expect(agentRow?.querySelector(".lucide-bot")).toBeInTheDocument()
    expect(sessionRow?.querySelector(".lucide-message-square")).toBeInTheDocument()
    expect(pinnedSessionRow?.querySelector(".lucide-message-square")).toBeInTheDocument()
    expect(within(pinnedSessionRow as HTMLElement).getByRole("button", { name: "Unpin Beta pinned" })).toHaveAttribute("aria-pressed", "true")
    expect(agentRow).not.toHaveClass("group")
    expect(agentRow).not.toHaveClass("cursor-pointer")
    expect(sessionRow).toHaveClass("group", "cursor-pointer")

    act(() => {
      window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
        detail: { sessionId: "a1", agentTypeId: "alpha", working: true },
      }))
    })

    expect(screen.getByLabelText("Alpha streaming")).toHaveAttribute("data-boring-agent-activity", "streaming")
    expect(screen.getByLabelText("Beta idle")).toHaveAttribute("data-boring-agent-activity", "idle")
    expect(document.querySelector('[data-boring-badge="working"]')).not.toBeInTheDocument()
  })

  it("shows every unpinned session in recency order and filters Chats by agent", async () => {
    const user = userEvent.setup()
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          agents={[
            { agentTypeId: "alpha", label: "Alpha", sessionsStatus: "loaded" },
            { agentTypeId: "beta", label: "Beta", sessionsStatus: "loaded" },
          ]}
          sessions={[
            { id: "a1", agentTypeId: "alpha", title: "Alpha closed", updatedAt: 100 },
            { id: "a2", agentTypeId: "alpha", title: "Alpha open", updatedAt: 300 },
            { id: "b1", agentTypeId: "beta", title: "Beta open", updatedAt: 200 },
          ]}
          activeSessionRef={{ sessionId: "b1", agentTypeId: "beta" }}
          openSessionRefs={[
            { sessionId: "a2", agentTypeId: "alpha" },
            { sessionId: "b1", agentTypeId: "beta" },
          ]}
          onCreateSession={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    const chats = screen.getByRole("region", { name: "Chats" })
    expect(within(chats).getByText("Alpha closed")).toBeInTheDocument()
    expect(within(chats).getByText("Alpha open")).toBeInTheDocument()
    expect(within(chats).getByText("Beta open")).toBeInTheDocument()
    expect(within(chats).getAllByText(/Alpha (closed|open)|Beta open/).map((node) => node.textContent)).toEqual([
      "Alpha open",
      "Beta open",
      "Alpha closed",
    ])
    expect(within(chats).getAllByText("Alpha")).toHaveLength(2)
    expect(within(chats).getAllByText("Alpha")[0]).toHaveAttribute("data-boring-agent-badge", "alpha")
    expect(within(chats).getByText("Beta")).toHaveAttribute("data-boring-agent-badge", "beta")
    const closedSplitAction = within(chats).getByRole("button", { name: "Open Alpha closed in split" })
    expect(closedSplitAction.parentElement).toHaveClass(
      "w-auto",
      "opacity-100",
      "[@media(hover:hover)_and_(min-width:640px)]:w-0",
      "[@media(hover:hover)_and_(min-width:640px)]:opacity-0",
      "[@media(hover:hover)_and_(min-width:640px)]:group-hover:w-auto",
      "[@media(hover:hover)_and_(min-width:640px)]:group-hover:opacity-100",
      "[@media(hover:hover)_and_(min-width:640px)]:group-focus-within:w-auto",
      "[@media(hover:hover)_and_(min-width:640px)]:group-focus-within:opacity-100",
    )

    const allFilter = within(chats).getByRole("button", { name: "Filter chats: All" })
    expect(allFilter).toHaveClass("size-11", "[@media(hover:hover)_and_(min-width:640px)]:size-6")
    expect(allFilter.querySelector(".lucide-funnel")).toBeInTheDocument()
    expect(allFilter).not.toHaveTextContent("All")
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
    await user.click(allFilter)
    await user.click(screen.getByRole("menuitemradio", { name: "Beta" }))
    expect(within(chats).queryByText("Alpha closed")).not.toBeInTheDocument()
    expect(within(chats).queryByText("Alpha open")).not.toBeInTheDocument()
    expect(within(chats).getByText("Beta open")).toBeInTheDocument()
    const betaFilter = within(chats).getByRole("button", { name: "Filter chats: Beta" })
    expect(betaFilter).toHaveAttribute("data-active", "true")
    expect(betaFilter).toHaveTextContent("Beta")

    await user.click(betaFilter)
    await user.click(screen.getByRole("menuitemradio", { name: "All agents" }))
    expect(within(chats).getByText("Alpha closed")).toBeInTheDocument()
    expect(within(chats).getByText("Alpha open")).toBeInTheDocument()
    expect(within(chats).getByText("Beta open")).toBeInTheDocument()
    expect(within(chats).getByRole("button", { name: "Filter chats: All" })).not.toHaveTextContent("Beta")
  })

  it("can filter an agent whose id is all without colliding with the All option", async () => {
    const user = userEvent.setup()
    render(
      <WorkspaceAttentionProvider>
        <AppLeftPane
          appTitle="Test"
          agents={[
            { agentTypeId: "all", label: "All-purpose" },
            { agentTypeId: "beta", label: "Beta" },
          ]}
          sessions={[
            { id: "all-1", agentTypeId: "all", title: "All-purpose chat" },
            { id: "beta-1", agentTypeId: "beta", title: "Beta chat" },
          ]}
          onCreateSession={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={vi.fn()}
        />
      </WorkspaceAttentionProvider>,
    )

    const chats = screen.getByRole("region", { name: "Chats" })
    await user.click(within(chats).getByRole("button", { name: "Filter chats: All" }))
    await user.click(screen.getByRole("menuitemradio", { name: "All-purpose" }))
    expect(within(chats).getByText("All-purpose chat")).toBeInTheDocument()
    expect(within(chats).queryByText("Beta chat")).not.toBeInTheDocument()
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
    expect(agentsToggle).toHaveAttribute("aria-expanded", "true")
    expect(screen.queryByRole("list", { name: "Agents available for new chat" })).not.toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Alpha agent" })).toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Beta agent" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Expand .* agent/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Collapse .* agent/ })).not.toBeInTheDocument()
    expect(document.querySelector('[aria-label$=" chats"]')).not.toBeInTheDocument()
    const betaAgent = screen.getByRole("region", { name: "Beta agent" })
    expect(within(betaAgent).getByText("Beta").closest("button")).toBeNull()
    expect(within(betaAgent).getByText("Beta")).toHaveClass("min-w-0", "truncate")
    expect(within(betaAgent).getAllByRole("button")).toHaveLength(3)
    expect(within(betaAgent).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "New chat with Beta",
      "New chat with Beta in split",
      "Quick chat with Beta",
    ])
    const betaAction = screen.getByRole("button", { name: "New chat with Beta" })
    const alphaSplitAction = screen.getByRole("button", { name: "New chat with Alpha in split" })
    const betaQuickAction = screen.getByRole("button", { name: "Quick chat with Beta" })
    const betaAgentRow = betaAction.parentElement?.parentElement
    expect(betaAction).toHaveClass("size-11", "[@media(hover:hover)_and_(min-width:640px)]:size-6")
    expect(betaAgentRow).toHaveClass(
      "h-11",
      "gap-2",
      "rounded-md",
      "border",
      "border-transparent",
      "px-2.5",
      "[@media(hover:hover)_and_(min-width:640px)]:h-8",
      "[@media(hover:hover)_and_(min-width:640px)]:py-1",
    )
    for (const className of [
      "group",
      "cursor-pointer",
      "hover:bg-foreground/[0.055]",
      "hover:text-foreground",
    ]) {
      expect(betaAgentRow).not.toHaveClass(className)
    }
    expect(betaAction).toHaveClass("cursor-pointer", "hover:bg-background", "hover:text-foreground")
    expect(betaAction.querySelector(".lucide-plus")).toBeInTheDocument()
    expect(alphaSplitAction).toHaveClass(
      "cursor-pointer",
      "hover:bg-background",
      "hover:text-foreground",
      "focus-visible:ring-2",
      "size-11",
      "[@media(hover:hover)_and_(min-width:640px)]:size-6",
    )
    expect(alphaSplitAction.querySelector(".lucide-columns-2")).toBeInTheDocument()
    expect(betaQuickAction).toHaveClass("cursor-pointer", "hover:bg-background", "hover:text-foreground", "focus-visible:ring-2")
    expect(betaQuickAction.querySelector(".lucide-zap")).toBeInTheDocument()
    expect(alphaSplitAction.parentElement).toHaveClass("flex", "shrink-0", "items-center", "gap-0.5")

    fireEvent.click(betaAction)
    fireEvent.click(alphaSplitAction)
    fireEvent.click(betaQuickAction)

    expect(onCreateSession).toHaveBeenCalledWith("beta")
    expect(onCreateSplitSession).toHaveBeenCalledWith("alpha")
    expect(onCreatePopoverSession).toHaveBeenCalledWith("beta")
  })

  it("does not render per-agent session empty states", () => {
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
    expect(screen.queryByText("Loading chats…")).not.toBeInTheDocument()
    expect(screen.queryByText("Chats unavailable.")).not.toBeInTheDocument()
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

  it("moves pinned addressed sessions from Chats to the shared Pinned section", () => {
    function MultiAgentPinHarness() {
      const [pinnedSessionRefs, setPinnedSessionRefs] = useState<Array<{ sessionId: string; agentTypeId: string }>>([])
      return (
        <AppLeftPane
          appTitle="Test"
          agents={[
            { agentTypeId: "alpha", label: "Alpha", sessionsStatus: "loaded" },
            { agentTypeId: "beta", label: "Beta", sessionsStatus: "loaded" },
          ]}
          sessions={[
            { id: "alpha-one", agentTypeId: "alpha", title: "Alpha shared" },
            { id: "beta-newer", agentTypeId: "beta", title: "Beta newer" },
            { id: "beta-pin", agentTypeId: "beta", title: "Beta pinned" },
          ]}
          activeSessionRef={{ sessionId: "beta-newer", agentTypeId: "beta" }}
          openSessionRefs={[{ sessionId: "beta-newer", agentTypeId: "beta" }]}
          pinnedSessionRefs={pinnedSessionRefs}
          onCreateSession={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          onSwitchSession={vi.fn()}
          onOpenSessionAsPane={vi.fn()}
          onToggleSessionPinned={(sessionId, agentTypeId) => {
            if (!agentTypeId) return
            setPinnedSessionRefs((current) => (
              current.some((ref) => ref.sessionId === sessionId && ref.agentTypeId === agentTypeId)
                ? current.filter((ref) => ref.sessionId !== sessionId || ref.agentTypeId !== agentTypeId)
                : [{ sessionId, agentTypeId }, ...current]
            ))
          }}
        />
      )
    }

    render(
      <WorkspaceAttentionProvider>
        <MultiAgentPinHarness />
      </WorkspaceAttentionProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Pin Beta pinned" }))

    const pinned = screen.getByRole("region", { name: "Pinned" })
    const chats = screen.getByRole("region", { name: "Chats" })
    expect(within(pinned).getByText("Beta pinned")).toBeInTheDocument()
    expect(within(pinned).getByText("Beta")).toHaveAttribute("data-boring-agent-badge", "beta")
    expect(within(chats).queryByText("Beta pinned")).not.toBeInTheDocument()
    expect(screen.getAllByText("Beta pinned")).toHaveLength(1)

    fireEvent.click(within(pinned).getByRole("button", { name: "Unpin Beta pinned" }))
    expect(screen.queryByRole("region", { name: "Pinned" })).not.toBeInTheDocument()
    expect(within(chats).getByText("Beta pinned")).toBeInTheDocument()
    expect(screen.getAllByText("Beta pinned")).toHaveLength(1)
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

    expect(within(screen.getByRole("region", { name: "Chats" })).getByText("Alpha chat")).toBeInTheDocument()
    expect(within(screen.getByRole("region", { name: "Chats" })).getByText("Beta chat")).toBeInTheDocument()
    expect(within(screen.getByRole("region", { name: "Alpha agent" })).queryByText("Alpha chat")).not.toBeInTheDocument()
    expect(within(screen.getByRole("region", { name: "Beta agent" })).queryByText("Beta chat")).not.toBeInTheDocument()
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
          pinnedSessionRefs={[{ sessionId: "a1", agentTypeId: "alpha" }]}
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
    expect(screen.getByRole("button", { name: "Workspace" })).toHaveAttribute("aria-expanded", "true")
    expect(screen.queryByRole("button", { name: /Filter chats:/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Agents" })).not.toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "Agents" })).not.toBeInTheDocument()
    expect(document.querySelector('[data-boring-workspace-part="app-left-agent-group"]')).not.toBeInTheDocument()
    expect(document.querySelector('[data-boring-workspace-part="app-left-agent-sessions"]')).not.toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Agents available for new chat" })).not.toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "Pinned" })).not.toBeInTheDocument()
    expect(document.querySelector("[data-boring-agent-badge]")).not.toBeInTheDocument()
    expect(screen.getByText("Alpha chat")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Unpin Alpha chat" })).toBeInTheDocument()
    const newChatAction = screen.getByRole("button", { name: "New chat with Alpha" })
    const agentRow = newChatAction.parentElement?.parentElement
    expect(agentRow).not.toBeNull()
    expect(agentRow?.querySelector(".lucide-bot")).toBeInTheDocument()
    expect(within(agentRow as HTMLElement).getByText("Alpha").closest("button")).toBeNull()
    for (const className of [
      "group",
      "cursor-pointer",
      "hover:bg-foreground/[0.055]",
      "hover:text-foreground",
    ]) {
      expect(agentRow).not.toHaveClass(className)
    }
    expect(newChatAction).toHaveClass("size-11", "[@media(hover:hover)_and_(min-width:640px)]:size-6")
    expect(within(agentRow as HTMLElement).getAllByRole("button")).toHaveLength(3)
    for (const action of within(agentRow as HTMLElement).getAllByRole("button")) {
      expect(action).toHaveClass("cursor-pointer", "hover:bg-background", "hover:text-foreground", "focus-visible:ring-2")
    }

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
