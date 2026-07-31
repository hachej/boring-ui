import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { Suspense, startTransition, useEffect, useState } from "react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT } from "../../../front/agentPlugins/reloadEvent"
import { UI_COMMAND_EVENT, type UiCommand } from "../../../front/bridge"
import type { WorkspaceChatPanelProps } from "../../../front/chrome/chat/types"
import type { PanelConfig } from "../../../front/registry/types"
import { definePlugin } from "../../../shared/plugins/frontFactory"
import type { PluginProviderProps } from "../../../shared/plugins/types"
import {
  WorkspaceAgentFront as RawWorkspaceAgentFront,
  type UseWorkspaceAgentSessions,
  type WorkspaceAgentFrontProps,
  type WorkspaceAgentSession,
  type WorkspaceAgentSessionsApi,
} from "../WorkspaceAgentFront"

/** Existing custom-hook fixtures consciously attest the source they were invoked for. */
type AttestedWorkspaceAgentFrontProps<TSession extends WorkspaceAgentSession> = Omit<WorkspaceAgentFrontProps<TSession>, "useSessions"> & {
  useSessions?: (
    options: Parameters<UseWorkspaceAgentSessions<TSession>>[0],
  ) => Omit<WorkspaceAgentSessionsApi<TSession>, "sourceIdentity"> & { sourceIdentity?: string }
}

function WorkspaceAgentFront<TSession extends WorkspaceAgentSession = WorkspaceAgentSession>(
  props: AttestedWorkspaceAgentFrontProps<TSession>,
) {
  const useSessions = props.useSessions
  const attestedUseSessions: UseWorkspaceAgentSessions<TSession> | undefined = useSessions
    ? (options) => ({ ...useSessions(options), sourceIdentity: options.sourceIdentity })
    : undefined
  return <RawWorkspaceAgentFront {...props} useSessions={attestedUseSessions} />
}

type CapturedChatPanelProps = WorkspaceChatPanelProps & {
  initialDraft?: string
  autoSubmitInitialDraft?: boolean
  hydrateMessages?: boolean
  allowPromptDuringInitialHydration?: boolean
  onAutoSubmitInitialDraftSettled?: () => void
}

function AutoSubmitProbe(props: WorkspaceChatPanelProps) {
  const captured = props as CapturedChatPanelProps
  return (
    <div
      data-testid="auto-submit-probe"
      data-session-id={props.sessionId}
      data-agent-type-id={props.agentTypeId ?? ""}
      data-auto-submit={String(captured.autoSubmitInitialDraft === true)}
      data-initial-draft={captured.initialDraft ?? ""}
      data-hydrate-messages={String(captured.hydrateMessages === true)}
    />
  )
}

function ChatPanel(props: WorkspaceChatPanelProps) {
  return (
    <div>
      <div>Chat panel</div>
      <button type="button" onClick={() => props.onOpenArtifact?.("src/example.ts")}>Open artifact</button>
    </div>
  )
}

function SessionIdChatPanel(props: WorkspaceChatPanelProps) {
  return <div data-testid="chat-pane" data-session-id={props.sessionId}>Chat pane {props.sessionId}</div>
}

function TextareaChatPanel(props: WorkspaceChatPanelProps) {
  return (
    <textarea
      name="message"
      data-testid={`composer-${props.sessionId}`}
      defaultValue={`Composer ${props.sessionId}`}
    />
  )
}

function visibleChatSessionIds(): string[] {
  return screen.getAllByTestId("chat-pane").map((node) => node.getAttribute("data-session-id") ?? "")
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

// History starts collapsed when chat panes are open; expand it so tests can
// reach history rows. No-op when there is no collapsed History toggle.
function expandHistory(): void {
  const toggle = screen.queryByRole("button", { name: "History", hidden: true })
  if (toggle && toggle.getAttribute("aria-expanded") === "false") {
    fireEvent.click(toggle)
  }
}

function GlobalCommandPanel() {
  return <div>Global command panel body</div>
}

const globalCommandPanel: PanelConfig = {
  id: "global-command-panel",
  title: "Global command panel",
  component: GlobalCommandPanel,
  lazy: false,
  source: "app",
  placement: "center",
}

class MockEventSource {
  static instances: MockEventSource[] = []
  close = vi.fn()
  addEventListener = vi.fn()
  removeEventListener = vi.fn()

  constructor(readonly url: string) {
    MockEventSource.instances.push(this)
  }
}

describe("WorkspaceAgentFront", () => {
  // Number of consecutive HTTP 503 ("Agent runtime is still preparing")
  // responses the sessions GET should return before succeeding. Default 0 so
  // every existing test keeps the original behavior; the cold-start regression
  // test below sets it to a small N for its single render.
  let sessionsFailuresRemaining = 0

  beforeEach(() => {
    localStorage.clear()
    sessionsFailuresRemaining = 0
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/api/v1/tree")) return new Response(JSON.stringify({ entries: [] }), { status: 200 })
      if (url.includes("/api/v1/agent/pi-chat/sessions")) {
        // Only the cold-start GET race is simulated; POST/DELETE pass through.
        const method = init?.method ?? "GET"
        if (method === "GET" && sessionsFailuresRemaining > 0) {
          sessionsFailuresRemaining -= 1
          return new Response(null, { status: 503 })
        }
        return new Response(JSON.stringify([]), { status: 200 })
      }
      if (url.includes("/api/v1/ready-status")) return new Response(null, { status: 200 })
      if (url.includes("/api/v1/agent-plugins")) return new Response(JSON.stringify([]), { status: 200 })
      if (url.includes("/api/v1/agent/reload")) return new Response(JSON.stringify({ reloaded: true }), { status: 200 })
      if (url.includes("/api/v1/ui/commands/next")) return new Response(JSON.stringify([]), { status: 200 })
      return new Response(null, { status: 204 })
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("forwards frontPluginHotReload to WorkspaceProvider", () => {
    MockEventSource.instances = []
    vi.stubGlobal("EventSource", MockEventSource)

    render(
      <WorkspaceAgentFront
        workspaceId="hot-reload-off"
        chatPanel={ChatPanel}
        frontPluginHotReload={false}
      />,
    )

    expect(MockEventSource.instances.filter((instance) => instance.url.includes("/api/v1/agent-plugins/events"))).toHaveLength(0)
  })

  it("externalPlugins=true preserves explicit front and chat plugin reload UX", () => {
    MockEventSource.instances = []
    vi.stubGlobal("EventSource", MockEventSource)
    let captured: WorkspaceChatPanelProps | undefined
    const CapturingChatPanel = (props: WorkspaceChatPanelProps) => {
      captured = props
      return <div>Chat panel</div>
    }

    render(
      <WorkspaceAgentFront
        workspaceId="external-plugins-on"
        chatPanel={CapturingChatPanel}
        externalPlugins
        frontPluginHotReload="vite"
        hotReloadEnabled
      />,
    )

    expect(MockEventSource.instances.filter((instance) => instance.url.includes("/api/v1/agent-plugins/events"))).toHaveLength(1)
    expect(captured?.hotReloadEnabled).toBe(true)
  })

  it("externalPlugins=false disables front and chat plugin reload UX", () => {
    MockEventSource.instances = []
    vi.stubGlobal("EventSource", MockEventSource)
    let captured: WorkspaceChatPanelProps | undefined
    const CapturingChatPanel = (props: WorkspaceChatPanelProps) => {
      captured = props
      return <div>Chat panel</div>
    }

    render(
      <WorkspaceAgentFront
        workspaceId="external-plugins-off"
        chatPanel={CapturingChatPanel}
        externalPlugins={false}
        frontPluginHotReload="vite"
        hotReloadEnabled
      />,
    )

    expect(MockEventSource.instances.filter((instance) => instance.url.includes("/api/v1/agent-plugins/events"))).toHaveLength(0)
    expect(captured?.hotReloadEnabled).toBe(false)
  })

  it("refreshes sessions when a rendered chat panel completes a turn", () => {
    const refresh = vi.fn()
    let captured: WorkspaceChatPanelProps | undefined
    const CapturingChatPanel = (props: WorkspaceChatPanelProps) => {
      captured = props
      return <div>Chat panel</div>
    }
    const activeSession = { id: "turn-complete", title: "Turn complete" }

    render(
      <WorkspaceAgentFront
        workspaceId="turn-complete-refresh"
        chatPanel={CapturingChatPanel}
        useSessions={() => ({
          sessions: [activeSession],
          activeSession,
          activeSessionId: activeSession.id,
          loading: false,
          error: null,
          create: vi.fn(),
          switch: vi.fn(),
          delete: vi.fn(),
          refresh,
        })}
      />,
    )

    act(() => { captured?.onTurnComplete?.() })

    expect(refresh).toHaveBeenCalledWith({ background: true })
  })

  it("reconciles a hydrated assistant reply in the background until the listing catches up", async () => {
    const refresh = vi.fn()
      .mockRejectedValueOnce(new Error("reconciliation failed"))
      .mockResolvedValue(undefined)
    const session = { id: "hydrated-reply", title: "Hydrated reply", hasAssistantReply: false }
    let captured: WorkspaceChatPanelProps | undefined
    const CapturingChatPanel = (props: WorkspaceChatPanelProps) => {
      captured = props
      return <div>Chat panel</div>
    }
    const useSessions = () => ({
      sessions: [session], activeSession: session, activeSessionId: session.id,
      loading: false, create: vi.fn(), switch: vi.fn(), delete: vi.fn(), refresh,
    })
    const view = render(<WorkspaceAgentFront workspaceId="hydrated-reply-refresh" chatPanel={CapturingChatPanel} useSessions={useSessions} />)

    const onHydratedAssistantReply = captured?.onHydratedAssistantReply
    expect(onHydratedAssistantReply).toEqual(expect.any(Function))
    act(() => {
      onHydratedAssistantReply?.(session.id)
    })
    expect(refresh).toHaveBeenCalledTimes(1)
    await act(async () => {})

    view.rerender(<WorkspaceAgentFront workspaceId="hydrated-reply-refresh" chatPanel={CapturingChatPanel} useSessions={useSessions} />)
    expect(captured?.onHydratedAssistantReply).toEqual(expect.any(Function))
    act(() => { captured?.onHydratedAssistantReply?.(session.id) })
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))

    session.hasAssistantReply = true
    view.rerender(<WorkspaceAgentFront workspaceId="hydrated-reply-refresh" chatPanel={CapturingChatPanel} useSessions={useSessions} />)
    expect(captured?.onHydratedAssistantReply).toBeUndefined()
  })

  it("unpins a deleted session while a hydrated assistant-reply refresh is still in flight", async () => {
    const refresh = vi.fn(() => new Promise<void>(() => {}))
    const deleted = vi.fn()
    let captured: WorkspaceChatPanelProps | undefined
    const CapturingChatPanel = (props: WorkspaceChatPanelProps) => {
      if (props.sessionId === "hydration-delete") captured = props
      return <div data-testid="chat-pane" data-session-id={props.sessionId}>Chat pane {props.sessionId}</div>
    }
    const useSessions = () => {
      const [sessions, setSessions] = useState([
        { id: "hydration-delete", title: "Delete hydration", hasAssistantReply: false },
        { id: "hydration-keep", title: "Keep hydration", hasAssistantReply: false },
      ])
      const [activeSessionId, setActiveSessionId] = useState("hydration-delete")
      return {
        sessions,
        activeSession: sessions.find((session) => session.id === activeSessionId) ?? null,
        activeSessionId,
        loading: false,
        create: vi.fn(),
        switch: setActiveSessionId,
        delete: (sessionId: string) => {
          deleted(sessionId)
          setSessions((current) => current.filter((session) => session.id !== sessionId))
          if (sessionId === activeSessionId) setActiveSessionId("hydration-keep")
        },
        refresh,
      }
    }

    localStorage.setItem("boring-workspace:pinned-sessions:hydration-delete-workspace", JSON.stringify({ ids: ["hydration-delete"] }))
    render(
      <WorkspaceAgentFront
        workspaceId="hydration-delete-workspace"
        chatPanel={CapturingChatPanel}
        useSessions={useSessions}
        defaultNavOpen
      />,
    )
    expandHistory()
    const staleHydrationCallback = captured?.onHydratedAssistantReply
    expect(staleHydrationCallback).toEqual(expect.any(Function))
    act(() => { staleHydrationCallback?.("hydration-delete") })
    expect(refresh).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByLabelText("Delete Delete hydration"))
    await waitFor(() => expect(deleted).toHaveBeenCalledWith("hydration-delete"))
    act(() => { staleHydrationCallback?.("hydration-delete") })

    expect(refresh).toHaveBeenCalledTimes(2)
    await waitFor(() => {
      expect(localStorage.getItem("boring-workspace:pinned-sessions:hydration-delete-workspace")).toBeNull()
    })
  })

  it("keeps the chat shell in transition while remote sessions are still loading without an active session", () => {
    const PendingChatPanel = (props: WorkspaceChatPanelProps) => (
      <div data-testid="chat-panel">Chat {props.sessionId} hydrate={String(props.hydrateMessages)}</div>
    )

    render(
      <WorkspaceAgentFront
        workspaceId="slow-session-list"
        chatPanel={PendingChatPanel}
        useSessions={() => ({
          sessions: [],
          activeSession: null,
          activeSessionId: null,
          loading: true,
          error: undefined,
          create: vi.fn(),
          switch: vi.fn(),
          delete: vi.fn(),
        })}
      />,
    )

    expect(screen.queryByTestId("chat-panel")).not.toBeInTheDocument()
    expect(screen.getAllByText("Loading sessions…").length).toBeGreaterThan(0)
  })

  it("renders a known active session while remote sessions are still loading", () => {
    const PendingChatPanel = (props: WorkspaceChatPanelProps) => (
      <div data-testid="chat-panel">Chat {props.sessionId} hydrate={String(props.hydrateMessages)}</div>
    )

    render(
      <WorkspaceAgentFront
        workspaceId="known-session-list"
        chatPanel={PendingChatPanel}
        useSessions={() => ({
          sessions: [],
          activeSession: null,
          activeSessionId: "known-active",
          loading: true,
          error: undefined,
          create: vi.fn(),
          switch: vi.fn(),
          delete: vi.fn(),
        })}
      />,
    )

    expect(screen.getByTestId("chat-panel")).toHaveTextContent("Chat known-active hydrate=true")
    expect(screen.queryByText("Loading sessions…")).not.toBeInTheDocument()
  })

  it("keeps authoritative chat and actions available for recoverable session errors", async () => {
    const create = vi.fn()
    const session = { id: "recoverable", title: "Recoverable session" }
    const recoverableError = Object.assign(new Error("pagination failed"), {
      kind: "recoverable" as const,
      sourceKey: "custom-source",
    })
    render(
      <WorkspaceAgentFront
        workspaceId="recoverable-session-error"
        workspaceLayout="plugin-tabs"
        chatPanel={SessionIdChatPanel}
        persistenceEnabled={false}
        useSessions={() => ({
          sessions: [session], activeSession: session, activeSessionId: session.id,
          loading: false, error: recoverableError, create, switch: vi.fn(), delete: vi.fn(),
        })}
      />,
    )

    expect(screen.getByText("Chat pane recoverable")).toBeInTheDocument()
    expect(screen.queryByText("Sessions failed to load")).not.toBeInTheDocument()
    fireEvent.click(within(screen.getByLabelText("App navigation")).getByRole("button", { name: "New chat" }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
  })

  it("exits transition and renders the explicit error state when remote sessions fail", () => {
    const FailedChatPanel = (props: WorkspaceChatPanelProps) => (
      <div data-testid="chat-panel">Chat {props.sessionId} hydrate={String(props.hydrateMessages)}</div>
    )

    render(
      <WorkspaceAgentFront
        workspaceId="failed-session-list"
        chatPanel={FailedChatPanel}
        useSessions={() => ({
          sessions: [],
          activeSession: null,
          activeSessionId: null,
          loading: false,
          error: new Error("failed"),
          create: vi.fn(),
          switch: vi.fn(),
          delete: vi.fn(),
        })}
      />,
    )

    expect(screen.queryByTestId("chat-panel")).not.toBeInTheDocument()
    expect(screen.getByText("Sessions failed to load")).toBeInTheDocument()
    expect(screen.getByText("failed")).toBeInTheDocument()
    expect(screen.queryByText("Loading sessions…")).not.toBeInTheDocument()
  })

  it("keeps session history closed by default and opens it from the rail button", async () => {
    const user = userEvent.setup()
    const onOpenNav = vi.fn()

    render(
      <WorkspaceAgentFront
        workspaceId="test-workspace"
        chatPanel={ChatPanel}
        onOpenNav={onOpenNav}
      />,
    )

    expect(screen.getByLabelText("Session browser")).toHaveAttribute("aria-hidden", "true")

    await user.click(screen.getByRole("button", { name: "Sessions" }))

    expect(onOpenNav).toHaveBeenCalledOnce()
    expect(screen.getByLabelText("Session browser")).toHaveAttribute("aria-hidden", "false")
  })

  it("treats session history as data and opened chat panes as views", async () => {
    const user = userEvent.setup()
    const switchCalls: string[] = []
    const sessions = [
      { id: "s1", title: "First session", updatedAt: Date.now() - 1_000 },
      { id: "s2", title: "Second session", updatedAt: Date.now() - 2_000 },
      { id: "s3", title: "Third session", updatedAt: Date.now() - 3_000 },
    ]

    function Harness() {
      const [activeSessionId, setActiveSessionId] = useState("s1")
      return (
        <WorkspaceAgentFront
          workspaceId="multi-pane-sessions"
          chatPanel={SessionIdChatPanel}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSwitchSession={(id) => {
            switchCalls.push(id)
            setActiveSessionId(id)
          }}
          onCreateSession={vi.fn()}
          defaultNavOpen
          persistenceEnabled={false}
        />
      )
    }

    render(<Harness />)
    expandHistory()

    // Session creation is contextual: with the drawer open its header "+"
    // is the affordance and the floating "New chat" button hides.
    expect(screen.queryByRole("button", { name: "New chat" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "New session" })).toBeInTheDocument()
    expect(visibleChatSessionIds()).toEqual(["s1"])

    await user.click(screen.getByText("Second session"))
    expect(switchCalls).toContain("s2")
    expect(visibleChatSessionIds()).toEqual(["s2"])

    await user.click(screen.getByLabelText("Open Third session in chat pane"))
    expect(switchCalls).toContain("s3")
    expect(visibleChatSessionIds()).toEqual(["s2", "s3"])

    await user.click(screen.getByText("First session"))
    expect(switchCalls).toContain("s1")
    expect(visibleChatSessionIds()).toEqual(["s2", "s1"])

    await user.click(screen.getByLabelText("Close First session pane"))
    expect(switchCalls).toContain("s2")
    expect(visibleChatSessionIds()).toEqual(["s2"])
    expect(screen.getByText("First session")).toBeInTheDocument()
  })

  it("replaces the active pane for normal New chat without creating another split", async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      "boring-workspace:chat-panes:new-chat-single-pane",
      JSON.stringify({ ids: ["s1", "s2"], activeId: "s2" }),
    )

    function Harness() {
      const [sessions, setSessions] = useState([
        { id: "s1", title: "First session", updatedAt: Date.now() - 1_000 },
        { id: "s2", title: "Second session", updatedAt: Date.now() - 2_000 },
      ])
      const [activeSessionId, setActiveSessionId] = useState("s2")
      return (
        <WorkspaceAgentFront
          workspaceId="new-chat-single-pane"
          workspaceLayout="plugin-tabs"
          chatPanel={SessionIdChatPanel}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSwitchSession={setActiveSessionId}
          onCreateSession={async () => {
            const created = { id: "fresh", title: "New chat", updatedAt: Date.now() }
            setSessions((current) => [created, ...current])
            setActiveSessionId(created.id)
            return created
          }}
        />
      )
    }

    render(<Harness />)
    expect(visibleChatSessionIds()).toEqual(["s1", "s2"])

    await user.click(within(screen.getByLabelText("App navigation")).getByRole("button", { name: "New chat" }))

    await waitFor(() => expect(visibleChatSessionIds()).toEqual(["s1", "fresh"]))
    const appNavigation = screen.getByLabelText("App navigation")
    expect(within(appNavigation).getByRole("button", { name: "First session" })).toBeInTheDocument()
    expect(within(appNavigation).getByRole("button", { name: "Second session" })).toBeInTheDocument()
  })

  it("does not materialize a late created pane after the workspace changes", async () => {
    const user = userEvent.setup()
    const oldCreate = deferred<{ id: string; title: string; updatedAt: number }>()
    const view = render(
      <WorkspaceAgentFront
        workspaceId="create-scope-a"
        workspaceLayout="plugin-tabs"
        persistenceEnabled={false}
        chatPanel={SessionIdChatPanel}
        sessions={[{ id: "a1", title: "Workspace A", updatedAt: 1 }]}
        activeSessionId="a1"
        onSwitchSession={vi.fn()}
        onCreateSession={() => oldCreate.promise}
      />,
    )

    await user.click(within(screen.getByLabelText("App navigation")).getByRole("button", { name: "New chat" }))

    view.rerender(
      <WorkspaceAgentFront
        workspaceId="create-scope-b"
        workspaceLayout="plugin-tabs"
        persistenceEnabled={false}
        chatPanel={SessionIdChatPanel}
        sessions={[{ id: "b1", title: "Workspace B", updatedAt: 2 }]}
        activeSessionId="b1"
        onSwitchSession={vi.fn()}
        onCreateSession={vi.fn()}
      />,
    )
    await waitFor(() => expect(visibleChatSessionIds()).toEqual(["b1"]))

    await act(async () => {
      oldCreate.resolve({ id: "a-late", title: "Late A", updatedAt: 3 })
      await oldCreate.promise
    })

    expect(visibleChatSessionIds()).toEqual(["b1"])
    expect(screen.queryByText("Late A")).not.toBeInTheDocument()
  })

  it("cancels an in-flight controlled create when the inventory becomes local", async () => {
    const oldCreate = deferred<{ id: string; title: string; updatedAt: number }>()
    const view = render(
      <WorkspaceAgentFront
        workspaceId="controlled-to-local-create"
        workspaceLayout="plugin-tabs"
        persistenceEnabled={false}
        chatPanel={SessionIdChatPanel}
        sessions={[{ id: "controlled", title: "Controlled", updatedAt: 1 }]}
        activeSessionId="controlled"
        onSwitchSession={vi.fn()}
        onCreateSession={() => oldCreate.promise}
      />,
    )

    fireEvent.click(within(screen.getByLabelText("App navigation")).getByRole("button", { name: "New chat" }))
    view.rerender(
      <WorkspaceAgentFront
        workspaceId="controlled-to-local-create"
        workspaceLayout="plugin-tabs"
        persistenceEnabled={false}
        chatPanel={SessionIdChatPanel}
      />,
    )
    await waitFor(() => expect(visibleChatSessionIds()).not.toContain("controlled"))
    const localSessionIds = visibleChatSessionIds()

    await act(async () => {
      oldCreate.resolve({ id: "controlled-late", title: "Controlled late", updatedAt: 2 })
      await oldCreate.promise
    })
    expect(visibleChatSessionIds()).toEqual(localSessionIds)
    expect(screen.queryByText("Controlled late")).not.toBeInTheDocument()
  })

  it("cancels an in-flight remote create when the inventory becomes local", async () => {
    const remoteCreate = deferred<Response>()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? "GET"
      if (url.includes("/api/v1/agent/pi-chat/sessions") && method === "POST") return remoteCreate.promise
      if (url.includes("/api/v1/agent/pi-chat/sessions")) {
        return new Response(JSON.stringify([{ id: "remote", title: "Remote" }]), { status: 200 })
      }
      if (url.includes("/api/v1/tree")) return new Response(JSON.stringify({ entries: [] }), { status: 200 })
      if (url.includes("/api/v1/agent/models")) return new Response(JSON.stringify({ models: [] }), { status: 200 })
      if (url.includes("/api/v1/agent/skills")) return new Response(JSON.stringify({ skills: [] }), { status: 200 })
      if (url.includes("/api/v1/agent-plugins")) return new Response(JSON.stringify([]), { status: 200 })
      if (url.includes("/api/v1/ready-status")) return new Response(null, { status: 200 })
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const view = render(
      <WorkspaceAgentFront
        workspaceId="remote-to-local-create"
        workspaceLayout="plugin-tabs"
        persistenceEnabled={false}
      />,
    )

    await waitFor(() => expect(within(screen.getByLabelText("App navigation")).getByRole("button", { name: "Remote" })).toBeInTheDocument())
    fireEvent.click(within(screen.getByLabelText("App navigation")).getByRole("button", { name: "New chat" }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => (
      String(input).includes("/api/v1/agent/pi-chat/sessions") && init?.method === "POST"
    ))).toBe(true))

    view.rerender(
      <WorkspaceAgentFront
        workspaceId="remote-to-local-create"
        workspaceLayout="plugin-tabs"
        persistenceEnabled={false}
        chatPanel={SessionIdChatPanel}
      />,
    )
    await waitFor(() => expect(visibleChatSessionIds()).not.toContain("remote"))
    const localSessionIds = visibleChatSessionIds()

    await act(async () => {
      remoteCreate.resolve(new Response(JSON.stringify({ id: "remote-late", title: "Remote late" }), { status: 201 }))
      await remoteCreate.promise
    })
    expect(visibleChatSessionIds()).toEqual(localSessionIds)
    expect(screen.queryByText("Remote late")).not.toBeInTheDocument()
  })

  it.each([
    { source: "agent", firstAgent: "alpha", nextAgent: "beta", firstApi: "/api", nextApi: "/api" },
    { source: "API", firstAgent: "alpha", nextAgent: "alpha", firstApi: "/source-a/", nextApi: "/source-b" },
  ])("does not materialize a late created pane after a same-workspace $source switch", async ({ firstAgent, nextAgent, firstApi, nextApi }) => {
    const user = userEvent.setup()
    const oldCreate = deferred<{ id: string; agentTypeId: string; title: string; updatedAt: number }>()
    const view = render(
      <WorkspaceAgentFront
        workspaceId="same-workspace-create-switch"
        agentTypeId={firstAgent}
        apiBaseUrl={firstApi}
        workspaceLayout="plugin-tabs"
        persistenceEnabled={false}
        chatPanel={SessionIdChatPanel}
        sessions={[{ id: "first", agentTypeId: firstAgent, title: "First source", updatedAt: 1 }]}
        activeSessionId="first"
        activeSessionAgentTypeId={firstAgent}
        onSwitchSession={vi.fn()}
        onCreateSession={() => oldCreate.promise}
      />,
    )

    await user.click(within(screen.getByLabelText("App navigation")).getByRole("button", { name: "New chat" }))
    view.rerender(
      <WorkspaceAgentFront
        workspaceId="same-workspace-create-switch"
        agentTypeId={nextAgent}
        apiBaseUrl={nextApi}
        workspaceLayout="plugin-tabs"
        persistenceEnabled={false}
        chatPanel={SessionIdChatPanel}
        sessions={[{ id: "next", agentTypeId: nextAgent, title: "Next source", updatedAt: 2 }]}
        activeSessionId="next"
        activeSessionAgentTypeId={nextAgent}
        onSwitchSession={vi.fn()}
        onCreateSession={vi.fn()}
      />,
    )
    await waitFor(() => expect(visibleChatSessionIds()).toEqual(["next"]))

    await act(async () => {
      oldCreate.resolve({ id: "old-late", agentTypeId: firstAgent, title: "Old late", updatedAt: 3 })
      await oldCreate.promise
    })

    expect(visibleChatSessionIds()).toEqual(["next"])
    expect(screen.queryByText("Old late")).not.toBeInTheDocument()
  })

  it("releases the New chat guard when a custom create throws synchronously", async () => {
    const create = vi.fn()
      .mockImplementationOnce(() => { throw new Error("sync create failed") })
      .mockResolvedValueOnce({ id: "retried", title: "Retried", updatedAt: Date.now() })

    render(
      <WorkspaceAgentFront
        workspaceId="sync-create-retry"
        chatPanel={SessionIdChatPanel}
        sessions={[{ id: "existing", title: "Existing", updatedAt: Date.now() }]}
        activeSessionId="existing"
        onCreateSession={create}
        persistenceEnabled={false}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "New chat" }))
    await act(async () => { await Promise.resolve() })
    fireEvent.click(screen.getByRole("button", { name: "New chat" }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(visibleChatSessionIds()).toEqual(["retried"]))
  })

  it("creates exactly one session when New chat is double-clicked", async () => {
    // create() is an awaited server round-trip now, so without a re-entry
    // guard the second click of a double-click mints a second session.
    const user = userEvent.setup()
    const createRequests: string[] = []
    const createGate = { release: () => {} }

    function Harness() {
      const [sessions, setSessions] = useState([{ id: "s1", title: "First session", updatedAt: Date.now() }])
      const [activeSessionId, setActiveSessionId] = useState("s1")
      return (
        <WorkspaceAgentFront
          workspaceId="new-chat-double-click"
          workspaceLayout="plugin-tabs"
          chatPanel={SessionIdChatPanel}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSwitchSession={setActiveSessionId}
          onCreateSession={async () => {
            const id = `fresh-${createRequests.length + 1}`
            createRequests.push(id)
            await new Promise<void>((resolve) => { createGate.release = resolve })
            const created = { id, title: "New chat", updatedAt: Date.now() }
            setSessions((current) => [created, ...current])
            setActiveSessionId(id)
            return created
          }}
        />
      )
    }

    render(<Harness />)
    const newChat = within(screen.getByLabelText("App navigation")).getByRole("button", { name: "New chat" })
    await user.click(newChat)
    await user.click(newChat)
    expect(createRequests).toEqual(["fresh-1"])

    await act(async () => { createGate.release() })
    await waitFor(() => expect(visibleChatSessionIds()).toEqual(["fresh-1"]))
  })

  it("preserves source A create and re-entry guards across an aborted source B render", async () => {
    const createGate = deferred<{ id: string; agentTypeId: string; title: string; updatedAt: number }>()
    const create = vi.fn(() => createGate.promise)
    let transitionToB!: () => void
    let abortB!: () => void
    const never = new Promise<void>(() => {})

    function SuspendB(): null {
      throw never
    }

    function Harness() {
      const [source, setSource] = useState<"alpha" | "beta">("alpha")
      transitionToB = () => startTransition(() => setSource("beta"))
      abortB = () => setSource("alpha")
      return (
        <Suspense fallback={<div>Suspended B</div>}>
          <RawWorkspaceAgentFront
            workspaceId="interrupted-source"
            agentTypeId={source}
            workspaceLayout="plugin-tabs"
            persistenceEnabled={false}
            chatPanel={SessionIdChatPanel}
            sessions={[{ id: "first", agentTypeId: source, title: "First", updatedAt: 1 }]}
            activeSessionId="first"
            activeSessionAgentTypeId={source}
            onSwitchSession={vi.fn()}
            onCreateSession={create}
            beforeShell={source === "beta" ? <SuspendB /> : null}
          />
        </Suspense>
      )
    }

    render(<Harness />)
    const newChat = within(screen.getByLabelText("App navigation")).getByRole("button", { name: "New chat" })
    fireEvent.click(newChat)
    await waitFor(() => expect(create).toHaveBeenCalledOnce())

    act(() => { transitionToB() })
    expect(screen.queryByText("Suspended B")).not.toBeInTheDocument()
    fireEvent.click(newChat)
    expect(create).toHaveBeenCalledOnce()

    act(() => { abortB() })
    await act(async () => {
      createGate.resolve({ id: "alpha-created", agentTypeId: "alpha", title: "Created A", updatedAt: 2 })
      await createGate.promise
    })

    await waitFor(() => expect(visibleChatSessionIds()).toEqual(["alpha-created"]))
  })

  it("keeps one-render-stale custom rows and saved reconciliation actions inert until their source attestation matches", async () => {
    let alphaSourceIdentity = ""
    let capturedPanel: WorkspaceChatPanelProps | undefined
    const alphaRefresh = vi.fn()
    const betaRefresh = vi.fn()
    const CapturingSessionPanel = (props: WorkspaceChatPanelProps) => {
      capturedPanel = props
      return <SessionIdChatPanel {...props} />
    }

    function Harness() {
      const [agentTypeId, setAgentTypeId] = useState("alpha")
      const [betaReady, setBetaReady] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setAgentTypeId("beta")}>Switch source</button>
          <button type="button" onClick={() => setBetaReady(true)}>Settle source</button>
          <RawWorkspaceAgentFront
            workspaceId="custom-source-boundary"
            agentTypeId={agentTypeId}
            chatPanel={CapturingSessionPanel}
            persistenceEnabled={false}
            useSessions={(options) => {
              if (agentTypeId === "alpha") {
                alphaSourceIdentity = options.sourceIdentity
                const session = { id: "alpha-row", agentTypeId: "alpha", title: "Alpha row" }
                return {
                  sourceIdentity: options.sourceIdentity,
                  sessions: [session], activeSession: session, activeSessionId: session.id,
                  loading: false, create: vi.fn(), switch: vi.fn(), delete: vi.fn(), refresh: alphaRefresh,
                }
              }
              const session = betaReady
                ? { id: "beta-row", agentTypeId: "beta", title: "Beta row" }
                : { id: "alpha-row", agentTypeId: "alpha", title: "Alpha row" }
              return {
                sourceIdentity: betaReady ? options.sourceIdentity : alphaSourceIdentity,
                sessions: [session], activeSession: session, activeSessionId: session.id,
                loading: !betaReady, create: vi.fn(), switch: vi.fn(), delete: vi.fn(), refresh: betaRefresh,
              }
            }}
          />
        </>
      )
    }

    render(<Harness />)
    expect(await screen.findByText("Chat pane alpha-row")).toBeInTheDocument()
    const savedAlphaTurnComplete = capturedPanel?.onTurnComplete

    fireEvent.click(screen.getByRole("button", { name: "Switch source" }))
    act(() => { savedAlphaTurnComplete?.() })
    expect(alphaRefresh).not.toHaveBeenCalled()
    expect(betaRefresh).not.toHaveBeenCalled()
    expect(screen.queryByText("Chat pane alpha-row")).not.toBeInTheDocument()
    expect(screen.queryByText("Alpha row")).not.toBeInTheDocument()
    expect(screen.getAllByText("Loading sessions…").length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole("button", { name: "Settle source" }))
    expect(await screen.findByText("Chat pane beta-row")).toBeInTheDocument()
  })

  it("swallows a rejecting custom session refresh after turn completion", async () => {
    let capturedPanel: WorkspaceChatPanelProps | undefined
    const refresh = vi.fn(() => Promise.reject(new Error("refresh rejected")))
    const CapturingPanel = (props: WorkspaceChatPanelProps) => {
      capturedPanel = props
      return <SessionIdChatPanel {...props} />
    }
    const session = { id: "refresh-rejection", agentTypeId: "alpha", title: "Refresh rejection" }

    render(
      <WorkspaceAgentFront
        workspaceId="refresh-rejection"
        agentTypeId="alpha"
        chatPanel={CapturingPanel}
        persistenceEnabled={false}
        useSessions={() => ({
          sessions: [session], activeSession: session, activeSessionId: session.id,
          loading: false, create: vi.fn(), switch: vi.fn(), delete: vi.fn(), refresh,
        })}
      />,
    )

    act(() => { capturedPanel?.onTurnComplete?.() })
    await waitFor(() => expect(refresh).toHaveBeenCalledWith({ background: true }))
    await act(async () => { await Promise.resolve() })
  })

  it("diagnoses a settled custom result with consciously missing source attestation", () => {
    const stale = { id: "unattested", agentTypeId: "alpha", title: "Unattested row" }
    render(
      <RawWorkspaceAgentFront
        workspaceId="missing-source-attestation"
        agentTypeId="alpha"
        chatPanel={SessionIdChatPanel}
        persistenceEnabled={false}
        useSessions={() => ({
          sourceIdentity: undefined,
          sessions: [stale], activeSession: stale, activeSessionId: stale.id,
          loading: false, create: vi.fn(), switch: vi.fn(), delete: vi.fn(),
        })}
      />,
    )

    expect(screen.queryByText("Chat pane unattested")).not.toBeInTheDocument()
    expect(screen.queryByText("Unattested row")).not.toBeInTheDocument()
    expect(screen.getByText("Sessions failed to load")).toBeInTheDocument()
    expect(screen.getByText(/settled result did not attest the expected sourceIdentity/)).toBeInTheDocument()
    expect(screen.queryByText("Loading sessions…")).not.toBeInTheDocument()
  })

  it("does not invalidate custom operations when an equivalent inline callback is recreated", async () => {
    const created = deferred<{ id: string; agentTypeId: string; title: string }>()
    const create = vi.fn(() => created.promise)

    function Harness() {
      const [, rerender] = useState(0)
      const session = { id: "alpha-row", agentTypeId: "alpha", title: "Alpha row" }
      return (
        <>
          <button type="button" onClick={() => rerender((value) => value + 1)}>Equivalent rerender</button>
          <RawWorkspaceAgentFront
            workspaceId="equivalent-custom-source"
            agentTypeId="alpha"
            workspaceLayout="plugin-tabs"
            chatPanel={SessionIdChatPanel}
            persistenceEnabled={false}
            useSessions={(options) => ({
              sourceIdentity: options.sourceIdentity,
              sessions: [session], activeSession: session, activeSessionId: session.id,
              loading: false, create, switch: vi.fn(), delete: vi.fn(),
            })}
          />
        </>
      )
    }

    render(<Harness />)
    const newChat = within(screen.getByLabelText("App navigation")).getByRole("button", { name: "New chat" })
    fireEvent.click(newChat)
    fireEvent.click(screen.getByRole("button", { name: "Equivalent rerender" }))
    fireEvent.click(newChat)
    await waitFor(() => expect(create).toHaveBeenCalledOnce())

    await act(async () => {
      created.resolve({ id: "created-row", agentTypeId: "alpha", title: "Created row" })
      await created.promise
    })
    await waitFor(() => expect(visibleChatSessionIds()).toEqual(["created-row"]))
  })

  it("keeps colliding addressed sessions distinct through pane activation and deletion", async () => {
    const user = userEvent.setup()
    const switched: Array<[string, string | undefined]> = []
    const deleted: Array<[string, string | undefined]> = []

    function AddressedChatPanel(props: WorkspaceChatPanelProps) {
      return (
        <div
          data-testid="addressed-chat-pane"
          data-session-id={props.sessionId}
          data-agent-type-id={props.agentTypeId}
        >
          {props.agentTypeId}/{props.sessionId}
        </div>
      )
    }

    function Harness() {
      const [sessions, setSessions] = useState([
        { id: "shared", agentTypeId: "alpha", title: "Alpha shared", updatedAt: Date.now() - 1_000 },
        { id: "shared", agentTypeId: "beta", title: "Beta shared", updatedAt: Date.now() - 2_000 },
      ])
      return (
        <>
          <button type="button" onClick={() => setSessions((current) => [...current])}>Refresh colliding sessions</button>
          <WorkspaceAgentFront
            workspaceId="colliding-addressed-panes"
            chatPanel={AddressedChatPanel}
            sessions={sessions}
            activeSessionId="shared"
            onSwitchSession={(id, owner) => switched.push([id, owner])}
            onDeleteSession={(id, owner) => {
              deleted.push([id, owner])
              setSessions((current) => current.filter((session) => (
                session.id !== id || session.agentTypeId !== owner
              )))
            }}
            defaultNavOpen
            persistenceEnabled={false}
          />
        </>
      )
    }

    render(<Harness />)
    expandHistory()
    await user.click(screen.getByLabelText("Open Beta shared in chat pane"))

    expect(screen.getAllByTestId("addressed-chat-pane").map((pane) => [
      pane.getAttribute("data-session-id"),
      pane.getAttribute("data-agent-type-id"),
    ])).toEqual([["shared", "alpha"], ["shared", "beta"]])
    expect(switched).toContainEqual(["shared", "beta"])

    await user.click(screen.getByLabelText("Chat session Alpha shared"))
    expect(switched.at(-1)).toEqual(["shared", "alpha"])
    await user.click(screen.getByLabelText("Chat session Beta shared"))
    expect(switched.at(-1)).toEqual(["shared", "beta"])
    await user.click(screen.getByRole("button", { name: "Refresh colliding sessions" }))
    expect(screen.getByText("beta/shared").closest('[data-boring-workspace-part="chat-pane"]')).toHaveAttribute("data-boring-state", "active")

    await user.click(screen.getByLabelText("Delete Beta shared"))
    await waitFor(() => {
      expect(deleted).toContainEqual(["shared", "beta"])
      expect(screen.getAllByTestId("addressed-chat-pane")).toHaveLength(1)
      expect(screen.getByTestId("addressed-chat-pane")).toHaveAttribute("data-agent-type-id", "alpha")
    })

    await user.click(screen.getByLabelText("Delete Alpha shared"))
    expect(deleted).toEqual([["shared", "beta"], ["shared", "alpha"]])
  })

  it("initializes a controlled colliding id to its explicit active owner", () => {
    localStorage.setItem("boring-workspace:chat-panes:explicit-active-owner", JSON.stringify({
      version: 2,
      refs: [{ kind: "addressed", sessionId: "shared", agentTypeId: "alpha" }],
      activeRef: { kind: "addressed", sessionId: "shared", agentTypeId: "alpha" },
    }))
    render(
      <WorkspaceAgentFront
        workspaceId="explicit-active-owner"
        chatPanel={(props) => <div data-testid="owned-active">{props.agentTypeId}/{props.sessionId}</div>}
        sessions={[
          { id: "shared", agentTypeId: "alpha", title: "Alpha shared" },
          { id: "shared", agentTypeId: "beta", title: "Beta shared" },
        ]}
        activeSessionId="shared"
        activeSessionAgentTypeId="beta"
        onSwitchSession={vi.fn()}
      />,
    )

    expect(screen.getByTestId("owned-active")).toHaveTextContent("beta/shared")
  })

  it("keeps an arbitrary legacy id distinct from an addressed ref and preserves callback arity", async () => {
    const user = userEvent.setup()
    const legacyId = "boring-agent-session:alpha/shared"
    const onSwitchSession = vi.fn()
    const onDeleteSession = vi.fn()
    localStorage.setItem(
      "boring-workspace:chat-panes:legacy-addressed-key-collision",
      JSON.stringify({ ids: [legacyId], activeId: legacyId }),
    )
    render(
      <WorkspaceAgentFront
        workspaceId="legacy-addressed-key-collision"
        chatPanel={SessionIdChatPanel}
        sessions={[
          { id: legacyId, title: "Literal legacy" },
          { id: "shared", agentTypeId: "alpha", title: "Addressed alpha" },
        ]}
        activeSessionId={legacyId}
        onSwitchSession={onSwitchSession}
        onDeleteSession={onDeleteSession}
        defaultNavOpen
      />,
    )
    expandHistory()

    await user.click(screen.getByLabelText("Open Addressed alpha in chat pane"))
    await user.click(screen.getAllByText("Literal legacy").find((node) => node.closest("li"))!)
    await user.click(screen.getByLabelText("Delete Literal legacy"))

    expect(onSwitchSession.mock.calls).toContainEqual(["shared", "alpha"])
    expect(onSwitchSession.mock.calls).toContainEqual([legacyId])
    expect(onDeleteSession).toHaveBeenCalledWith(legacyId)
    expect(onDeleteSession.mock.calls.at(-1)).toHaveLength(1)
  })

  it("renders plugin-tabs app navigation without classic session edge controls", async () => {
    const user = userEvent.setup()
    const onSwitchSession = vi.fn()
    const onCreateSession = vi.fn()
    const sessions = [
      { id: "s1", title: "First session", updatedAt: Date.now() - 1_000 },
      { id: "s2", title: "Second session", updatedAt: Date.now() - 2_000 },
      { id: "s3", title: "Third session", updatedAt: Date.now() - 3_000 },
    ]

    render(
      <WorkspaceAgentFront
        workspaceId="plugin-tabs-nav"
        workspaceLayout="plugin-tabs"
        chatPanel={SessionIdChatPanel}
        sessions={sessions}
        activeSessionId="s1"
        onSwitchSession={onSwitchSession}
        onCreateSession={onCreateSession}
        persistenceEnabled={false}
      />,
    )

    const appNav = screen.getByLabelText("App navigation")
    expect(appNav).toBeInTheDocument()
    const resizeSeparator = screen.getByRole("separator", { name: "Resize app navigation" })
    expect(resizeSeparator).toHaveAttribute("tabindex", "0")
    expect(resizeSeparator).toHaveAttribute("aria-orientation", "vertical")
    expect(resizeSeparator).toHaveAttribute("aria-valuemin", "220")
    expect(resizeSeparator).toHaveAttribute("aria-valuemax", "420")
    expect(resizeSeparator).toHaveAttribute("aria-valuenow", "268")
    fireEvent.keyDown(resizeSeparator, { key: "ArrowRight" })
    await waitFor(() => expect(resizeSeparator).toHaveAttribute("aria-valuenow", "284"))
    fireEvent.keyDown(resizeSeparator, { key: "Home" })
    await waitFor(() => expect(resizeSeparator).toHaveAttribute("aria-valuenow", "220"))
    expect(within(appNav).getAllByRole("button", { name: "New chat" })).toHaveLength(1)
    expect(within(appNav).getByRole("button", { name: "Search" })).toBeInTheDocument()
    expect(within(appNav).getByRole("button", { name: "Plugins" })).toBeInTheDocument()
    expect(within(appNav).getByRole("button", { name: "Skills" })).toBeInTheDocument()
    await user.click(within(appNav).getByRole("button", { name: "New chat" }))
    expect(onCreateSession).toHaveBeenCalledOnce()
    expect(screen.queryByRole("button", { name: "Sessions" })).not.toBeInTheDocument()
    expect(screen.queryByText("Workspaces")).not.toBeInTheDocument()
    expect(screen.queryByText("Codex mobile")).not.toBeInTheDocument()
    expect(screen.queryByText("Automations")).not.toBeInTheDocument()

    const appRows = Array.from(appNav.querySelectorAll<HTMLElement>('[data-boring-workspace-part="app-session-row"]'))
    const firstRow = appRows.find((row) => row.textContent?.includes("First session"))
    const secondRow = appRows.find((row) => row.textContent?.includes("Second session"))
    expect(firstRow).toHaveAttribute("data-boring-session-state", "active")
    expect(firstRow?.className).not.toContain("border-l-2")
    expect(secondRow).toHaveAttribute("data-boring-session-state", "normal")

    await user.click(within(secondRow!).getByText("Second session"))
    expect(onSwitchSession).toHaveBeenCalledWith("s2")

    const switchCallsAfterRowClick = onSwitchSession.mock.calls.length
    await user.click(within(appNav).getByRole("button", { name: "Pin Second session" }))
    expect(onSwitchSession).toHaveBeenCalledTimes(switchCallsAfterRowClick)
    expect(within(appNav).getByText("Pinned")).toBeInTheDocument()
    expect(within(appNav).getByText("Chats")).toBeInTheDocument()

    await user.click(within(appNav).getByRole("button", { name: "Open Third session in new chat pane" }))
    expect(onSwitchSession).toHaveBeenCalledWith("s3")

    await user.click(screen.getByRole("button", { name: "Hide app navigation" }))
    expect(screen.queryByLabelText("App navigation")).not.toBeInTheDocument()
    expect(document.querySelector('[data-boring-workspace-part="app-left-pane"]')).toBeNull()
    expect(screen.getByRole("button", { name: "Open app navigation" })).toBeInTheDocument()
  })

  it("keeps only the current app-left overlay action selected", async () => {
    const user = userEvent.setup()
    const automationPlugin = definePlugin({
      id: "automation-action",
      appLeftActions: [{ id: "automations", label: "Automations", overlay: () => <div>Automation overlay</div> }],
    })

    render(
      <WorkspaceAgentFront
        workspaceId="plugin-tabs-active-overlay"
        workspaceLayout="plugin-tabs"
        chatPanel={SessionIdChatPanel}
        plugins={[automationPlugin]}
        persistenceEnabled={false}
      />,
    )

    const appNav = screen.getByLabelText("App navigation")
    const automations = within(appNav).getByRole("button", { name: "Automations" })
    const plugins = within(appNav).getByRole("button", { name: "Plugins" })

    await user.click(automations)
    expect(automations).toHaveAttribute("data-active", "true")
    expect(plugins).not.toHaveAttribute("data-active")

    await user.click(plugins)
    expect(automations).not.toHaveAttribute("data-active")
    expect(plugins).toHaveAttribute("data-active", "true")

    await user.click(automations)
    expect(automations).toHaveAttribute("data-active", "true")
    expect(plugins).not.toHaveAttribute("data-active")

    await user.click(automations)
    expect(automations).not.toHaveAttribute("data-active")
    expect(plugins).not.toHaveAttribute("data-active")
  })

  it("rejects plugin app-left actions that collide with built-in overlays", () => {
    const collidingPlugin = definePlugin({
      id: "colliding-action",
      appLeftActions: [{ id: "plugins", label: "Plugins", overlay: () => <div>Plugin overlay</div> }],
    })

    expect(() => render(
      <WorkspaceAgentFront
        workspaceId="plugin-tabs-colliding-action"
        workspaceLayout="plugin-tabs"
        chatPanel={SessionIdChatPanel}
        plugins={[collidingPlugin]}
        persistenceEnabled={false}
      />,
    )).toThrow(/reserved workspace app-left action/)
  })

  it("rejects host app-left actions that collide with plugin or built-in overlays", () => {
    expect(() => render(
      <WorkspaceAgentFront
        workspaceId="plugin-tabs-host-colliding-action"
        workspaceLayout="plugin-tabs"
        chatPanel={SessionIdChatPanel}
        appLeftActions={[{ id: "plugins", label: "Host Plugins", icon: null, onClick: () => undefined }]}
        persistenceEnabled={false}
      />,
    )).toThrow(/duplicate app-left action id/)
  })

  it("can hide plugin-tabs Skills and Plugins actions", () => {
    render(
      <WorkspaceAgentFront
        workspaceId="plugin-tabs-hidden-overlays"
        workspaceLayout="plugin-tabs"
        chatPanel={SessionIdChatPanel}
        sessions={[{ id: "s1", title: "First session" }]}
        activeSessionId="s1"
        showSkills={false}
        showPlugins={false}
        persistenceEnabled={false}
      />,
    )

    const appNav = screen.getByLabelText("App navigation")
    expect(within(appNav).getByRole("button", { name: "New chat" })).toBeInTheDocument()
    expect(within(appNav).getByRole("button", { name: "Search" })).toBeInTheDocument()
    expect(within(appNav).queryByRole("button", { name: "Skills" })).not.toBeInTheDocument()
    expect(within(appNav).queryByRole("button", { name: "Plugins" })).not.toBeInTheDocument()
  })

  it("can render compact app navigation with only actions and chats", () => {
    render(
      <WorkspaceAgentFront
        workspaceId="compact-project"
        workspaceLayout="plugin-tabs"
        appTitle="Seneca AI"
        workspaceLabel="Default workspace"
        appLeftHeaderMode="hidden"
        chatPanel={SessionIdChatPanel}
        sessions={[{ id: "s1", title: "Focused session" }]}
        activeSessionId="s1"
      />,
    )

    const appNav = screen.getByLabelText("App navigation")
    expect(within(appNav).queryByText("Seneca AI")).not.toBeInTheDocument()
    expect(within(appNav).queryByText("Default workspace")).not.toBeInTheDocument()
    expect(within(appNav).getByRole("button", { name: "New chat" })).toBeInTheDocument()
    expect(within(appNav).getByText("Chats")).toBeInTheDocument()
    expect(within(appNav).getByText("Focused session")).toBeInTheDocument()
  })

  it("can render compact app navigation with a workspace picker and no brand", () => {
    render(
      <WorkspaceAgentFront
        workspaceId="workspace-picker-project"
        workspaceLayout="plugin-tabs"
        appTitle="Seneca AI"
        workspaceLabel="Default workspace"
        topBarLeft={<button type="button">Default workspace</button>}
        appLeftHeaderMode="workspace"
        chatPanel={SessionIdChatPanel}
        sessions={[{ id: "s1", title: "Focused session" }]}
        activeSessionId="s1"
      />,
    )

    const appNav = screen.getByLabelText("App navigation")
    expect(within(appNav).queryByText("Seneca AI")).not.toBeInTheDocument()
    expect(within(appNav).getByRole("button", { name: "Default workspace" })).toBeInTheDocument()
    expect(within(appNav).getByText("Chats")).toBeInTheDocument()
  })

  it("renders multi-project app navigation with pinned sessions above the inline projects tree", () => {
    const sessions = [
      { id: "s1", title: "Active project session", updatedAt: Date.now() - 1_000 },
      { id: "s2", title: "Pinned session", updatedAt: Date.now() - 2_000 },
    ]

    localStorage.setItem("boring-workspace:pinned-sessions:project-a", JSON.stringify({ ids: ["s2"] }))

    render(
      <WorkspaceAgentFront
        workspaceId="project-a"
        workspaceLayout="plugin-tabs"
        appTitle="Seneca AI"
        appLeftLayoutMode="multi-project"
        workspaceSectionTitle="Projects"
        chatPanel={SessionIdChatPanel}
        sessions={sessions}
        activeSessionId="s1"
        appLeftProjects={[
          { id: "project-a", name: "Project Alpha" },
          { id: "project-b", name: "Project Beta", sessions: [{ id: "b1", title: "Beta kickoff" }] },
        ]}
        onCreateAppLeftProject={vi.fn()}
      />,
    )

    const appNav = screen.getByLabelText("App navigation")
    expect(within(appNav).queryByText("Seneca AI")).not.toBeInTheDocument()
    expect(appNav.querySelector('[data-boring-workspace-part="app-left-pane-brand"]')).not.toBeInTheDocument()
    expect(within(appNav).queryByText("Default workspace")).not.toBeInTheDocument()
    expect(within(appNav).getByText("Pinned")).toBeInTheDocument()
    expect(within(appNav).getByText("Projects")).toBeInTheDocument()
    expect(within(appNav).getByRole("button", { name: "New project" })).toBeInTheDocument()
    // Expansion is decoupled from switching: a dedicated chevron owns the
    // open/closed state, and the active project starts expanded.
    const collapseAlpha = within(appNav).getByRole("button", { name: "Collapse Project Alpha" })
    expect(collapseAlpha).toHaveAttribute("aria-expanded", "true")
    expect(within(appNav).getByRole("button", { name: "Project Alpha" })).toBeInTheDocument()
    expect(within(appNav).getByText("Project Beta")).toBeInTheDocument()
    fireEvent.click(within(appNav).getByRole("button", { name: "Expand Project Beta" }))
    expect(within(appNav).getByText("Beta kickoff")).toBeInTheDocument()
    expect(within(appNav).queryByRole("button", { name: "Pin Beta kickoff" })).not.toBeInTheDocument()
    expect(within(appNav).getByText("Active project session")).toBeInTheDocument()
    // The active session is already open, so it offers no "open in a new pane".
    expect(within(appNav).queryByRole("button", { name: "Open Active project session in new chat pane" })).not.toBeInTheDocument()
    // A session that isn't open still does.
    expect(within(appNav).getByRole("button", { name: "Open Pinned session in new chat pane" })).toBeInTheDocument()
    expect(within(appNav).getByRole("button", { name: "Pin Active project session" })).toBeInTheDocument()
    expect(within(appNav).getByText("Pinned session")).toBeInTheDocument()
    expect(within(appNav).queryByText("Chats")).not.toBeInTheDocument()
    // Per-project action: start a new chat inside a specific project.
    expect(within(appNav).getByRole("button", { name: "New chat in Project Alpha" })).toBeInTheDocument()

    // The chevron (not the row) toggles expansion.
    fireEvent.click(collapseAlpha)
    expect(within(appNav).getByRole("button", { name: "Expand Project Alpha" })).toHaveAttribute("aria-expanded", "false")
    expect(within(appNav).queryByText("Active project session")).not.toBeInTheDocument()
  })

  it("keeps classic workspace sources available outside plugin-tabs mode", async () => {
    function SourcePanel() {
      return <div>Classic source body</div>
    }
    const plugin = definePlugin({
      id: "classic-source-plugin",
      workspaceSources: [{ id: "classic-source", label: "Classic source", component: SourcePanel }],
    })

    render(
      <WorkspaceAgentFront
        workspaceId="classic-workspace-source"
        chatPanel={SessionIdChatPanel}
        sessions={[{ id: "s1", title: "First session" }]}
        activeSessionId="s1"
        plugins={[plugin]}
        defaultSurfaceOpen
        defaultWorkbenchLeftOpen
        defaultWorkbenchLeftTab="classic-source"
        provisionWorkspace={false}
        persistenceEnabled={false}
      />,
    )

    await waitFor(() => expect(screen.getByText("Classic source body")).toBeInTheDocument())
  })

  it("opens the Plugins overlay from the app nav and lists external plugins only", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/v1/tree")) return new Response(JSON.stringify({ entries: [] }), { status: 200 })
      if (url.includes("/api/v1/ready-status")) return new Response(null, { status: 200 })
      if (url.includes("/api/v1/agent-plugins")) {
        return new Response(JSON.stringify([{ id: "external-plugin", boring: { label: "External Plugin" }, version: "1.2.3", revision: 4, frontTarget: { kind: "module-url", revision: 4 } }]), { status: 200 })
      }
      if (url.includes("/api/v1/agent/reload")) return new Response(JSON.stringify({ reloaded: true }), { status: 200 })
      if (url.includes("/api/v1/ui/commands/next")) return new Response(JSON.stringify([]), { status: 200 })
      return new Response(null, { status: 204 })
    }))

    function PluginPanel() {
      return <div>Demo plugin panel body</div>
    }
    const plugin = definePlugin({
      id: "demo-plugin",
      label: "Demo Plugin",
      panels: [{ id: "demo-plugin.panel", label: "Demo Panel", placement: "workspace-page", component: PluginPanel }],
    })

    render(
      <WorkspaceAgentFront
        workspaceId="plugin-tabs-plugins-overlay"
        workspaceLayout="plugin-tabs"
        chatPanel={SessionIdChatPanel}
        sessions={[{ id: "s1", title: "First session" }]}
        activeSessionId="s1"
        plugins={[plugin]}
        persistenceEnabled={false}
      />,
    )

    await user.click(within(screen.getByLabelText("App navigation")).getByRole("button", { name: "Plugins" }))
    const overlay = document.querySelector('[data-boring-workspace-part="plugins-overlay"]')
    expect(overlay).not.toBeNull()
    await waitFor(() => expect(overlay!).toHaveTextContent("External Plugin"))
    expect(overlay!).toHaveTextContent("external-plugin")
    expect(overlay!).not.toHaveTextContent("Demo Plugin")
    expect(overlay!).not.toHaveTextContent("Demo Panel")

    await user.click(within(screen.getByLabelText("App navigation")).getByRole("button", { name: "New chat" }))
    expect(document.querySelector('[data-boring-workspace-part="plugins-overlay"]')).toBeNull()
  })

  it("persists the active app-left overlay across reloads", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/v1/tree")) return new Response(JSON.stringify({ entries: [] }), { status: 200 })
      if (url.includes("/api/v1/ready-status")) return new Response(null, { status: 200 })
      if (url.includes("/api/v1/agent/skills")) return new Response(JSON.stringify({ skills: [] }), { status: 200 })
      if (url.includes("/api/v1/agent-plugins")) return new Response(JSON.stringify([]), { status: 200 })
      if (url.includes("/api/v1/ui/commands/next")) return new Response(JSON.stringify([]), { status: 200 })
      return new Response(null, { status: 204 })
    }))

    const props = {
      workspaceId: "plugin-tabs-persist-left-overlay",
      workspaceLayout: "plugin-tabs" as const,
      chatPanel: SessionIdChatPanel,
      sessions: [{ id: "s1", title: "First session" }],
      activeSessionId: "s1",
      providerStorageKey: "test:persist-left-overlay",
    }
    const { unmount } = render(<WorkspaceAgentFront {...props} />)

    await user.click(within(screen.getByLabelText("App navigation")).getByRole("button", { name: "Skills" }))
    await waitFor(() => expect(document.querySelector('[data-boring-workspace-part="skills-page"]')).not.toBeNull())

    unmount()
    render(<WorkspaceAgentFront {...props} />)

    await waitFor(() => expect(document.querySelector('[data-boring-workspace-part="skills-page"]')).not.toBeNull())
  })

  it.each([
    { action: "Plugins", part: "plugins-overlay" },
    { action: "Skills", part: "skills-page" },
  ])("closes the $action overlay when switching sessions from app navigation", async ({ action, part }) => {
    const user = userEvent.setup()
    const onSwitchSession = vi.fn()
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/v1/tree")) return new Response(JSON.stringify({ entries: [] }), { status: 200 })
      if (url.includes("/api/v1/ready-status")) return new Response(null, { status: 200 })
      if (url.includes("/api/v1/agent/skills")) return new Response(JSON.stringify({ skills: [] }), { status: 200 })
      if (url.includes("/api/v1/agent-plugins")) return new Response(JSON.stringify([]), { status: 200 })
      if (url.includes("/api/v1/agent/reload")) return new Response(JSON.stringify({ reloaded: true }), { status: 200 })
      if (url.includes("/api/v1/ui/commands/next")) return new Response(JSON.stringify([]), { status: 200 })
      return new Response(null, { status: 204 })
    }))

    render(
      <WorkspaceAgentFront
        workspaceId={`plugin-tabs-${part}-session-switch`}
        workspaceLayout="plugin-tabs"
        chatPanel={SessionIdChatPanel}
        sessions={[
          { id: "s1", title: "First session" },
          { id: "s2", title: "Second session" },
        ]}
        activeSessionId="s1"
        onSwitchSession={onSwitchSession}
        persistenceEnabled={false}
      />,
    )

    const appNav = screen.getByLabelText("App navigation")
    await user.click(within(appNav).getByRole("button", { name: action }))
    await waitFor(() => expect(document.querySelector(`[data-boring-workspace-part="${part}"]`)).not.toBeNull())

    await user.click(within(appNav).getByText("Second session"))

    expect(onSwitchSession).toHaveBeenCalledWith("s2")
    expect(document.querySelector(`[data-boring-workspace-part="${part}"]`)).toBeNull()
    expect(visibleChatSessionIds()).toEqual(["s2"])
  })

  it("closes an app-left overlay when reselecting the active session", async () => {
    const user = userEvent.setup()
    const onSwitchSession = vi.fn()
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/v1/tree")) return new Response(JSON.stringify({ entries: [] }), { status: 200 })
      if (url.includes("/api/v1/ready-status")) return new Response(null, { status: 200 })
      if (url.includes("/api/v1/agent-plugins")) return new Response(JSON.stringify([]), { status: 200 })
      if (url.includes("/api/v1/ui/commands/next")) return new Response(JSON.stringify([]), { status: 200 })
      return new Response(null, { status: 204 })
    }))

    render(
      <WorkspaceAgentFront
        workspaceId="plugin-tabs-active-session-closes-overlay"
        workspaceLayout="plugin-tabs"
        chatPanel={SessionIdChatPanel}
        sessions={[{ id: "s1", title: "First session" }]}
        activeSessionId="s1"
        onSwitchSession={onSwitchSession}
        persistenceEnabled={false}
      />,
    )

    const appNav = screen.getByLabelText("App navigation")
    await user.click(within(appNav).getByRole("button", { name: "Plugins" }))
    await waitFor(() => expect(document.querySelector('[data-boring-workspace-part="plugins-overlay"]')).not.toBeNull())

    await user.click(within(appNav).getByText("First session"))

    expect(onSwitchSession).toHaveBeenCalledWith("s1")
    expect(document.querySelector('[data-boring-workspace-part="plugins-overlay"]')).toBeNull()
  })

  it("opens Skills as a chat overlay and uses the UI bridge to open a skill", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/v1/tree")) return new Response(JSON.stringify({ entries: [] }), { status: 200 })
      if (url.includes("/api/v1/ready-status")) return new Response(null, { status: 200 })
      if (url.includes("/api/v1/agent/skills")) {
        return new Response(JSON.stringify({
          skills: [{
            name: "review",
            description: "Review the current diff",
            source: "project",
            filePath: ".agents/skills/review/SKILL.md",
          }],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      if (url.includes("/api/v1/agent-plugins")) {
        return new Response(JSON.stringify([{ id: "external-overlay-plugin", boring: { label: "External Overlay" }, revision: 2 }]), { status: 200 })
      }
      if (url.includes("/api/v1/agent/reload")) return new Response(JSON.stringify({ reloaded: true }), { status: 200 })
      if (url.includes("/api/v1/ui/commands/next")) return new Response(JSON.stringify([]), { status: 200 })
      return new Response(null, { status: 204 })
    }))

    function PluginPanel() {
      return <div>Plugin panel body</div>
    }
    const plugin = definePlugin({
      id: "overlay-plugin",
      label: "Demo Plugin",
      panels: [{ id: "overlay-plugin.panel", label: "Demo Panel", placement: "workspace-page", component: PluginPanel }],
    })

    const commands: UiCommand[] = []
    const onUiCommand = (event: Event) => commands.push((event as CustomEvent<UiCommand>).detail)
    window.addEventListener(UI_COMMAND_EVENT, onUiCommand)
    try {
      render(
        <WorkspaceAgentFront
          workspaceId="plugin-tabs-overlays"
          workspaceLayout="plugin-tabs"
          chatPanel={SessionIdChatPanel}
          sessions={[{ id: "s1", title: "First session" }]}
          activeSessionId="s1"
          plugins={[plugin]}
          persistenceEnabled={false}
        />,
      )

      await user.click(within(screen.getByLabelText("App navigation")).getByRole("button", { name: "Skills" }))
      await waitFor(() => expect(screen.getByText("/review")).toBeInTheDocument())
      expect(screen.getByText("Review the current diff")).toBeInTheDocument()

      await user.click(screen.getByRole("button", { name: "Open skill review in workspace" }))
      expect(commands).toContainEqual({
        kind: "openFile",
        params: { path: ".agents/skills/review/SKILL.md", mode: "view" },
      })
      expect(screen.getByText("/review")).toBeInTheDocument()

      await user.click(screen.getByRole("button", { name: "Hide app navigation" }))
      expect(screen.getByText("Skills").closest("header")?.className).toContain("pl-12")

      await user.click(screen.getByRole("button", { name: "Close skills" }))
      expect(screen.queryByText("/review")).not.toBeInTheDocument()
      await user.click(screen.getByRole("button", { name: "Open app navigation" }))
      await user.click(within(screen.getByLabelText("App navigation")).getByRole("button", { name: "Skills" }))
      await waitFor(() => expect(screen.getByText("/review")).toBeInTheDocument())
      await user.click(within(screen.getByLabelText("App navigation")).getByRole("button", { name: "New chat" }))
      expect(screen.queryByText("/review")).not.toBeInTheDocument()

    } finally {
      window.removeEventListener(UI_COMMAND_EVENT, onUiCommand)
    }
  })

  it("replaces the active pane with the controlled canonical session", async () => {
    const user = userEvent.setup()
    const created = { id: "created", title: "Created session", updatedAt: Date.now() }

    render(
      <WorkspaceAgentFront
        workspaceId="controlled-create-pane"
        chatPanel={SessionIdChatPanel}
        sessions={[{ id: "s1", title: "First session", updatedAt: Date.now() - 1_000 }]}
        activeSessionId="s1"
        onCreateSession={() => created}
        persistenceEnabled={false}
      />,
    )
    expandHistory()

    await user.click(screen.getByRole("button", { name: "New chat" }))
    await waitFor(() => expect(visibleChatSessionIds()).toEqual(["created"]))
  })

  it("restores the persisted pane layout on reload", async () => {
    localStorage.setItem(
      "boring-workspace:chat-panes:restore-panes",
      JSON.stringify({ ids: ["s1", "s2"], activeId: "s2" }),
    )
    const sessions = [
      { id: "s1", title: "First session", updatedAt: Date.now() - 1_000 },
      { id: "s2", title: "Second session", updatedAt: Date.now() - 2_000 },
    ]

    render(
      <WorkspaceAgentFront
        workspaceId="restore-panes"
        chatPanel={SessionIdChatPanel}
        sessions={sessions}
        activeSessionId="s2"
        onSwitchSession={vi.fn()}
        onCreateSession={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(visibleChatSessionIds()).toEqual(["s1", "s2"])
    })
  })

  it("restores the persisted pane layout while remote sessions load", async () => {
    localStorage.setItem(
      "boring-workspace:chat-panes:remote-restore",
      JSON.stringify({ ids: ["s1", "s2"], activeId: "s2" }),
    )
    localStorage.setItem("boring-workspace:sessions:remote-restore", "s2")

    function useDelayedSessions() {
      const [loading, setLoading] = useState(true)
      useEffect(() => {
        const timer = setTimeout(() => setLoading(false), 50)
        return () => clearTimeout(timer)
      }, [])
      const sessions = loading
        ? []
        : [
            { id: "s1", title: "First session", updatedAt: Date.now() - 1_000 },
            { id: "s2", title: "Second session", updatedAt: Date.now() - 2_000 },
          ]
      return {
        sessions,
        loading,
        activeSessionId: loading ? null : "s2",
        activeSession: sessions[1] ?? null,
        switch: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      }
    }

    render(
      <WorkspaceAgentFront
        workspaceId="remote-restore"
        chatPanel={SessionIdChatPanel}
        useSessions={useDelayedSessions}
      />,
    )

    await waitFor(() => {
      expect(visibleChatSessionIds()).toEqual(["s1", "s2"])
    })
  })

  it("keeps an async returned replacement pane while controlled sessions catch up", async () => {
    const user = userEvent.setup()

    function Harness() {
      const [sessions, setSessions] = useState([
        { id: "s1", title: "First session", updatedAt: Date.now() - 1_000 },
      ])
      const [activeSessionId, setActiveSessionId] = useState("s1")
      return (
        <WorkspaceAgentFront
          workspaceId="async-created-pane"
          chatPanel={SessionIdChatPanel}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSwitchSession={setActiveSessionId}
          onCreateSession={() => Promise.resolve({ id: "created", title: "Created session", updatedAt: Date.now() })}
          beforeShell={
            <button type="button" onClick={() => setSessions((previous) => [...previous])}>
              Refresh stale sessions
            </button>
          }
          persistenceEnabled={false}
        />
      )
    }

    render(<Harness />)
    expandHistory()

    await user.click(screen.getByRole("button", { name: "New chat" }))

    await waitFor(() => {
      expect(visibleChatSessionIds()).toEqual(["created"])
    })

    await user.click(screen.getByRole("button", { name: "Refresh stale sessions" }))

    await waitFor(() => {
      expect(visibleChatSessionIds()).toEqual(["created"])
    })
  })

  it("creates a split pane from an asynchronously returned addressed session", async () => {
    const user = userEvent.setup()

    render(
      <WorkspaceAgentFront
        workspaceId="returned-split-pane"
        chatPanel={SessionIdChatPanel}
        sessions={[{ id: "s1", agentTypeId: "alpha", title: "First session", updatedAt: Date.now() }]}
        activeSessionId="s1"
        agentTypeId="alpha"
        onCreateSession={() => Promise.resolve({
          id: "created",
          agentTypeId: "beta",
          title: "Created session",
          updatedAt: Date.now(),
        })}
        persistenceEnabled={false}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Split First session chat vertically" }))

    await waitFor(() => expect(visibleChatSessionIds()).toEqual(["s1", "created"]))
    expect(screen.getByRole("button", { name: "Split created chat horizontally" })).toBeEnabled()
  })

  it("releases split pending when a custom create throws synchronously", async () => {
    const create = vi.fn()
      .mockImplementationOnce(() => { throw new Error("sync split failed") })
      .mockResolvedValueOnce({ id: "retried-split", title: "Retried split", updatedAt: Date.now() })

    render(
      <WorkspaceAgentFront
        workspaceId="sync-split-retry"
        chatPanel={SessionIdChatPanel}
        sessions={[{ id: "s1", title: "First session", updatedAt: Date.now() }]}
        activeSessionId="s1"
        onCreateSession={create}
        persistenceEnabled={false}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Split First session chat vertically" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Split First session chat horizontally" })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: "Split First session chat horizontally" }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(visibleChatSessionIds()).toEqual(["s1", "retried-split"]))
  })

  it("releases split pending after a resolved callback throws so a split can retry", async () => {
    const create = vi.fn()
      .mockReturnValueOnce({ id: "first-created", title: "First created", updatedAt: Date.now() })
      .mockReturnValueOnce({ id: "retried-created", title: "Retried created", updatedAt: Date.now() })
    const switchSession = vi.fn()
      .mockImplementationOnce(() => { throw new Error("switch failed") })

    render(
      <WorkspaceAgentFront
        workspaceId="callback-split-retry"
        chatPanel={SessionIdChatPanel}
        sessions={[{ id: "s1", title: "First session", updatedAt: Date.now() }]}
        activeSessionId="s1"
        onSwitchSession={switchSession}
        onCreateSession={create}
        persistenceEnabled={false}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Split First session chat vertically" }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getByRole("button", { name: "Split First session chat horizontally" })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: "Split First session chat horizontally" }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
  })

  it("ignores another split request while asynchronous pane creation is pending", async () => {
    const user = userEvent.setup()
    let resolveCreate!: (session: { id: string; title: string; updatedAt: number }) => void
    const onCreateSession = vi.fn(() => new Promise<{ id: string; title: string; updatedAt: number }>((resolve) => {
      resolveCreate = resolve
    }))

    render(
      <WorkspaceAgentFront
        workspaceId="concurrent-split-pane"
        chatPanel={SessionIdChatPanel}
        sessions={[{ id: "s1", title: "First session", updatedAt: Date.now() }]}
        activeSessionId="s1"
        onCreateSession={onCreateSession}
        persistenceEnabled={false}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Split First session chat vertically" }))
    expect(screen.getByRole("button", { name: "Split First session chat horizontally" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "Split First session chat horizontally" }))
    expect(onCreateSession).toHaveBeenCalledOnce()

    resolveCreate({ id: "created", title: "Created session", updatedAt: Date.now() })
    await waitFor(() => expect(visibleChatSessionIds()).toEqual(["s1", "created"]))
    expect(screen.getByRole("button", { name: "Split created chat horizontally" })).toBeEnabled()
  })

  it("creates a split pane from the returned canonical session", async () => {
    const user = userEvent.setup()
    render(
      <WorkspaceAgentFront
        workspaceId="canonical-split-pane"
        chatPanel={SessionIdChatPanel}
        sessions={[{ id: "s1", title: "First session", updatedAt: Date.now() }]}
        activeSessionId="s1"
        onCreateSession={() => ({ id: "created", title: "Created", updatedAt: Date.now() })}
        persistenceEnabled={false}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Split First session chat horizontally" }))
    await waitFor(() => expect(visibleChatSessionIds()).toEqual(["s1", "created"]))
  })

  it("uses the canonical result rather than an unrelated row published before settlement", async () => {
    const createGate = deferred<{ id: string; title: string }>()
    const create = vi.fn(() => createGate.promise)

    render(
      <WorkspaceAgentFront
        workspaceId="row-before-create-settle"
        chatPanel={SessionIdChatPanel}
        sessions={[{ id: "unrelated", title: "Unrelated" }, { id: "existing", title: "Existing" }]}
        activeSessionId="existing"
        onCreateSession={create}
        persistenceEnabled={false}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "New chat" }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    act(() => createGate.resolve({ id: "canonical", title: "Canonical" }))
    await waitFor(() => expect(visibleChatSessionIds()).toEqual(["canonical"]))
  })

  it("fails an undefined custom create without occupying the retry queue", async () => {
    const create = vi.fn()
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ id: "retry", title: "Retry" })
    render(
      <WorkspaceAgentFront
        workspaceId="invalid-create-retry"
        chatPanel={SessionIdChatPanel}
        sessions={[{ id: "existing", title: "Existing" }]}
        activeSessionId="existing"
        onCreateSession={create as () => WorkspaceAgentSession}
        persistenceEnabled={false}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "New chat" }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole("button", { name: "New chat" }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(visibleChatSessionIds()).toEqual(["retry"]))
  })

  it("removes an open chat pane when its session is deleted from history", async () => {
    const user = userEvent.setup()
    const deleted = vi.fn()

    function Harness() {
      const [sessions, setSessions] = useState([
        { id: "s1", title: "First session", updatedAt: Date.now() - 1_000 },
        { id: "s2", title: "Second session", updatedAt: Date.now() - 2_000 },
      ])
      const [activeSessionId, setActiveSessionId] = useState("s1")
      return (
        <WorkspaceAgentFront
          workspaceId="delete-open-pane"
          chatPanel={SessionIdChatPanel}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSwitchSession={setActiveSessionId}
          onDeleteSession={(id) => {
            deleted(id)
            setSessions((previous) => previous.filter((session) => session.id !== id))
          }}
          defaultNavOpen
          persistenceEnabled={false}
        />
      )
    }

    render(<Harness />)
    expandHistory()

    await user.click(screen.getByLabelText("Open Second session in chat pane"))
    expect(visibleChatSessionIds()).toEqual(["s1", "s2"])

    await user.click(screen.getByLabelText("Delete Second session"))

    await waitFor(() => {
      expect(deleted).toHaveBeenCalledWith("s2")
      expect(visibleChatSessionIds()).toEqual(["s1"])
      expect(screen.queryByText("Second session")).not.toBeInTheDocument()
    })
  })

  it("prunes open panes when a controlled session list drops a session", async () => {
    const user = userEvent.setup()

    function Harness() {
      const [sessions, setSessions] = useState([
        { id: "s1", title: "First session", updatedAt: Date.now() - 1_000 },
        { id: "s2", title: "Second session", updatedAt: Date.now() - 2_000 },
      ])
      const [activeSessionId, setActiveSessionId] = useState("s1")
      return (
        <WorkspaceAgentFront
          workspaceId="external-session-prune"
          chatPanel={SessionIdChatPanel}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSwitchSession={setActiveSessionId}
          beforeShell={
            <button type="button" onClick={() => setSessions((previous) => previous.filter((session) => session.id !== "s2"))}>
              Drop second session
            </button>
          }
          defaultNavOpen
          persistenceEnabled={false}
        />
      )
    }

    render(<Harness />)
    expandHistory()

    await user.click(screen.getByLabelText("Open Second session in chat pane"))
    expect(visibleChatSessionIds()).toEqual(["s1", "s2"])

    await user.click(screen.getByRole("button", { name: "Drop second session" }))

    await waitFor(() => {
      expect(visibleChatSessionIds()).toEqual(["s1"])
      expect(screen.queryByText("Second session")).not.toBeInTheDocument()
    })
  })

  it("keeps open panes that are missing from a paginated remote session page", async () => {
    const user = userEvent.setup()

    function Harness() {
      const [sessions, setSessions] = useState([
        { id: "s1", title: "First session", updatedAt: Date.now() - 1_000 },
        { id: "s2", title: "Second session", updatedAt: Date.now() - 2_000 },
      ])
      const [activeSessionId, setActiveSessionId] = useState("s1")
      const usePaginatedSessions = () => ({
        sessions,
        activeSessionId,
        activeSession: sessions.find((session) => session.id === activeSessionId) ?? null,
        loading: false,
        hasMore: true,
        create: vi.fn(),
        switch: setActiveSessionId,
        delete: vi.fn(),
      })
      return (
        <WorkspaceAgentFront
          workspaceId="paginated-session-pane"
          chatPanel={SessionIdChatPanel}
          useSessions={usePaginatedSessions}
          beforeShell={
            <button type="button" onClick={() => setSessions((previous) => previous.filter((session) => session.id !== "s2"))}>
              Show first page
            </button>
          }
          defaultNavOpen
          persistenceEnabled={false}
        />
      )
    }

    render(<Harness />)
    expandHistory()

    await user.click(screen.getByLabelText("Open Second session in chat pane"))
    expect(visibleChatSessionIds()).toEqual(["s1", "s2"])

    await user.click(screen.getByRole("button", { name: "Show first page" }))

    await waitFor(() => {
      expect(visibleChatSessionIds()).toEqual(["s1", "s2"])
    })
  })

  it("keeps the UI command stream owned by the active chat pane only", async () => {
    const user = userEvent.setup()
    MockEventSource.instances = []
    vi.stubGlobal("EventSource", MockEventSource)
    const sessions = [
      { id: "s1", title: "First session", updatedAt: Date.now() - 1_000 },
      { id: "s2", title: "Second session", updatedAt: Date.now() - 2_000 },
    ]
    const activeStreams = () => MockEventSource.instances.filter((instance) => (
      instance.url.includes("/api/v1/ui/commands/next")
      && instance.close.mock.calls.length === 0
    ))

    function Harness() {
      const [activeSessionId, setActiveSessionId] = useState("s1")
      return (
        <WorkspaceAgentFront
          workspaceId="single-ui-command-stream"
          chatPanel={SessionIdChatPanel}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSwitchSession={setActiveSessionId}
          bridgeEndpoint="/api/v1/ui"
          defaultNavOpen
          persistenceEnabled={false}
        />
      )
    }

    render(<Harness />)
    expandHistory()

    await waitFor(() => {
      expect(activeStreams()).toHaveLength(1)
    })

    await user.click(screen.getByLabelText("Open Second session in chat pane"))

    await waitFor(() => {
      expect(visibleChatSessionIds()).toEqual(["s1", "s2"])
      expect(activeStreams()).toHaveLength(1)
    })
  })

  it("does not stop still-visible sessions when changing visible chat panes", async () => {
    const user = userEvent.setup()
    const stopEvents: unknown[] = []
    const onStop = (event: Event) => stopEvents.push((event as CustomEvent).detail)
    window.addEventListener("boring:workspace-composer-stop", onStop)
    const sessions = [
      { id: "s1", title: "First session", updatedAt: Date.now() - 1_000 },
      { id: "s2", title: "Second session", updatedAt: Date.now() - 2_000 },
    ]

    function Harness() {
      const [activeSessionId, setActiveSessionId] = useState("s1")
      return (
        <WorkspaceAgentFront
          workspaceId="visible-pane-no-stop"
          chatPanel={SessionIdChatPanel}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSwitchSession={setActiveSessionId}
          defaultNavOpen
          persistenceEnabled={false}
        />
      )
    }

    render(<Harness />)
    expandHistory()

    try {
      await user.click(screen.getByLabelText("Open Second session in chat pane"))
      await user.click(screen.getByLabelText("Chat session First session"))
      await user.click(screen.getByLabelText("Chat session Second session"))
      await user.click(screen.getByLabelText("Close Second session pane"))

      expect(stopEvents).toEqual([])
    } finally {
      window.removeEventListener("boring:workspace-composer-stop", onStop)
    }
  })

  it("keeps keyboard focus aligned with the active chat pane", async () => {
    const user = userEvent.setup()
    const switchCalls: string[] = []
    const sessions = [
      { id: "s1", title: "First session", updatedAt: Date.now() - 1_000 },
      { id: "s2", title: "Second session", updatedAt: Date.now() - 2_000 },
    ]

    function Harness() {
      const [activeSessionId, setActiveSessionId] = useState("s1")
      return (
        <WorkspaceAgentFront
          workspaceId="keyboard-pane-focus"
          chatPanel={TextareaChatPanel}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSwitchSession={(id) => {
            switchCalls.push(id)
            setActiveSessionId(id)
          }}
          defaultNavOpen
          persistenceEnabled={false}
        />
      )
    }

    render(<Harness />)
    expandHistory()

    await user.click(screen.getByLabelText("Open Second session in chat pane"))
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }))

    await waitFor(() => {
      expect(screen.getByTestId("composer-s2")).toHaveFocus()
    })

    act(() => {
      screen.getByTestId("composer-s1").focus()
    })

    await waitFor(() => {
      expect(switchCalls).toContain("s1")
    })
  })

  it("restores session history and workbench visibility per workspace", async () => {
    localStorage.setItem("boring-ui-v2:layout:workspace-a:drawer", "0")
    localStorage.setItem("boring-ui-v2:layout:workspace-a:workbenchOpen", "1")
    localStorage.setItem("boring-ui-v2:layout:workspace-b:drawer", "1")
    localStorage.setItem("boring-ui-v2:layout:workspace-b:workbenchOpen", "0")

    const { rerender } = render(
      <WorkspaceAgentFront
        workspaceId="workspace-a"
        chatPanel={ChatPanel}
      />,
    )

    await waitFor(() => {
      expect(screen.getByLabelText("Session browser")).toHaveAttribute("aria-hidden", "true")
      expect(screen.getByLabelText("Surface")).toHaveAttribute("aria-hidden", "false")
    })

    rerender(
      <WorkspaceAgentFront
        workspaceId="workspace-b"
        chatPanel={ChatPanel}
      />,
    )

    await waitFor(() => {
      expect(screen.getByLabelText("Session browser")).toHaveAttribute("aria-hidden", "false")
      expect(screen.queryByLabelText("Surface")).not.toBeInTheDocument()
    })
  })

  it("shows workbench-local warmup overlay instead of mounting panels while preparing", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})))

    render(
      <WorkspaceAgentFront
        workspaceId="overlay-workspace"
        chatPanel={ChatPanel}
        panels={[globalCommandPanel]}
        extraPanels={[globalCommandPanel.id]}
        defaultSurfaceOpen
        persistenceEnabled={false}
      />,
    )

    expect(screen.getByText("Chat panel")).toBeInTheDocument()
    expect(screen.getByText("Preparing workspace…")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Close workbench" })).toBeInTheDocument()
    expect(screen.queryByText("Global command panel body")).not.toBeInTheDocument()
  })

  it("does not publish empty tabs while an open workbench is still preparing", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(() => {}))
    vi.stubGlobal("fetch", fetchMock)

    render(
      <WorkspaceAgentFront
        workspaceId="preparing-state"
        chatPanel={ChatPanel}
        defaultSurfaceOpen
        persistenceEnabled={false}
      />,
    )

    expect(screen.getByText("Preparing workspace…")).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/v1/ui/state")),
    ).toBe(false)
  })

  it("keeps the workbench open rail available while workspace warmup is preparing", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})))

    render(
      <WorkspaceAgentFront
        workspaceId="prepare-workbench-toggle"
        chatPanel={ChatPanel}
        panels={[globalCommandPanel]}
        extraPanels={[globalCommandPanel.id]}
        persistenceEnabled={false}
      />,
    )

    expect(screen.getByText("Preparing workspace…")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open workbench" })).toBeInTheDocument()
  })

  it("does not start default remote session warmup when provisioning is disabled", async () => {
    const onWarmup = vi.fn()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/api/v1/tree")) return new Response(JSON.stringify({ entries: [] }), { status: 200 })
      if (url.includes("/api/v1/agent/models")) return new Response(JSON.stringify({ models: [] }), { status: 200 })
      if (url.includes("/api/v1/agent/skills")) return new Response(JSON.stringify({ skills: [] }), { status: 200 })
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <WorkspaceAgentFront
        workspaceId="no-provision"
        requestHeaders={{ "x-boring-workspace-id": "stale", "X-BORING-WORKSPACE-ID": "stale-uppercase" }}
        provisionWorkspace={false}
        persistenceEnabled={false}
        onWorkspaceWarmupStatusChange={onWarmup}
      />,
    )

    await waitFor(() => expect(onWarmup).toHaveBeenLastCalledWith({ status: "ready" }))
    const treeCalls = fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/v1/tree"))
    expect(treeCalls.length).toBeGreaterThan(0)
    for (const call of treeCalls) {
      expect(call[1]?.headers).toMatchObject({ "x-boring-workspace-id": "no-provision" })
      expect(call[1]?.headers).not.toHaveProperty("X-BORING-WORKSPACE-ID")
    }
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/agent/pi-chat/sessions"))).toBe(false)
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/agent/" + "chat"))).toBe(false)
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/ready-status"))).toBe(false)
  })

  it("creates a fresh remote session for auth-return auto-submit instead of reusing the old active session", async () => {
    let capturedChatProps: unknown
    const getCapturedChatProps = () => capturedChatProps as CapturedChatPanelProps | undefined
    const seenSessionIds: string[] = []
    const CapturingChatPanel = (props: WorkspaceChatPanelProps) => {
      capturedChatProps = props
      seenSessionIds.push(props.sessionId)
      return <div>Captured chat panel</div>
    }
    const createSession = vi.fn()
    const useSessions = () => {
      const [sessions, setSessions] = useState([{ id: "sess-old", title: "Old session" }])
      const [activeSessionId, setActiveSessionId] = useState<string | null>("sess-old")
      return {
        sessions,
        loading: false,
        error: undefined,
        activeSessionId,
        activeSession: sessions.find((session) => session.id === activeSessionId) ?? null,
        switch: vi.fn(),
        create: async () => {
          createSession()
          const session = { id: "sess-fresh", title: "Fresh session" }
          setSessions((current) => [session, ...current])
          setActiveSessionId(session.id)
          return session
        },
        delete: vi.fn(),
      }
    }

    render(
      <WorkspaceAgentFront
        workspaceId="auth-return-fresh-session"
        chatPanel={CapturingChatPanel}
        useSessions={useSessions}
        chatParams={{ initialDraft: "restore and send", autoSubmitInitialDraft: true }}
        persistenceEnabled={false}
      />,
    )

    expect(getCapturedChatProps()?.sessionId).toBe("default")
    expect(getCapturedChatProps()?.initialDraft).toBeUndefined()
    expect(getCapturedChatProps()?.autoSubmitInitialDraft).toBe(false)

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledOnce()
    })
    await waitFor(() => {
      expect(getCapturedChatProps()?.sessionId).toBe("sess-fresh")
    })

    expect(getCapturedChatProps()?.initialDraft).toBe("restore and send")
    expect(getCapturedChatProps()?.autoSubmitInitialDraft).toBe(true)
    expect(seenSessionIds).not.toContain("sess-old")
  })

  it("withdraws auto-submit while its fresh-session create is pending and fences the late continuation", async () => {
    const createGate = deferred<void>()
    let captured: CapturedChatPanelProps | undefined

    function Harness() {
      const [requested, setRequested] = useState(true)
      const [sessions, setSessions] = useState([{ id: "existing", title: "Existing" }])
      const [activeSessionId, setActiveSessionId] = useState("existing")
      const useSessions = () => ({
        sessions,
        loading: false,
        activeSessionId,
        activeSession: sessions.find((session) => session.id === activeSessionId),
        switch: setActiveSessionId,
        create: async () => {
          await createGate.promise
          const created = { id: "late-created", title: "Late created" }
          setSessions((current) => [created, ...current])
          setActiveSessionId(created.id)
          return created
        },
        delete: vi.fn(),
      })
      return (
        <>
          <button type="button" onClick={() => setRequested(false)}>Withdraw request</button>
          <WorkspaceAgentFront
            workspaceId="withdraw-pending-auto-submit"
            chatPanel={(props) => {
              captured = props as CapturedChatPanelProps
              return <AutoSubmitProbe {...props} />
            }}
            useSessions={useSessions}
            chatParams={requested ? { initialDraft: "do not send late", autoSubmitInitialDraft: true } : {}}
            persistenceEnabled={false}
          />
        </>
      )
    }

    render(<Harness />)
    await waitFor(() => expect(captured?.sessionId).toBe("default"))
    expect(captured?.hydrateMessages).toBe(false)

    fireEvent.click(screen.getByRole("button", { name: "Withdraw request" }))
    await waitFor(() => expect(captured).toEqual(expect.objectContaining({
      sessionId: "existing",
      hydrateMessages: true,
    })))
    expect(captured?.autoSubmitInitialDraft).not.toBe(true)

    await act(async () => {
      createGate.resolve()
      await createGate.promise
    })
    await waitFor(() => expect(captured?.sessionId).toBe("late-created"))
    expect(captured?.autoSubmitInitialDraft).not.toBe(true)
    expect(captured?.initialDraft).toBeUndefined()
    expect(captured?.hydrateMessages).toBe(true)
  })

  it("starts a distinct auto-submit attempt when re-enabled before the withdrawn create resolves", async () => {
    const oldCreate = deferred<void>()
    const create = vi.fn()
    let captured: CapturedChatPanelProps | undefined

    function Harness() {
      const [requested, setRequested] = useState(true)
      const [sessions, setSessions] = useState([{ id: "existing", title: "Existing" }])
      const [activeSessionId, setActiveSessionId] = useState("existing")
      const useSessions = (options: { sourceIdentity: string }) => ({
        sourceIdentity: options.sourceIdentity,
        sessions,
        loading: false,
        activeSessionId,
        activeSession: sessions.find((session) => session.id === activeSessionId),
        switch: setActiveSessionId,
        create: async () => {
          const attempt = create.mock.calls.length + 1
          create()
          if (attempt === 1) await oldCreate.promise
          const created = { id: attempt === 1 ? "withdrawn-old" : "reenabled-new", title: "Created" }
          setSessions((current) => [created, ...current])
          setActiveSessionId(created.id)
          return created
        },
        delete: vi.fn(),
      })
      return (
        <>
          <button type="button" onClick={() => setRequested(false)}>Withdraw attempt</button>
          <button type="button" onClick={() => setRequested(true)}>Re-enable attempt</button>
          <WorkspaceAgentFront
            workspaceId="reenable-pending-auto-submit"
            chatPanel={(props) => {
              captured = props as CapturedChatPanelProps
              return <AutoSubmitProbe {...props} />
            }}
            useSessions={useSessions}
            chatParams={requested ? { initialDraft: "send new attempt", autoSubmitInitialDraft: true } : {}}
            persistenceEnabled={false}
          />
        </>
      )
    }

    render(<Harness />)
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole("button", { name: "Withdraw attempt" }))
    await waitFor(() => expect(captured?.hydrateMessages).toBe(true))
    fireEvent.click(screen.getByRole("button", { name: "Re-enable attempt" }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(captured).toEqual(expect.objectContaining({
      sessionId: "reenabled-new",
      autoSubmitInitialDraft: true,
      hydrateMessages: false,
    })))
    act(() => captured?.onAutoSubmitInitialDraftSettled?.())
    await waitFor(() => expect(captured?.hydrateMessages).toBe(true))

    await act(async () => {
      oldCreate.resolve()
      await oldCreate.promise
    })
    await waitFor(() => expect(captured?.sessionId).toBe("withdrawn-old"))
    expect(captured?.autoSubmitInitialDraft).not.toBe(true)
    expect(captured?.hydrateMessages).toBe(true)
  })

  it("withdraws a designated but unsettled auto-submit target and restores hydration", async () => {
    let captured: CapturedChatPanelProps | undefined

    function Harness() {
      const [requested, setRequested] = useState(true)
      const [sessions, setSessions] = useState([{ id: "existing", title: "Existing" }])
      const [activeSessionId, setActiveSessionId] = useState("existing")
      const useSessions = () => ({
        sessions,
        loading: false,
        activeSessionId,
        activeSession: sessions.find((session) => session.id === activeSessionId),
        switch: setActiveSessionId,
        create: async () => {
          const created = { id: "designated", title: "Designated" }
          setSessions((current) => [created, ...current])
          setActiveSessionId(created.id)
          return created
        },
        delete: vi.fn(),
      })
      return (
        <>
          <button type="button" onClick={() => setRequested(false)}>Withdraw designated request</button>
          <WorkspaceAgentFront
            workspaceId="withdraw-designated-auto-submit"
            chatPanel={(props) => {
              captured = props as CapturedChatPanelProps
              return <AutoSubmitProbe {...props} />
            }}
            useSessions={useSessions}
            chatParams={requested ? { initialDraft: "unsettled", autoSubmitInitialDraft: true } : {}}
            persistenceEnabled={false}
          />
        </>
      )
    }

    render(<Harness />)
    await waitFor(() => expect(captured).toEqual(expect.objectContaining({
      sessionId: "designated",
      autoSubmitInitialDraft: true,
      hydrateMessages: false,
    })))

    fireEvent.click(screen.getByRole("button", { name: "Withdraw designated request" }))
    await waitFor(() => expect(captured).toEqual(expect.objectContaining({
      sessionId: "designated",
      hydrateMessages: true,
    })))
    expect(captured?.autoSubmitInitialDraft).not.toBe(true)
    expect(captured?.initialDraft).toBeUndefined()
  })

  it("serializes a manual create behind a deferred auto-submit create", async () => {
    const autoGate = deferred<void>()
    const create = vi.fn()

    function Harness() {
      const [sessions, setSessions] = useState([{ id: "existing", title: "Existing" }])
      const [activeSessionId, setActiveSessionId] = useState("existing")
      const useSessions = () => ({
        sessions,
        loading: false,
        activeSessionId,
        activeSession: sessions.find((session) => session.id === activeSessionId),
        switch: setActiveSessionId,
        create: async () => {
          const attempt = create.mock.calls.length + 1
          create()
          if (attempt === 1) await autoGate.promise
          const created = { id: attempt === 1 ? "auto-created" : "manual-created", title: "Created" }
          setSessions((current) => [created, ...current])
          setActiveSessionId(created.id)
          return created
        },
        delete: vi.fn(),
      })
      return (
        <WorkspaceAgentFront
          workspaceId="serialized-auto-manual"
          workspaceLayout="plugin-tabs"
          chatPanel={AutoSubmitProbe}
          useSessions={useSessions}
          chatParams={{ initialDraft: "send on auto", autoSubmitInitialDraft: true }}
          persistenceEnabled={false}
        />
      )
    }

    render(<Harness />)
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    fireEvent.click(within(screen.getByLabelText("App navigation")).getByRole("button", { name: "New chat" }))
    expect(create).toHaveBeenCalledOnce()

    await act(async () => {
      autoGate.resolve()
      await autoGate.promise
    })
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    expect(screen.getAllByTestId("auto-submit-probe").filter((probe) => probe.getAttribute("data-auto-submit") === "true")).toHaveLength(1)
  })

  it("admits an auto-submit draft to exactly one pane after creating a split", async () => {
    let createCount = 0

    function Harness() {
      const [sessions, setSessions] = useState([{ id: "existing", title: "Existing" }])
      const [activeSessionId, setActiveSessionId] = useState("existing")
      const useSessions = () => ({
        sessions,
        loading: false,
        activeSessionId,
        activeSession: sessions.find((session) => session.id === activeSessionId),
        switch: setActiveSessionId,
        create: async () => {
          createCount += 1
          const session = createCount === 1
            ? { id: "auto-target", title: "Auto target" }
            : { id: "split-session", title: "Split session" }
          setSessions((current) => [session, ...current])
          setActiveSessionId(session.id)
          return session
        },
        delete: vi.fn(),
      })
      return (
        <WorkspaceAgentFront
          workspaceId="single-auto-submit-split"
          chatPanel={AutoSubmitProbe}
          useSessions={useSessions}
          chatParams={{ initialDraft: "send exactly once", autoSubmitInitialDraft: true }}
          persistenceEnabled={false}
        />
      )
    }

    render(<Harness />)
    await waitFor(() => expect(screen.getByTestId("auto-submit-probe")).toHaveAttribute("data-session-id", "auto-target"))

    fireEvent.click(screen.getByRole("button", { name: "Split Auto target chat horizontally" }))
    await waitFor(() => expect(screen.getAllByTestId("auto-submit-probe")).toHaveLength(2))

    const probes = screen.getAllByTestId("auto-submit-probe")
    expect(probes.filter((probe) => probe.getAttribute("data-auto-submit") === "true")).toHaveLength(1)
    expect(probes.filter((probe) => probe.getAttribute("data-initial-draft") === "send exactly once")).toHaveLength(1)
    expect(probes.find((probe) => probe.getAttribute("data-session-id") === "split-session")).toHaveAttribute("data-auto-submit", "false")
    expect(probes.find((probe) => probe.getAttribute("data-session-id") === "split-session")).toHaveAttribute("data-initial-draft", "")
  })

  it("admits an auto-submit draft to the main pane but not a detached view of the same session", async () => {
    function Harness() {
      const [sessions, setSessions] = useState([{ id: "existing", title: "Existing" }])
      const [activeSessionId, setActiveSessionId] = useState("existing")
      const useSessions = () => ({
        sessions,
        loading: false,
        activeSessionId,
        activeSession: sessions.find((session) => session.id === activeSessionId),
        switch: setActiveSessionId,
        create: async () => {
          const session = { id: "shared-view-session", title: "Shared view" }
          setSessions((current) => [session, ...current])
          setActiveSessionId(session.id)
          return session
        },
        delete: vi.fn(),
      })
      return (
        <WorkspaceAgentFront
          workspaceId="single-auto-submit-detached"
          chatPanel={AutoSubmitProbe}
          useSessions={useSessions}
          chatParams={{ initialDraft: "main only", autoSubmitInitialDraft: true }}
          persistenceEnabled={false}
        />
      )
    }

    render(<Harness />)
    await waitFor(() => expect(screen.getByTestId("auto-submit-probe")).toHaveAttribute("data-session-id", "shared-view-session"))

    act(() => {
      window.dispatchEvent(new CustomEvent("boring-workspace:open-detached-chat", {
        detail: { sessionId: "shared-view-session", initialDraft: "opaque detached override", composingEnabled: true },
      }))
    })
    await waitFor(() => expect(screen.getAllByTestId("auto-submit-probe")).toHaveLength(2))

    const probes = screen.getAllByTestId("auto-submit-probe")
    expect(probes.filter((probe) => probe.getAttribute("data-auto-submit") === "true")).toHaveLength(1)
    expect(probes.filter((probe) => probe.getAttribute("data-initial-draft") === "main only")).toHaveLength(1)
    expect(probes.filter((probe) => probe.getAttribute("data-auto-submit") === "false")).toHaveLength(1)
    expect(probes.filter((probe) => probe.getAttribute("data-initial-draft") === "")).toHaveLength(1)
  })

  it("resolves a unique addressed public detached open once and preserves its owner when docking", async () => {
    const switchSession = vi.fn()
    const sessions = [
      { id: "existing", agentTypeId: "beta", title: "Existing beta" },
      { id: "public-target", agentTypeId: "alpha", title: "Public alpha" },
    ]

    render(
      <WorkspaceAgentFront
        workspaceId="public-addressed-detached"
        workspaceLayout="plugin-tabs"
        chatPanel={AutoSubmitProbe}
        useSessions={() => ({
          sessions,
          loading: false,
          activeSessionId: "existing",
          activeSessionAgentTypeId: "beta",
          activeSession: sessions[0],
          switch: switchSession,
          create: vi.fn(),
          delete: vi.fn(),
        })}
        persistenceEnabled={false}
      />,
    )

    act(() => {
      window.dispatchEvent(new CustomEvent("boring-workspace:open-detached-chat", {
        detail: { sessionId: "public-target" },
      }))
    })
    await waitFor(() => expect(screen.getAllByTestId("auto-submit-probe").some((probe) => (
      probe.getAttribute("data-session-id") === "public-target"
      && probe.getAttribute("data-agent-type-id") === "alpha"
    ))).toBe(true))

    fireEvent.click(screen.getByRole("button", { name: "Dock panel" }))
    await waitFor(() => expect(switchSession).toHaveBeenCalledWith("public-target", "alpha"))
    expect(screen.queryByRole("dialog", { name: "Chat session Public alpha" })).not.toBeInTheDocument()
  })

  it("ignores a public detached open whose bare id collides across addressed owners", async () => {
    const sessions = [
      { id: "shared-public", agentTypeId: "alpha", title: "Alpha shared" },
      { id: "shared-public", agentTypeId: "beta", title: "Beta shared" },
    ]
    render(
      <WorkspaceAgentFront
        workspaceId="ambiguous-public-detached"
        chatPanel={AutoSubmitProbe}
        sessions={sessions}
        activeSessionId="shared-public"
        activeSessionAgentTypeId="alpha"
        onSwitchSession={vi.fn()}
        onCreateSession={vi.fn()}
        onDeleteSession={vi.fn()}
        persistenceEnabled={false}
      />,
    )

    act(() => {
      window.dispatchEvent(new CustomEvent("boring-workspace:open-detached-chat", {
        detail: { sessionId: "shared-public" },
      }))
    })
    await act(async () => { await Promise.resolve() })

    expect(screen.queryByRole("dialog", { name: /Chat session/ })).not.toBeInTheDocument()
  })

  it("ignores a public bare-id detached open while the session inventory is paginated", async () => {
    render(
      <WorkspaceAgentFront
        workspaceId="paginated-public-detached"
        chatPanel={AutoSubmitProbe}
        useSessions={() => ({
          sessions: [{ id: "only-loaded-page", agentTypeId: "alpha", title: "Loaded target" }],
          loading: false,
          hasMore: true,
          activeSessionId: "only-loaded-page",
          activeSessionAgentTypeId: "alpha",
          create: vi.fn(),
          switch: vi.fn(),
          delete: vi.fn(),
        })}
        persistenceEnabled={false}
      />,
    )

    act(() => {
      window.dispatchEvent(new CustomEvent("boring-workspace:open-detached-chat", {
        detail: { sessionId: "only-loaded-page" },
      }))
    })
    await act(async () => { await Promise.resolve() })

    expect(screen.queryByRole("dialog", { name: /Chat session/ })).not.toBeInTheDocument()
  })

  it("ignores a public bare-id detached open during a stale inventory transition", async () => {
    function Harness() {
      const [stale, setStale] = useState(false)
      const session = { id: "stale-target", agentTypeId: "alpha", title: "Stale target" }
      return (
        <>
          <button type="button" onClick={() => setStale(true)}>Start stale transition</button>
          <WorkspaceAgentFront
            workspaceId="stale-public-detached"
            chatPanel={AutoSubmitProbe}
            useSessions={(options) => ({
              sourceIdentity: options.sourceIdentity,
              sessions: [session],
              loading: stale,
              hasMore: false,
              activeSessionId: session.id,
              activeSessionAgentTypeId: session.agentTypeId,
              activeSession: session,
              create: vi.fn(),
              switch: vi.fn(),
              delete: vi.fn(),
            })}
            persistenceEnabled={false}
          />
        </>
      )
    }

    render(<Harness />)
    await waitFor(() => expect(screen.getByTestId("auto-submit-probe")).toHaveAttribute("data-session-id", "stale-target"))
    fireEvent.click(screen.getByRole("button", { name: "Start stale transition" }))

    act(() => {
      window.dispatchEvent(new CustomEvent("boring-workspace:open-detached-chat", {
        detail: { sessionId: "stale-target" },
      }))
    })
    await act(async () => { await Promise.resolve() })

    expect(screen.queryByRole("dialog", { name: /Chat session/ })).not.toBeInTheDocument()
  })

  it("allows later public detached drafts after auto-submit settles", async () => {
    function SettlingProbe(props: WorkspaceChatPanelProps) {
      const captured = props as CapturedChatPanelProps
      return (
        <div
          data-testid="settling-probe"
          data-session-id={props.sessionId}
          data-auto-submit={String(captured.autoSubmitInitialDraft === true)}
          data-initial-draft={captured.initialDraft ?? ""}
        >
          {captured.autoSubmitInitialDraft === true
            ? <button type="button" onClick={captured.onAutoSubmitInitialDraftSettled}>Settle auto-submit</button>
            : null}
        </div>
      )
    }

    function Harness() {
      const [sessions, setSessions] = useState([{ id: "existing", title: "Existing" }])
      const [activeSessionId, setActiveSessionId] = useState("existing")
      const useSessions = () => ({
        sessions,
        loading: false,
        activeSessionId,
        activeSession: sessions.find((session) => session.id === activeSessionId),
        switch: setActiveSessionId,
        create: async () => {
          const created = { id: "settled-session", title: "Settled" }
          setSessions((current) => [created, ...current])
          setActiveSessionId(created.id)
          return created
        },
        delete: vi.fn(),
      })
      return (
        <WorkspaceAgentFront
          workspaceId="detached-draft-after-settlement"
          chatPanel={SettlingProbe}
          useSessions={useSessions}
          chatParams={{ initialDraft: "automatic", autoSubmitInitialDraft: true }}
          persistenceEnabled={false}
        />
      )
    }

    render(<Harness />)
    fireEvent.click(await screen.findByRole("button", { name: "Settle auto-submit" }))
    await waitFor(() => expect(screen.queryByRole("button", { name: "Settle auto-submit" })).not.toBeInTheDocument())

    act(() => {
      window.dispatchEvent(new CustomEvent("boring-workspace:open-detached-chat", {
        detail: { sessionId: "settled-session", initialDraft: "later public draft", composingEnabled: true },
      }))
    })

    await waitFor(() => expect(screen.getAllByTestId("settling-probe").some((probe) => (
      probe.getAttribute("data-session-id") === "settled-session"
      && probe.getAttribute("data-initial-draft") === "later public draft"
      && probe.getAttribute("data-auto-submit") === "false"
    ))).toBe(true))
  })

  it("targets a canonical manual retry after auto-submit creation fails", async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(new Error("automatic create failed"))
      .mockResolvedValueOnce({ id: "canonical-retry", title: "Canonical retry" })
    render(
      <WorkspaceAgentFront
        workspaceId="canonical-create-auto-submit-recovery"
        workspaceLayout="plugin-tabs"
        chatPanel={AutoSubmitProbe}
        useSessions={() => ({
          sessions: [{ id: "existing", title: "Existing" }],
          loading: false,
          activeSessionId: "existing",
          activeSession: { id: "existing", title: "Existing" },
          switch: vi.fn(),
          create,
          delete: vi.fn(),
        })}
        chatParams={{ initialDraft: "recover and send", autoSubmitInitialDraft: true }}
        persistenceEnabled={false}
      />,
    )

    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    fireEvent.click(within(screen.getByLabelText("App navigation")).getByRole("button", { name: "New chat" }))
    await waitFor(() => expect(screen.getByTestId("auto-submit-probe")).toHaveAttribute("data-session-id", "canonical-retry"))
    expect(screen.getByTestId("auto-submit-probe")).toHaveAttribute("data-auto-submit", "true")
    expect(screen.getByTestId("auto-submit-probe")).toHaveAttribute("data-initial-draft", "recover and send")
  })

  it("serializes manual and Quick canonical creates", async () => {
    const first = deferred<{ id: string; title: string }>()
    const create = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ id: "quick-created", title: "Quick created" })
    render(
      <WorkspaceAgentFront
        workspaceId="two-canonical-creates"
        workspaceLayout="plugin-tabs"
        chatPanel={AutoSubmitProbe}
        useSessions={() => ({
          sessions: [{ id: "existing", title: "Existing" }],
          loading: false,
          activeSessionId: "existing",
          activeSession: { id: "existing", title: "Existing" },
          switch: vi.fn(),
          create,
          delete: vi.fn(),
        })}
        persistenceEnabled={false}
      />,
    )

    fireEvent.click(within(screen.getByLabelText("App navigation")).getByRole("button", { name: "New chat" }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    fireEvent.click(within(screen.getByLabelText("App navigation")).getByRole("button", { name: "Quick chat" }))
    expect(create).toHaveBeenCalledOnce()

    act(() => first.resolve({ id: "manual-created", title: "Manual created" }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getAllByTestId("auto-submit-probe").some((probe) => (
      probe.getAttribute("data-session-id") === "quick-created"
    ))).toBe(true))
  })

  it("keeps Quick chat outside failed auto-submit recovery and preserves the created addressed owner", async () => {
    const switchSession = vi.fn()
    const create = vi.fn()
      .mockRejectedValueOnce(new Error("automatic create failed"))
      .mockResolvedValueOnce({ id: "collision", agentTypeId: "alpha", title: "Quick alpha collision" })
    const sessions = [
      { id: "collision", agentTypeId: "alpha", title: "Alpha collision" },
      { id: "collision", agentTypeId: "beta", title: "Beta collision" },
    ]

    render(
      <WorkspaceAgentFront
        workspaceId="quick-chat-owner-fallback"
        workspaceLayout="plugin-tabs"
        chatPanel={AutoSubmitProbe}
        useSessions={() => ({
          sessions,
          loading: false,
          activeSessionId: "collision",
          activeSessionAgentTypeId: "beta",
          activeSession: sessions[1],
          switch: switchSession,
          create,
          delete: vi.fn(),
        })}
        chatParams={{ initialDraft: "must stay in main", autoSubmitInitialDraft: true }}
        persistenceEnabled={false}
      />,
    )

    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    fireEvent.click(within(screen.getByLabelText("App navigation")).getByRole("button", { name: "Quick chat" }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getAllByTestId("auto-submit-probe").some((probe) => (
      probe.getAttribute("data-session-id") === "collision"
      && probe.getAttribute("data-agent-type-id") === "alpha"
    ))).toBe(true))

    expect(switchSession).toHaveBeenCalledWith("collision", "beta")
    const quickProbe = screen.getAllByTestId("auto-submit-probe").find((probe) => (
      probe.getAttribute("data-session-id") === "collision"
      && probe.getAttribute("data-agent-type-id") === "alpha"
    ))
    expect(quickProbe).toHaveAttribute("data-auto-submit", "false")
    expect(quickProbe).toHaveAttribute("data-initial-draft", "")
    expect(screen.getAllByTestId("auto-submit-probe").filter((probe) => probe.getAttribute("data-auto-submit") === "true")).toHaveLength(0)
  })

  it("opens Quick chat from its returned canonical owner despite colliding inventory", async () => {
    const switchSession = vi.fn()
    const sessions = [
      { id: "unrelated", agentTypeId: "alpha", title: "Unrelated" },
      { id: "collision", agentTypeId: "beta", title: "Existing beta" },
    ]
    render(
      <WorkspaceAgentFront
        workspaceId="quick-canonical-collision"
        workspaceLayout="plugin-tabs"
        chatPanel={AutoSubmitProbe}
        useSessions={() => ({
          sessions,
          loading: false,
          activeSessionId: "collision",
          activeSessionAgentTypeId: "beta",
          activeSession: sessions[1],
          switch: switchSession,
          create: () => ({ id: "collision", agentTypeId: "alpha", title: "Created alpha" }),
          delete: vi.fn(),
        })}
        persistenceEnabled={false}
      />,
    )

    fireEvent.click(within(screen.getByLabelText("App navigation")).getByRole("button", { name: "Quick chat" }))
    await waitFor(() => expect(screen.getAllByTestId("auto-submit-probe").some((probe) => (
      probe.getAttribute("data-session-id") === "collision"
      && probe.getAttribute("data-agent-type-id") === "alpha"
    ))).toBe(true))
    expect(switchSession).toHaveBeenCalledWith("collision", "beta")
  })

  it.each([
    ["synchronous throw", () => { throw new Error("persistent auto-submit create failure") }],
    ["rejected promise", () => Promise.reject(new Error("persistent auto-submit create failure"))],
  ])("bounds a persistent %s and retries only on user action or source reset", async (_label, failCreate) => {
    let capturedChatProps: CapturedChatPanelProps | undefined
    const createSession = vi.fn(failCreate)

    function Harness() {
      const [agentTypeId, setAgentTypeId] = useState("alpha")
      const [, setUnrelated] = useState(0)
      return (
        <>
          <button type="button" onClick={() => setUnrelated((value) => value + 1)}>Unrelated rerender</button>
          <button type="button" onClick={() => setAgentTypeId("beta")}>Reset source</button>
          <WorkspaceAgentFront
            workspaceId="bounded-auth-return-create"
            agentTypeId={agentTypeId}
            workspaceLayout="plugin-tabs"
            chatPanel={(props) => {
              capturedChatProps = props as CapturedChatPanelProps
              return <div>Captured failed auto-submit</div>
            }}
            useSessions={() => ({
              sessions: [{ id: "existing", title: "Existing" }],
              loading: false,
              activeSessionId: "existing",
              activeSession: { id: "existing", title: "Existing" },
              switch: vi.fn(),
              create: createSession,
              delete: vi.fn(),
            })}
            chatParams={{ initialDraft: "send once", autoSubmitInitialDraft: true }}
            persistenceEnabled={false}
          />
        </>
      )
    }

    render(<Harness />)

    await waitFor(() => expect(createSession).toHaveBeenCalledOnce())
    expect(capturedChatProps?.initialDraft).toBeUndefined()
    expect(capturedChatProps?.autoSubmitInitialDraft).toBe(false)

    fireEvent.click(screen.getByRole("button", { name: "Unrelated rerender" }))
    fireEvent.click(screen.getByRole("button", { name: "Unrelated rerender" }))
    await act(async () => { await Promise.resolve() })
    expect(createSession).toHaveBeenCalledOnce()

    fireEvent.click(within(screen.getByLabelText("App navigation")).getByRole("button", { name: "New chat" }))
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole("button", { name: "Unrelated rerender" }))
    await act(async () => { await Promise.resolve() })
    expect(createSession).toHaveBeenCalledTimes(2)
    expect(capturedChatProps?.initialDraft).toBeUndefined()

    fireEvent.click(screen.getByRole("button", { name: "Reset source" }))
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(3))
    await act(async () => { await Promise.resolve() })
    expect(createSession).toHaveBeenCalledTimes(3)
    expect(capturedChatProps?.initialDraft).toBeUndefined()
  })

  it("restores normal session selection and hydration when failed auto-submit props clear", async () => {
    let capturedChatProps: CapturedChatPanelProps | undefined
    const create = vi.fn(() => Promise.reject(new Error("fresh session failed")))
    const useSessions = () => ({
      sessions: [{ id: "sess-existing", title: "Existing" }],
      loading: false,
      error: undefined,
      activeSessionId: "sess-existing",
      activeSession: { id: "sess-existing", title: "Existing" },
      switch: vi.fn(),
      create,
      delete: vi.fn(),
    })
    const renderFront = (chatParams: Record<string, unknown>) => (
      <WorkspaceAgentFront
        workspaceId="auth-return-failure-clear"
        chatPanel={(props) => {
          capturedChatProps = props as CapturedChatPanelProps
          return <div>Captured chat panel</div>
        }}
        useSessions={useSessions}
        chatParams={chatParams}
        persistenceEnabled={false}
      />
    )

    const view = render(renderFront({ initialDraft: "restore and send", autoSubmitInitialDraft: true }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(capturedChatProps?.sessionId).toBe("default")
    expect(capturedChatProps?.hydrateMessages).toBe(false)

    view.rerender(renderFront({}))

    await waitFor(() => expect(capturedChatProps).toEqual(expect.objectContaining({
      sessionId: "sess-existing",
      hydrateMessages: true,
    })))
    expect(create).toHaveBeenCalledOnce()
  })

  it("resets warmup synchronously on workspace switch before chat hydration", async () => {
    let resolveWorkspaceBTree: ((response: Response) => void) | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const headers = init?.headers as Record<string, string> | undefined
      const workspaceId = headers?.["x-boring-workspace-id"]
      if (url.includes("/api/v1/tree") && workspaceId === "workspace-b") {
        return new Promise<Response>((resolve) => { resolveWorkspaceBTree = resolve })
      }
      if (url.includes("/api/v1/tree")) return new Response(JSON.stringify({ entries: [] }), { status: 200 })
      if (url.includes("/api/v1/agent/pi-chat/sessions")) return new Response(JSON.stringify([{ id: `session-${workspaceId ?? "unknown"}`, title: "Session" }]), { status: 200 })
      if (url.includes("/api/v1/ready-status")) return new Response(null, { status: 200 })
      if (url.includes("/api/v1/agent/models")) return new Response(JSON.stringify({ models: [] }), { status: 200 })
      if (url.includes("/api/v1/agent/skills")) return new Response(JSON.stringify({ skills: [] }), { status: 200 })
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const { rerender } = render(
      <WorkspaceAgentFront
        workspaceId="workspace-a"
        requestHeaders={{ "x-boring-workspace-id": "workspace-a" }}
        persistenceEnabled={false}
      />,
    )

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/agent/pi-chat/sessions"))).toBe(true)
    })
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/agent/pi-chat/session-workspace-a/state"))).toBe(true)
    })
    fetchMock.mockClear()

    rerender(
      <WorkspaceAgentFront
        workspaceId="workspace-b"
        requestHeaders={{ "x-boring-workspace-id": "workspace-b" }}
        persistenceEnabled={false}
      />,
    )

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/tree"))).toBe(true)
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/agent/pi-chat/sessions"))).toBe(true)
    })
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/agent/pi-chat/session-workspace-b/state"))).toBe(true)
    })
    expect(fetchMock.mock.calls.some(([input, init]) => {
      const headers = init?.headers as Record<string, string> | undefined
      return String(input).includes("/api/v1/agent/pi-chat/session-workspace-a/state") && headers?.["x-boring-workspace-id"] === "workspace-b"
    })).toBe(false)
    resolveWorkspaceBTree?.(new Response(JSON.stringify({ entries: [] }), { status: 200 }))
  })

  it("does not deadlock when workspaces share the same pi session id", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const headers = init?.headers as Record<string, string> | undefined
      const workspaceId = headers?.["x-boring-workspace-id"]
      if (url.includes("/api/v1/tree")) return new Response(JSON.stringify({ entries: [] }), { status: 200 })
      if (url.includes("/api/v1/agent/pi-chat/sessions")) {
        return new Response(JSON.stringify([{ id: "default", title: `Session ${workspaceId}` }]), { status: 200 })
      }
      if (url.includes("/api/v1/ready-status")) return new Response(null, { status: 200 })
      if (url.includes("/api/v1/agent/models")) return new Response(JSON.stringify({ models: [] }), { status: 200 })
      if (url.includes("/api/v1/agent/skills")) return new Response(JSON.stringify({ skills: [] }), { status: 200 })
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const { rerender } = render(
      <WorkspaceAgentFront
        workspaceId="workspace-a"
        requestHeaders={{ "x-boring-workspace-id": "workspace-a" }}
        persistenceEnabled={false}
      />,
    )

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input, init]) => {
        const headers = init?.headers as Record<string, string> | undefined
        return String(input).includes("/api/v1/agent/pi-chat/default/state") && headers?.["x-boring-workspace-id"] === "workspace-a"
      })).toBe(true)
    })
    fetchMock.mockClear()

    rerender(
      <WorkspaceAgentFront
        workspaceId="workspace-b"
        requestHeaders={{ "x-boring-workspace-id": "workspace-b" }}
        persistenceEnabled={false}
      />,
    )

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input, init]) => {
        const headers = init?.headers as Record<string, string> | undefined
        return String(input).includes("/api/v1/agent/pi-chat/default/state") && headers?.["x-boring-workspace-id"] === "workspace-b"
      })).toBe(true)
    })
    expect(screen.queryByText("Loading sessions…")).not.toBeInTheDocument()
  })

  it("uses the workspace's persisted active chat while session list refreshes", async () => {
    localStorage.setItem("boring-workspace:sessions:workspace-b", "persisted-workspace-b")
    let workspaceBLoading = true
    const useSessions = ({ requestHeaders }: { requestHeaders: Record<string, string> }) => {
      const workspaceId = requestHeaders["x-boring-workspace-id"]
      if (workspaceId === "workspace-b" && workspaceBLoading) {
        const staleWorkspaceASession = { id: "session-workspace-a", title: "Stale workspace A" }
        return {
          sessions: [staleWorkspaceASession],
          loading: true,
          activeSessionId: staleWorkspaceASession.id,
          activeSession: staleWorkspaceASession,
          switch: vi.fn(),
          create: vi.fn(),
          delete: vi.fn(),
        }
      }
      const session = { id: `session-${workspaceId}`, title: `Session ${workspaceId}` }
      return {
        sessions: [session],
        loading: false,
        activeSessionId: session.id,
        activeSession: session,
        switch: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      }
    }
    const SessionChatPanel = (props: WorkspaceChatPanelProps) => <div>Chat session {props.sessionId}</div>

    const { rerender } = render(
      <WorkspaceAgentFront
        workspaceId="workspace-a"
        requestHeaders={{ "x-boring-workspace-id": "workspace-a" }}
        chatPanel={SessionChatPanel}
        useSessions={useSessions}
        persistenceEnabled={false}
      />,
    )

    expect(await screen.findByText("Chat session session-workspace-a")).toBeInTheDocument()

    rerender(
      <WorkspaceAgentFront
        workspaceId="workspace-b"
        requestHeaders={{ "x-boring-workspace-id": "workspace-b" }}
        chatPanel={SessionChatPanel}
        useSessions={useSessions}
        persistenceEnabled={false}
      />,
    )

    expect(screen.getByText("Chat session persisted-workspace-b")).toBeInTheDocument()
    expect(screen.queryByText("No sessions yet.")).not.toBeInTheDocument()
    expect(screen.queryByText("Stale workspace A")).not.toBeInTheDocument()

    workspaceBLoading = false
    rerender(
      <WorkspaceAgentFront
        workspaceId="workspace-b"
        requestHeaders={{ "x-boring-workspace-id": "workspace-b" }}
        chatPanel={SessionChatPanel}
        useSessions={useSessions}
        persistenceEnabled={false}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText("Chat session session-workspace-b")).toBeInTheDocument()
    })
  })

  it("does not expose stale sessions when session refresh fails after workspace switch", async () => {
    let resolveWorkspaceBTree: ((response: Response) => void) | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const headers = init?.headers as Record<string, string> | undefined
      const workspaceId = headers?.["x-boring-workspace-id"]
      if (url.includes("/api/v1/tree") && workspaceId === "workspace-b") {
        return new Promise<Response>((resolve) => { resolveWorkspaceBTree = resolve })
      }
      if (url.includes("/api/v1/tree")) return new Response(JSON.stringify({ entries: [] }), { status: 200 })
      if (url.includes("/api/v1/agent/pi-chat/sessions") && workspaceId === "workspace-b") return new Response(JSON.stringify({ message: "nope" }), { status: 500 })
      if (url.includes("/api/v1/agent/pi-chat/sessions")) return new Response(JSON.stringify([{ id: "session-workspace-a", title: "A" }]), { status: 200 })
      return new Response(JSON.stringify([]), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const { rerender } = render(
      <WorkspaceAgentFront workspaceId="workspace-a" persistenceEnabled={false} />,
    )
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/agent/pi-chat/session-workspace-a/state"))).toBe(true)
    })
    fetchMock.mockClear()

    rerender(<WorkspaceAgentFront workspaceId="workspace-b" persistenceEnabled={false} />)
    resolveWorkspaceBTree?.(new Response(JSON.stringify({ entries: [] }), { status: 200 }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/agent/pi-chat/sessions"))).toBe(true)
    })
    expect(fetchMock.mock.calls.some(([input, init]) => {
      const headers = init?.headers as Record<string, string> | undefined
      return String(input).includes("/api/v1/agent/pi-chat/session-workspace-a/state") && headers?.["x-boring-workspace-id"] === "workspace-b"
    })).toBe(false)
  })

  it("forwards plugin tool renderers into the agent chat panel", async () => {
    let capturedChatProps: WorkspaceChatPanelProps | undefined
    const toolRenderer = vi.fn(() => <span>Rendered tool</span>)
    const plugin = definePlugin({
      id: "tool-renderer-plugin",
      label: "Tool Renderer Plugin",
      setup(api) {
        api.registerToolRenderer({ id: "plugin-tool", render: toolRenderer })
      },
    })

    const CapturingChatPanel = (props: WorkspaceChatPanelProps) => {
      capturedChatProps = props
      return <div>Captured chat panel</div>
    }

    render(
      <WorkspaceAgentFront
        workspaceId="tool-renderer-workspace"
        chatPanel={CapturingChatPanel}
        plugins={[plugin]}
        persistenceEnabled={false}
      />,
    )

    await waitFor(() => {
      expect(capturedChatProps?.toolRenderers).toMatchObject({ "plugin-tool": toolRenderer })
    })
  })

  it("opens the workbench when the embedded agent asks to open an artifact", async () => {
    const user = userEvent.setup()

    render(
      <WorkspaceAgentFront
        workspaceId="artifact-workspace"
        chatPanel={ChatPanel}
        persistenceEnabled={false}
      />,
    )

    expect(screen.queryByLabelText("Surface")).not.toBeInTheDocument()
    await user.click(await screen.findByRole("button", { name: "Open artifact" }))

    await waitFor(() => {
      expect(screen.getByLabelText("Surface")).toHaveAttribute("aria-hidden", "false")
    })
  })

  it("loads the target chat session before opening a session-bound surface", async () => {
    const onSwitchSession = vi.fn()
    render(
      <WorkspaceAgentFront
        workspaceId="session-gated-surface"
        chatPanel={SessionIdChatPanel}
        sessions={[
          { id: "s1", title: "Open", updatedAt: new Date(0).toISOString(), turnCount: 0 },
          { id: "s2", title: "Closed", updatedAt: new Date(0).toISOString(), turnCount: 0 },
        ]}
        activeSessionId="s1"
        onSwitchSession={onSwitchSession}
        persistenceEnabled={false}
      />,
    )

    await screen.findByText("Chat pane s1")
    expect(screen.queryByLabelText("Surface")).not.toBeInTheDocument()

    window.dispatchEvent(new CustomEvent(UI_COMMAND_EVENT, {
      detail: {
        kind: "openSurface",
        params: { kind: "questions", target: "q2", meta: { sessionId: "s2", openOnlyWhenSessionOpen: true } },
      } satisfies UiCommand,
    }))

    await waitFor(() => {
      expect(visibleChatSessionIds()).toEqual(["s2"])
      expect(onSwitchSession).toHaveBeenCalledWith("s2")
      expect(screen.getByLabelText("Surface")).toHaveAttribute("aria-hidden", "false")
    })
  })

  it("dispatches browser UI command events into the app surface", async () => {
    render(
      <WorkspaceAgentFront
        workspaceId="global-command-workspace"
        chatPanel={ChatPanel}
        panels={[globalCommandPanel]}
        extraPanels={[globalCommandPanel.id]}
        persistenceEnabled={false}
      />,
    )

    expect(screen.queryByLabelText("Surface")).not.toBeInTheDocument()

    const command: UiCommand = {
      kind: "openPanel",
      params: {
        id: "from-global-command",
        component: globalCommandPanel.id,
        title: "From global command",
      },
    }
    window.dispatchEvent(new CustomEvent(UI_COMMAND_EVENT, { detail: command }))

    await waitFor(() => {
      expect(screen.getByLabelText("Surface")).toHaveAttribute("aria-hidden", "false")
    })
    await waitFor(() => {
      expect(screen.getByText("Global command panel body")).toBeInTheDocument()
    })
  })

  it("does not reuse a stale surface handle after closing the workbench", async () => {
    const user = userEvent.setup()

    render(
      <WorkspaceAgentFront
        workspaceId="stale-surface-workspace"
        chatPanel={ChatPanel}
        panels={[globalCommandPanel]}
        extraPanels={[globalCommandPanel.id]}
        persistenceEnabled={false}
      />,
    )

    window.dispatchEvent(new CustomEvent(UI_COMMAND_EVENT, {
      detail: {
        kind: "openPanel",
        params: {
          id: "before-close",
          component: globalCommandPanel.id,
          title: "Before close",
        },
      } satisfies UiCommand,
    }))

    await waitFor(() => {
      expect(screen.getByText("Global command panel body")).toBeInTheDocument()
    })

    await user.click(screen.getByRole("button", { name: "Close workbench" }))
    await waitFor(() => {
      expect(screen.queryByLabelText("Surface")).not.toBeInTheDocument()
    })

    window.dispatchEvent(new CustomEvent(UI_COMMAND_EVENT, {
      detail: {
        kind: "openPanel",
        params: {
          id: "after-close",
          component: globalCommandPanel.id,
          title: "After close",
        },
      } satisfies UiCommand,
    }))

    await waitFor(() => {
      expect(screen.getByLabelText("Surface")).toHaveAttribute("aria-hidden", "false")
    })
    await waitFor(() => {
      expect(screen.getByText("Global command panel body")).toBeInTheDocument()
    })
  })

  it("keeps an unvalidated persisted addressed pane out of chat and plugin providers", async () => {
    const providerSnapshots: Array<{ activeSessionId?: string | null; openSessionIds?: readonly string[] }> = []
    function SessionProbeProvider({ activeSessionId, openSessionIds, children }: PluginProviderProps) {
      providerSnapshots.push({ activeSessionId, openSessionIds })
      return <>{children}</>
    }
    const probePlugin = definePlugin({
      id: "session-scope-probe",
      setup(api) {
        api.registerProvider({ id: "session-probe", component: SessionProbeProvider })
      },
    })
    localStorage.setItem("boring-workspace:chat-panes:validated-addressed-panes", JSON.stringify({
      version: 2,
      refs: [
        { kind: "addressed", sessionId: "missing", agentTypeId: "alpha" },
        { kind: "addressed", sessionId: "valid", agentTypeId: "alpha" },
      ],
      activeRef: { kind: "addressed", sessionId: "missing", agentTypeId: "alpha" },
    }))
    const validSession = { id: "valid", agentTypeId: "alpha", title: "Valid session", updatedAt: 1 }

    render(
      <WorkspaceAgentFront
        workspaceId="validated-addressed-panes"
        agentTypeId="alpha"
        chatPanel={SessionIdChatPanel}
        plugins={[probePlugin]}
        useSessions={() => ({
          sessions: [validSession],
          activeSession: validSession,
          activeSessionId: validSession.id,
          activeSessionAgentTypeId: validSession.agentTypeId,
          workspaceId: "validated-addressed-panes",
          loading: false,
          hasMore: true,
          create: vi.fn(),
          switch: vi.fn(),
          delete: vi.fn(),
        })}
      />,
    )

    await waitFor(() => expect(visibleChatSessionIds()).toEqual(["valid"]))
    expect(screen.queryByText("Chat pane missing")).not.toBeInTheDocument()
    expect(providerSnapshots.some((snapshot) => (
      snapshot.activeSessionId === "missing" || snapshot.openSessionIds?.includes("missing")
    ))).toBe(false)
    expect(providerSnapshots.at(-1)).toMatchObject({ activeSessionId: "valid", openSessionIds: ["valid"] })
  })

  it("forwards request headers to workspace plugin providers by default", async () => {
    const observed: Array<Record<string, string> | undefined> = []
    function ProbeProvider({ authHeaders, children }: PluginProviderProps) {
      observed.push(authHeaders)
      return <>{children}</>
    }
    const probePlugin = definePlugin({
      id: "request-header-probe",
      setup(api) {
        api.registerProvider({ id: "probe", component: ProbeProvider })
      },
    })

    render(
      <WorkspaceAgentFront
        workspaceId="provider-headers"
        chatPanel={ChatPanel}
        requestHeaders={{ "x-boring-workspace-id": "stale", authorization: "Bearer request-token" }}
        plugins={[probePlugin]}
        persistenceEnabled={false}
      />,
    )

    await waitFor(() => {
      expect(observed).toContainEqual({ "x-boring-workspace-id": "provider-headers", authorization: "Bearer request-token" })
    })
  })

  it("keeps the existing remote session when the user manually creates another chat", async () => {
    const create = vi.fn(async () => ({ id: "manual", title: "New session", updatedAt: Date.now(), turnCount: 0 }))
    const deleted = vi.fn()

    function useSessionsWithAutoDefault() {
      const [sessions, setSessions] = useState([
        { id: "auto", title: "Project", updatedAt: Date.now(), turnCount: 0 },
      ])
      return {
        sessions,
        activeSessionId: sessions[0]?.id ?? null,
        activeSession: sessions[0] ?? null,
        loading: false,
        create: async () => {
          const session = await create()
          setSessions((prev) => [session, ...prev])
          return session
        },
        switch: vi.fn(),
        delete: (id: string) => {
          deleted(id)
          setSessions((prev) => prev.filter((session) => session.id !== id))
        },
      }
    }

    render(
      <WorkspaceAgentFront
        workspaceId="manual-create"
        chatPanel={ChatPanel}
        useSessions={useSessionsWithAutoDefault}
        defaultSessionTitle="Project"
        persistenceEnabled={false}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "New chat" }))

    await waitFor(() => {
      expect(create).toHaveBeenCalledOnce()
    })
    expect(deleted).not.toHaveBeenCalled()
  })

  it("does not pass the New chat click event into remote session creation", async () => {
    const create = vi.fn(async () => ({ id: "manual", title: "Manual", updatedAt: Date.now(), turnCount: 0 }))

    render(
      <WorkspaceAgentFront
        workspaceId="create-click-event"
        chatPanel={ChatPanel}
        useSessions={() => ({
          sessions: [{ id: "existing", title: "Existing", updatedAt: Date.now(), turnCount: 0 }],
          activeSessionId: "existing",
          activeSession: { id: "existing", title: "Existing", updatedAt: Date.now(), turnCount: 0 },
          loading: false,
          create,
          switch: vi.fn(),
          delete: vi.fn(),
        })}
        persistenceEnabled={false}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "New chat" }))

    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(create.mock.calls[0]).toEqual([])
  })

  it("creates a replacement before deleting the last authoritative remote session", async () => {
    const calls: string[] = []
    const createArgs: unknown[] = []
    const deleted = vi.fn()

    function useDeletingSessions() {
      const [sessionIds, setSessionIds] = useState(["only"])
      const create = vi.fn(async (...args: unknown[]) => {
        calls.push("create")
        createArgs.push(args)
        setSessionIds((prev) => ["created", ...prev])
        return { id: "created", title: "Created" }
      })
      const sessions = sessionIds.map((id) => ({ id, title: id === "created" ? "Created" : "Only session", updatedAt: Date.now() }))
      return {
        sessions,
        activeSessionId: sessions[0]?.id ?? null,
        activeSession: sessions[0] ?? null,
        loading: false,
        hasMore: false,
        create,
        switch: vi.fn(),
        delete: (id: string) => {
          calls.push("delete")
          deleted(id)
          setSessionIds((prev) => prev.filter((sessionId) => sessionId !== id))
        },
      }
    }

    render(
      <WorkspaceAgentFront
        workspaceId="delete-last"
        chatPanel={ChatPanel}
        useSessions={useDeletingSessions}
        defaultSessionTitle="New chat"
        persistenceEnabled={false}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Sessions" }))
    fireEvent.click(screen.getByLabelText("Delete Only session"))

    await waitFor(() => expect(calls).toEqual(["create", "delete"]))
    expect(createArgs).toEqual([[{ title: "New chat" }]])
    expect(deleted).toHaveBeenCalledWith("only")
    expect(screen.getAllByText("Created").length).toBeGreaterThan(0)
    expect(screen.queryByText("Only session")).not.toBeInTheDocument()
  })

  it("does not create a replacement when deleting from a non-authoritative paginated remote page", async () => {
    vi.useFakeTimers()
    const create = vi.fn(async () => ({ id: "created", title: "Created" }))
    const deleted = vi.fn()

    function usePaginatedSessions() {
      const [sessionIds, setSessionIds] = useState(["visible"])
      const sessions = sessionIds.map((id) => ({ id, title: "Visible session", updatedAt: Date.now() }))
      return {
        sessions,
        activeSessionId: sessions[0]?.id ?? null,
        activeSession: sessions[0] ?? null,
        loading: false,
        hasMore: true,
        create,
        switch: vi.fn(),
        delete: (id: string) => {
          deleted(id)
          setSessionIds((prev) => prev.filter((sessionId) => sessionId !== id))
        },
      }
    }

    render(
      <WorkspaceAgentFront
        workspaceId="delete-paginated"
        chatPanel={ChatPanel}
        useSessions={usePaginatedSessions}
        persistenceEnabled={false}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Sessions" }))
    fireEvent.click(screen.getByLabelText("Delete Visible session"))

    expect(deleted).toHaveBeenCalledWith("visible")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500)
    })
    expect(create).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it("injects a workspace-owned plugin reload callback into the chat panel", async () => {
    let capturedChatProps: WorkspaceChatPanelProps | undefined
    const reloadEvents: unknown[] = []
    const listener = (event: Event) => reloadEvents.push((event as CustomEvent).detail)
    window.addEventListener(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, listener)
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/api/v1/tree")) return new Response(JSON.stringify({ entries: [] }), { status: 200 })
      if (url.includes("/api/v1/ready-status")) return new Response(null, { status: 200 })
      if (url.endsWith("/api/v1/agent/reload")) {
        expect(init?.method).toBe("POST")
        expect(init?.headers).toMatchObject({ "x-boring-workspace-id": "reload-workspace", "content-type": "application/json" })
        expect(JSON.parse(String(init?.body))).toEqual({ sessionId: "pi-reload" })
        return new Response(JSON.stringify({ reloaded: false, diagnostics: [{ message: "rebuilt plugin front" }] }), { status: 200 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    function ReloadProbe(props: WorkspaceChatPanelProps) {
      capturedChatProps = props
      return <div>Reload probe</div>
    }
    const useSessions = () => ({
      sessions: [{ id: "pi-reload", title: "Pi reload" }],
      loading: false,
      activeSessionId: "pi-reload",
      activeSession: { id: "pi-reload", title: "Pi reload" },
      switch: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    })

    try {
      render(
        <WorkspaceAgentFront
          workspaceId="reload-workspace"
          chatPanel={ReloadProbe}
          useSessions={useSessions}
          requestHeaders={{ "x-boring-workspace-id": "reload-workspace" }}
          apiBaseUrl="/agent"
          persistenceEnabled={false}
        />,
      )

      await waitFor(() => expect(typeof capturedChatProps?.onReloadAgentPlugins).toBe("function"))
      const result = await (capturedChatProps?.onReloadAgentPlugins as () => Promise<{ message: string; reloaded: boolean }>)()
      expect(result).toEqual({
        message: "Extensions will reload on the next message.\n\nWarnings:\nrebuilt plugin front",
        reloaded: false,
      })
      expect(fetchMock).toHaveBeenCalledWith("/agent/api/v1/agent/reload", expect.objectContaining({ method: "POST" }))
      expect(reloadEvents).toContainEqual({ reloaded: false, diagnostics: [{ message: "rebuilt plugin front" }] })
    } finally {
      window.removeEventListener(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, listener)
    }
  })

  it("adds workspace id to request headers when host omits them", async () => {
    const observedProviders: Array<Record<string, string> | undefined> = []
    const observedSessions: Array<Record<string, string>> = []
    function ProbeProvider({ authHeaders, children }: PluginProviderProps) {
      observedProviders.push(authHeaders)
      return <>{children}</>
    }
    const probePlugin = definePlugin({
      id: "implicit-header-probe",
      setup(api) {
        api.registerProvider({ id: "probe", component: ProbeProvider })
      },
    })

    render(
      <WorkspaceAgentFront
        workspaceId="implicit-scope"
        chatPanel={ChatPanel}
        useSessions={({ requestHeaders }) => {
          observedSessions.push(requestHeaders)
          return { sessions: [], loading: false, create: vi.fn(), switch: vi.fn(), delete: vi.fn() }
        }}
        plugins={[probePlugin]}
        persistenceEnabled={false}
      />,
    )

    await waitFor(() => {
      expect(observedProviders).toContainEqual({ "x-boring-workspace-id": "implicit-scope" })
    })
    expect(observedSessions).toContainEqual({ "x-boring-workspace-id": "implicit-scope" })
  })

  it("pushes current shell state to the UI bridge state endpoint", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/api/v1/ui/commands/next")) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <WorkspaceAgentFront
        workspaceId="ui-state"
        chatPanel={ChatPanel}
        requestHeaders={{ "x-boring-workspace-id": "ui-state" }}
      />,
    )

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/v1/ui/state")),
      ).toBe(true)
    })

    const stateCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/api/v1/ui/state"),
    )
    if (!stateCall?.[1]) {
      throw new Error("Expected UI state PUT call to include RequestInit")
    }
    const init = stateCall[1]
    const body = JSON.parse(String(init.body)) as {
      state: {
        drawerOpen: boolean
        workbenchOpen: boolean
        openTabs: unknown[]
        activeTab: string | null
        activeFile: string | null
        availablePanels: string[]
        availableSurfaces: Array<{ id: string; kind: string; title?: string }>
      }
      causedBy: string
    }

    expect(init.method).toBe("PUT")
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "x-boring-workspace-id": "ui-state",
    })
    expect(body.causedBy).toBe("user")
    expect(body.state).toMatchObject({
      drawerOpen: false,
      workbenchOpen: false,
      openTabs: [],
      activeTab: null,
      activeFile: null,
    })
    expect(body.state.availablePanels).toEqual(
      expect.arrayContaining(["chat", "artifact-surface"]),
    )
    expect(body.state.availableSurfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "filesystem-path", kind: "workspace.open.path" }),
      ]),
    )
  })

  it("cancels pending session-scoped attention when switching sessions", async () => {
    const user = userEvent.setup()
    const onSwitchSession = vi.fn()
    const observed = vi.fn()
    window.addEventListener("boring:workspace-composer-stop", observed)

    render(
      <WorkspaceAgentFront
        workspaceId="switch-cancel"
        chatPanel={ChatPanel}
        sessions={[{ id: "s1", title: "Session one" }, { id: "s2", title: "Session two" }]}
        activeSessionId="s1"
        onSwitchSession={onSwitchSession}
        persistenceEnabled={false}
      />,
    )

    expandHistory()
    await user.click(screen.getByText("Session two"))
    expect(onSwitchSession).toHaveBeenCalledWith("s2")
    expect(observed).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ sessionId: "s1", reason: "session-switch" }) }))

    window.removeEventListener("boring:workspace-composer-stop", observed)
  })

  it("recovers the session chat after transient cold-start 503s without any remount", async () => {
    // Reproduces the "empty chat after page reload until you switch workspace
    // away and back" bug. On a fresh load the sessions GET returns 503 ("Agent
    // runtime is still preparing") for the first few calls during warmup. The
    // pre-fix useSessions latched that 503 into a terminal error and rendered an
    // empty chat (default "New session" title, no loaded session) with no retry,
    // so chat stayed empty until a full remount (only a workspace switch did
    // that, via key={activeWorkspace.id}). The fix retries transient 503s with
    // backoff while staying in loading state. This test mounts ONCE — no
    // remount, no key change, no workspace switch — and asserts the real session
    // loaded from the eventual 200 shows up.
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/api/v1/tree")) return new Response(JSON.stringify({ entries: [] }), { status: 200 })
      if (url.includes("/api/v1/agent/pi-chat/sessions")) {
        const method = init?.method ?? "GET"
        if (method === "GET" && sessionsFailuresRemaining > 0) {
          sessionsFailuresRemaining -= 1
          return new Response(null, { status: 503 })
        }
        if (method === "GET") return new Response(JSON.stringify([{ id: "s1", title: "Existing" }]), { status: 200 })
      }
      if (url.includes("/api/v1/ready-status")) return new Response(null, { status: 200 })
      if (url.includes("/api/v1/agent/pi-chat/") && url.includes("/state")) return new Response(JSON.stringify({ protocolVersion: 1, sessionId: "existing", seq: 0, status: "idle", messages: [], queue: { followUps: [] }, followUpMode: "one-at-a-time" }), { status: 200 })
      if (url.includes("/api/v1/ui/commands/next")) return new Response(JSON.stringify([]), { status: 200 })
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal("fetch", fetchMock)
    // First two cold-start session GETs fail with 503 (backoff ~0.25s + ~0.5s),
    // then the third returns the existing session. Kept to 2 so total real-timer
    // backoff stays sub-second.
    sessionsFailuresRemaining = 2

    const user = userEvent.setup()
    render(
      <WorkspaceAgentFront
        workspaceId="cold-start-503"
        requestHeaders={{ "x-boring-workspace-id": "cold-start-503" }}
        persistenceEnabled={false}
      />,
    )

    // The existing session must surface after the retries succeed — proving the
    // chat recovered on the same mount. Open the session browser and assert the
    // real session is shown (it appears as both the TopBar session title and the
    // session-browser row). Against the pre-fix latched-error behavior the chat
    // stays empty: the TopBar shows the "New session" fallback and no row exists,
    // so zero "Existing" elements are found and this fails.
    await user.click(await screen.findByRole("button", { name: "Sessions" }, { timeout: 4000 }))
    await waitFor(() => {
      expect(screen.getAllByText("Existing").length).toBeGreaterThan(0)
    }, { timeout: 4000 })

    // And the chat must NOT have given up by auto-creating a brand-new empty
    // session as if none existed (no POST to the sessions endpoint).
    expect(fetchMock.mock.calls.some(([input, init]) =>
      String(input).includes("/api/v1/agent/pi-chat/sessions") && (init?.method ?? "GET") === "POST",
    )).toBe(false)
  })

  it("releases initial auto-create state after a synchronous custom failure so New chat can retry", async () => {
    const createSession = vi.fn()
      .mockImplementationOnce(() => { throw new Error("sync initial create failed") })
      .mockResolvedValueOnce({ id: "retried-initial", title: "Retried initial" })

    render(
      <WorkspaceAgentFront
        workspaceId="sync-initial-create-retry"
        workspaceLayout="plugin-tabs"
        chatPanel={SessionIdChatPanel}
        useSessions={() => ({
          sessions: [],
          loading: false,
          activeSessionId: null,
          resumeSessionId: "hidden-empty",
          activeSession: null,
          switch: vi.fn(),
          create: createSession,
          delete: vi.fn(),
        })}
        persistenceEnabled={false}
      />,
    )

    await waitFor(() => expect(createSession).toHaveBeenCalledOnce())
    fireEvent.click(await screen.findByRole("button", { name: "New chat" }))
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(2))
  })

  it("creates the first remote session when a sessions hook loads empty", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)
    const createSession = vi.fn()

    render(
      <WorkspaceAgentFront
        workspaceId="remote-sessions"
        chatPanel={ChatPanel}
        defaultSessionTitle="Fresh session"
        useSessions={() => ({
          sessions: [],
          loading: false,
          activeSessionId: null,
          activeSession: null,
          switch: vi.fn(),
          create: createSession,
          delete: vi.fn(),
        })}
      />,
    )

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith({ title: "Fresh session" })
    }, { timeout: 3000 })
  })

  it("passes the exact hidden addressed id only to boot creation", async () => {
    const createSession = vi.fn()

    render(
      <WorkspaceAgentFront
        workspaceId="remote-resume"
        agentTypeId="alpha"
        chatPanel={ChatPanel}
        defaultSessionTitle="Fresh session"
        useSessions={() => ({
          sessions: [],
          loading: false,
          activeSessionId: null,
          resumeSessionId: "persisted-hidden-empty",
          activeSession: null,
          switch: vi.fn(),
          create: createSession,
          delete: vi.fn(),
        })}
      />,
    )

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith({
        title: "Fresh session",
        resumeSessionId: "persisted-hidden-empty",
      })
    }, { timeout: 3000 })
  })

  it("connects the first auto-created empty remote session after the transition", async () => {
    const captured: CapturedChatPanelProps[] = []
    const CapturingChatPanel = (props: WorkspaceChatPanelProps) => {
      captured.push(props)
      return <div data-testid="chat-panel">Chat {props.sessionId} hydrate={String(props.hydrateMessages)}</div>
    }

    function useInitiallyEmptySessions() {
      const [created, setCreated] = useState<TSessionLike | null>(null)
      return {
        sessions: created ? [created] : [],
        loading: false,
        activeSessionId: created?.id ?? null,
        activeSession: created,
        switch: vi.fn(),
        create: vi.fn(async () => {
          const session = {
            id: "created-empty-session",
            title: "Fresh session",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            turnCount: 0,
          }
          setCreated(session)
          return session
        }),
        delete: vi.fn(),
      }
    }

    type TSessionLike = {
      id: string
      title: string
      createdAt: string
      updatedAt: string
      turnCount: number
    }

    render(
      <WorkspaceAgentFront<TSessionLike>
        workspaceId="remote-empty-session-stable"
        chatPanel={CapturingChatPanel}
        defaultSessionTitle="Fresh session"
        useSessions={useInitiallyEmptySessions}
      />,
    )

    expect(screen.queryByTestId("chat-panel")).toBeNull()
    await waitFor(() => expect(screen.getByTestId("chat-panel").textContent).toContain("created-empty-session"), { timeout: 3000 })

    expect(captured.some((props) => props.sessionId === "default")).toBe(false)
    expect(captured.at(-1)?.hydrateMessages).toBe(true)
    expect(captured.at(-1)?.allowPromptDuringInitialHydration).toBe(true)
  })
})
