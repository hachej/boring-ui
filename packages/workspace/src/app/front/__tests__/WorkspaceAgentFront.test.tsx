import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { useEffect, useState } from "react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT } from "../../../front/agentPlugins/reloadEvent"
import { UI_COMMAND_EVENT, type UiCommand } from "../../../front/bridge"
import type { WorkspaceChatPanelProps } from "../../../front/chrome/chat/types"
import type { PanelConfig } from "../../../front/registry/types"
import { definePlugin } from "../../../shared/plugins/frontFactory"
import type { PluginProviderProps } from "../../../shared/plugins/types"
import { WorkspaceAgentFront, type UseWorkspaceAgentSessions } from "../WorkspaceAgentFront"

type CapturedChatPanelProps = WorkspaceChatPanelProps & {
  initialDraft?: string
  autoSubmitInitialDraft?: boolean
  hydrateMessages?: boolean
  allowPromptDuringInitialHydration?: boolean
  onAutoSubmitInitialDraftSettled?: () => void
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

  it("renders the chat shell when remote sessions fail instead of pinning loading", () => {
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

    expect(screen.getByTestId("chat-panel")).toHaveTextContent("Chat default hydrate=false")
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

  it("drives remote session plumbing from the dynamically selected agent without touching legacy routes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/v1/agents")) {
        return new Response(JSON.stringify([
          { agentTypeId: "alpha", label: "Alpha" },
          { agentTypeId: "beta", label: "Beta" },
        ]), { status: 200 })
      }
      if (url.includes("/api/v1/tree")) return new Response(JSON.stringify({ entries: [] }), { status: 200 })
      if (url.includes("/api/v1/ready-status")) return new Response(null, { status: 200 })
      if (url.includes("/api/v1/agent-plugins")) return new Response(JSON.stringify([]), { status: 200 })
      if (url.includes("/api/v1/ui/commands/next")) return new Response(JSON.stringify([]), { status: 200 })
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal("fetch", fetchMock)
    let selectAgent!: (agentTypeId: string) => void
    function useTestAgentSelection({ enabled }: { enabled?: boolean }) {
      const [selectedAgentTypeId, setSelectedAgentTypeId] = useState<string>()
      selectAgent = setSelectedAgentTypeId
      useEffect(() => {
        if (!enabled) return
        let cancelled = false
        void fetch("/api/v1/agents").then((response) => response.json()).then((agents: Array<{ agentTypeId: string }>) => {
          if (!cancelled) setSelectedAgentTypeId(agents[0]?.agentTypeId)
        })
        return () => {
          cancelled = true
        }
      }, [enabled])
      return {
        agents: [
          { agentTypeId: "alpha", label: "Alpha" },
          { agentTypeId: "beta", label: "Beta" },
        ],
        selectedAgentTypeId,
        loading: Boolean(enabled && !selectedAgentTypeId),
        error: undefined,
        selectAgentTypeId: setSelectedAgentTypeId,
      }
    }
    const sessionHookCalls: Array<{ agentTypeId?: string; enabled?: boolean }> = []
    const useSessions: UseWorkspaceAgentSessions = (options) => {
      sessionHookCalls.push({ agentTypeId: options.agentTypeId, enabled: options.enabled })
      const owner = options.agentTypeId
      const session = owner ? { id: "shared", agentTypeId: owner, title: `${owner} shared` } : undefined
      return {
        sessions: session ? [session] : [],
        sourceAgentTypeId: owner,
        loading: false,
        activeSessionId: session?.id ?? null,
        activeSessionAgentTypeId: owner ?? null,
        activeSession: session ?? null,
        workspaceId: options.workspaceId,
        switch: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      }
    }
    function AgentControlledChatPanel(props: WorkspaceChatPanelProps) {
      return <div data-testid="selected-agent-session">{props.agentTypeId}/{props.sessionId}</div>
    }

    render(
      <WorkspaceAgentFront
        workspaceId="dynamic-agent-sessions"
        chatPanel={AgentControlledChatPanel}
        useSessions={useSessions}
        addressedAgentSelection
        useAddressedAgentSelection={useTestAgentSelection}
        persistenceEnabled={false}
      />,
    )

    await waitFor(() => expect(screen.getByTestId("selected-agent-session")).toHaveTextContent("alpha/shared"))
    expect(sessionHookCalls).toContainEqual({ agentTypeId: undefined, enabled: false })
    expect(sessionHookCalls).toContainEqual({ agentTypeId: "alpha", enabled: true })

    act(() => selectAgent("beta"))

    await waitFor(() => expect(screen.getByTestId("selected-agent-session")).toHaveTextContent("beta/shared"))
    expect(sessionHookCalls).toContainEqual({ agentTypeId: "beta", enabled: true })
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/api/v1/agents"))).toHaveLength(1)
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/agent/pi-chat/"))).toBe(false)
  })

  it("accepts source-less custom sessions for an explicit addressed agent", async () => {
    const requestedAgentTypeIds: Array<string | undefined> = []
    const useSessions: UseWorkspaceAgentSessions = (options) => {
      requestedAgentTypeIds.push(options.agentTypeId)
      const session = { id: "custom-session", title: "Custom session" }
      return {
        sessions: [session],
        loading: false,
        activeSessionId: session.id,
        activeSession: session,
        workspaceId: options.workspaceId,
        switch: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      }
    }
    function AddressedSessionProbe(props: WorkspaceChatPanelProps) {
      return <div data-testid="explicit-addressed-session">{props.agentTypeId}/{props.sessionId}</div>
    }

    render(
      <WorkspaceAgentFront
        workspaceId="explicit-custom-agent"
        agentTypeId="custom-agent"
        chatPanel={AddressedSessionProbe}
        useSessions={useSessions}
        persistenceEnabled={false}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId("explicit-addressed-session")).toHaveTextContent("custom-agent/custom-session")
    })
    expect(requestedAgentTypeIds).toContain("custom-agent")
  })

  it("keeps each addressed agent active session and mounted chat state while switching agents", async () => {
    const user = userEvent.setup()
    function useTestAgentSelection() {
      const [selectedAgentTypeId, setSelectedAgentTypeId] = useState("alpha")
      return {
        agents: [
          { agentTypeId: "alpha", label: "Alpha" },
          { agentTypeId: "beta", label: "Beta" },
        ],
        selectedAgentTypeId,
        loading: false,
        error: undefined,
        selectAgentTypeId: setSelectedAgentTypeId,
      }
    }
    const useSessions: UseWorkspaceAgentSessions = (options) => {
      const [activeByAgent, setActiveByAgent] = useState<Record<string, string>>({
        alpha: "a1",
        beta: "b1",
      })
      const owner = options.agentTypeId ?? "alpha"
      const agentSessions = owner === "alpha"
        ? [
            { id: "a1", agentTypeId: owner, title: "Alpha one" },
            { id: "a2", agentTypeId: owner, title: "Alpha two" },
          ]
        : [
            { id: "b1", agentTypeId: owner, title: "Beta one" },
            { id: "b2", agentTypeId: owner, title: "Beta two" },
          ]
      const activeSessionId = activeByAgent[owner]
      return {
        sessions: agentSessions,
        sourceAgentTypeId: owner,
        loading: false,
        activeSessionId,
        activeSessionAgentTypeId: owner,
        activeSession: agentSessions.find((session) => session.id === activeSessionId) ?? null,
        workspaceId: options.workspaceId,
        switch: (id) => setActiveByAgent((current) => ({ ...current, [owner]: id })),
        create: vi.fn(),
        delete: vi.fn(),
      }
    }
    const unmounted: string[] = []
    function StatefulAgentChat(props: WorkspaceChatPanelProps) {
      const identity = `${props.agentTypeId}/${props.sessionId}`
      useEffect(() => () => {
        unmounted.push(identity)
      }, [identity])
      return <div data-testid={`agent-chat-${props.agentTypeId}-${props.sessionId}`}>{identity}</div>
    }

    render(
      <WorkspaceAgentFront
        workspaceId="per-agent-active-session"
        workspaceLayout="plugin-tabs"
        chatPanel={StatefulAgentChat}
        useSessions={useSessions}
        addressedAgentSelection
        useAddressedAgentSelection={useTestAgentSelection}
        persistenceEnabled={false}
      />,
    )

    await waitFor(() => expect(screen.getByTestId("agent-chat-alpha-a1")).toBeInTheDocument())
    await user.click(screen.getByText("Alpha two"))
    await waitFor(() => expect(screen.getByTestId("agent-chat-alpha-a2")).toBeInTheDocument())

    await user.selectOptions(screen.getByRole("combobox", { name: "Agent" }), "beta")
    await waitFor(() => expect(screen.getByTestId("agent-chat-beta-b1")).toBeInTheDocument())
    expect(screen.getByTestId("agent-chat-alpha-a2")).toBeInTheDocument()
    expect(unmounted).not.toContain("alpha/a2")

    await user.click(screen.getByText("Beta two"))
    await waitFor(() => expect(screen.getByTestId("agent-chat-beta-b2")).toBeInTheDocument())
    await user.selectOptions(screen.getByRole("combobox", { name: "Agent" }), "alpha")

    await waitFor(() => {
      expect(screen.getByTestId("agent-chat-alpha-a2")).toBeInTheDocument()
      expect(screen.getByTestId("agent-chat-beta-b2")).toBeInTheDocument()
    })
    expect(screen.getByText("Alpha one")).toBeInTheDocument()
    expect(screen.getByText("Beta one")).toBeInTheDocument()

    await user.click(screen.getByLabelText("Open Beta one in new chat pane"))
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Agent" })).toHaveValue("beta")
      expect(screen.getByTestId("agent-chat-beta-b1")).toBeInTheDocument()
    })
  })

  it("shows an authoritative empty agent without a synthetic wire and inserts its first pane without replacing another owner", async () => {
    const user = userEvent.setup()
    function useTestAgentSelection() {
      const [selectedAgentTypeId, selectAgentTypeId] = useState("alpha")
      return {
        agents: [
          { agentTypeId: "alpha", label: "Alpha" },
          { agentTypeId: "beta", label: "Beta" },
        ],
        selectedAgentTypeId,
        loading: false,
        error: undefined,
        selectAgentTypeId,
      }
    }
    const useSessions: UseWorkspaceAgentSessions = (options) => {
      const owner = options.agentTypeId ?? "legacy"
      const [loading, setLoading] = useState(owner === "beta")
      const [ownerSessions, setOwnerSessions] = useState(
        owner === "alpha"
          ? [{ id: "alpha-session", agentTypeId: owner, title: "Alpha session" }]
          : [],
      )
      useEffect(() => {
        if (owner === "beta") setLoading(false)
      }, [owner])
      const active = ownerSessions[0] ?? null
      return {
        sessions: ownerSessions,
        sourceAgentTypeId: owner,
        loading,
        activeSessionId: active?.id ?? null,
        activeSessionAgentTypeId: owner ?? null,
        activeSession: active,
        workspaceId: options.workspaceId,
        switch: vi.fn(),
        create: async () => {
          const created = { id: "beta-first", agentTypeId: owner, title: "Beta first" }
          setOwnerSessions([created])
          return created
        },
        delete: vi.fn(),
      }
    }
    const mountedWires: string[] = []
    const unmountedWires: string[] = []
    function LifecycleChat(props: WorkspaceChatPanelProps) {
      const wire = `${props.agentTypeId}/${props.sessionId}`
      mountedWires.push(wire)
      useEffect(() => () => {
        unmountedWires.push(wire)
      }, [wire])
      return <textarea aria-label={`Composer ${wire}`} defaultValue={wire} />
    }

    render(
      <WorkspaceAgentFront
        workspaceId="authoritative-empty-agent"
        workspaceLayout="plugin-tabs"
        chatPanel={LifecycleChat}
        useSessions={useSessions}
        addressedAgentSelection
        useAddressedAgentSelection={useTestAgentSelection}
        persistenceEnabled={false}
      />,
    )

    const alphaComposer = await screen.findByRole("textbox", { name: "Composer alpha/alpha-session" })
    await user.selectOptions(screen.getByRole("combobox", { name: "Agent" }), "beta")

    await screen.findByRole("heading", { name: "No chats yet" })
    expect(screen.getByRole("button", { name: "Start new chat" })).toHaveClass("min-h-11", "md:min-h-0")
    expect(alphaComposer).not.toBeVisible()
    expect(screen.queryByRole("textbox", { name: /Composer beta\/default/ })).not.toBeInTheDocument()
    expect(mountedWires).not.toContain("beta/default")
    expect(unmountedWires).not.toContain("alpha/alpha-session")

    await user.click(screen.getByRole("button", { name: "Start new chat" }))

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Composer beta/beta-first" })).toBeVisible()
    })
    expect(alphaComposer).toBeInTheDocument()
    expect(unmountedWires).not.toContain("alpha/alpha-session")
  })

  it("does not mount a synthetic wire while the initially selected addressed agent resolves empty", async () => {
    let releaseSessions!: () => void
    const sessionsReady = new Promise<void>((resolve) => {
      releaseSessions = resolve
    })
    function useTestAgentSelection() {
      return {
        agents: [{ agentTypeId: "alpha", label: "Alpha" }],
        selectedAgentTypeId: "alpha",
        loading: false,
        error: undefined,
        selectAgentTypeId: vi.fn(),
      }
    }
    const useSessions: UseWorkspaceAgentSessions = (options) => {
      const [loading, setLoading] = useState(true)
      useEffect(() => {
        let active = true
        void sessionsReady.then(() => {
          if (active) setLoading(false)
        })
        return () => {
          active = false
        }
      }, [])
      return {
        sessions: [],
        sourceAgentTypeId: options.agentTypeId,
        loading,
        activeSessionId: null,
        activeSessionAgentTypeId: options.agentTypeId ?? null,
        activeSession: null,
        workspaceId: options.workspaceId,
        switch: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      }
    }
    const mountedWires: string[] = []
    function WireProbe(props: WorkspaceChatPanelProps) {
      const wire = `${props.agentTypeId}/${props.sessionId}`
      mountedWires.push(wire)
      return <div>{wire}</div>
    }

    render(
      <WorkspaceAgentFront
        workspaceId="initial-authoritative-empty-agent"
        workspaceLayout="plugin-tabs"
        chatPanel={WireProbe}
        useSessions={useSessions}
        addressedAgentSelection
        useAddressedAgentSelection={useTestAgentSelection}
        persistenceEnabled={false}
      />,
    )

    expect(await screen.findByText("Loading sessions…")).toBeInTheDocument()
    expect(mountedWires).toEqual([])

    await act(async () => {
      releaseSessions()
      await sessionsReady
    })

    await screen.findByRole("heading", { name: "No chats yet" })
    expect(mountedWires).toEqual([])
    expect(screen.queryByText("alpha/default")).not.toBeInTheDocument()
  })

  it("does not mount disabled per-agent session sources when workspace provisioning is suppressed", async () => {
    const storageKey = "boring-workspace:sessions:chat-first-disabled-sources"
    const alphaKey = `${storageKey}:agent:alpha:active-session`
    const betaKey = `${storageKey}:agent:beta:active-session`
    localStorage.setItem(alphaKey, "alpha-active")
    localStorage.setItem(betaKey, "beta-active")
    const sourceCalls: Array<{ agentTypeId?: string; enabled?: boolean }> = []
    function useTestAgentSelection() {
      return {
        agents: [
          { agentTypeId: "alpha", label: "Alpha" },
          { agentTypeId: "beta", label: "Beta" },
        ],
        selectedAgentTypeId: "alpha",
        loading: false,
        error: undefined,
        selectAgentTypeId: vi.fn(),
      }
    }
    const useSessions: UseWorkspaceAgentSessions = (options) => {
      sourceCalls.push({ agentTypeId: options.agentTypeId, enabled: options.enabled })
      useEffect(() => {
        if (options.agentTypeId && options.enabled === false) {
          localStorage.removeItem(`${storageKey}:agent:${options.agentTypeId}:active-session`)
        }
      }, [options.agentTypeId, options.enabled])
      return {
        sessions: [],
        sourceAgentTypeId: options.agentTypeId,
        loading: false,
        activeSessionId: null,
        activeSession: null,
        workspaceId: options.workspaceId,
        switch: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      }
    }

    render(
      <WorkspaceAgentFront
        workspaceId="chat-first-disabled-sources"
        workspaceLayout="plugin-tabs"
        chatPanel={SessionIdChatPanel}
        useSessions={useSessions}
        addressedAgentSelection
        useAddressedAgentSelection={useTestAgentSelection}
        sessions={[]}
        activeSessionId={null}
        onSwitchSession={vi.fn()}
        onCreateSession={vi.fn()}
        onDeleteSession={vi.fn()}
        provisionWorkspace={false}
        persistenceEnabled={false}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })
    expect(sourceCalls.some((call) => call.agentTypeId === "alpha" || call.agentTypeId === "beta")).toBe(false)
    expect(localStorage.getItem(alphaKey)).toBe("alpha-active")
    expect(localStorage.getItem(betaKey)).toBe("beta-active")
  })

  it("prunes and disposes panes whose owner disappears from the authoritative agent catalog", async () => {
    const user = userEvent.setup()
    let removeBeta!: () => void
    let failAlphaSource!: () => void
    let resolveBetaCreate!: (session: { id: string; agentTypeId: string; title: string }) => void
    const betaCreate = new Promise<{ id: string; agentTypeId: string; title: string }>((resolve) => {
      resolveBetaCreate = resolve
    })
    const betaCreateStarted = vi.fn()
    function useTestAgentSelection() {
      const [agents, setAgents] = useState([
        { agentTypeId: "alpha", label: "Alpha" },
        { agentTypeId: "beta", label: "Beta" },
      ])
      const [selectedAgentTypeId, selectAgentTypeId] = useState("alpha")
      removeBeta = () => {
        setAgents([{ agentTypeId: "alpha", label: "Alpha" }])
      }
      return {
        agents,
        selectedAgentTypeId,
        loading: false,
        error: undefined,
        selectAgentTypeId,
      }
    }
    const useSessions: UseWorkspaceAgentSessions = (options) => {
      const owner = options.agentTypeId ?? "legacy"
      const [sourceError, setSourceError] = useState<Error | null>(null)
      if (owner === "alpha") failAlphaSource = () => setSourceError(new Error("alpha source unavailable"))
      const ownerSession = { id: `${owner}-session`, agentTypeId: owner, title: `${owner} session` }
      return {
        sessions: [ownerSession],
        sourceAgentTypeId: owner,
        loading: false,
        activeSessionId: ownerSession.id,
        activeSessionAgentTypeId: owner,
        activeSession: ownerSession,
        workspaceId: options.workspaceId,
        hasMore: true,
        error: sourceError,
        switch: vi.fn(),
        create: owner === "beta"
          ? () => {
              betaCreateStarted()
              return betaCreate
            }
          : vi.fn(),
        delete: vi.fn(),
      }
    }
    const disposedPanes: string[] = []
    function DisposableChat(props: WorkspaceChatPanelProps) {
      const wire = `${props.agentTypeId}/${props.sessionId}`
      useEffect(() => () => {
        disposedPanes.push(wire)
      }, [wire])
      return <div data-testid={`catalog-pane-${props.agentTypeId}`}>{wire}</div>
    }

    render(
      <WorkspaceAgentFront
        workspaceId="catalog-owner-removal"
        workspaceLayout="plugin-tabs"
        chatPanel={DisposableChat}
        useSessions={useSessions}
        addressedAgentSelection
        useAddressedAgentSelection={useTestAgentSelection}
        persistenceEnabled={false}
      />,
    )

    await screen.findByText("beta session")
    await user.click(screen.getByLabelText("Open beta session in new chat pane"))
    await waitFor(() => expect(screen.getByTestId("catalog-pane-beta")).toBeInTheDocument())
    await user.click(screen.getByRole("button", { name: /^New chat$/ }))
    expect(betaCreateStarted).toHaveBeenCalledOnce()

    await user.selectOptions(screen.getByRole("combobox", { name: "Agent" }), "alpha")
    act(() => failAlphaSource())
    act(() => removeBeta())

    await waitFor(() => {
      expect(screen.queryByTestId("catalog-pane-beta")).not.toBeInTheDocument()
      expect(disposedPanes).toContain("beta/beta-session")
    })
    await act(async () => {
      resolveBetaCreate({ id: "beta-late", agentTypeId: "beta", title: "Late Beta" })
      await betaCreate
    })
    expect(screen.queryByTestId("catalog-pane-beta")).not.toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Agent" })).not.toBeInTheDocument()
    expect(screen.getByTestId("catalog-pane-alpha").closest('[data-boring-workspace-part="chat-pane"]')).toHaveAttribute("data-boring-state", "active")
  })

  it("routes a colliding cached-session deletion to Beta while Alpha remains selected", async () => {
    const user = userEvent.setup()
    const alphaDelete = vi.fn()
    const betaDelete = vi.fn()
    function useTestAgentSelection() {
      const [selectedAgentTypeId, selectAgentTypeId] = useState("alpha")
      return {
        agents: [
          { agentTypeId: "alpha", label: "Alpha" },
          { agentTypeId: "beta", label: "Beta" },
        ],
        selectedAgentTypeId,
        loading: false,
        error: undefined,
        selectAgentTypeId,
      }
    }
    const useSessions: UseWorkspaceAgentSessions = (options) => {
      const owner = options.agentTypeId ?? "legacy"
      const [ownerSessions, setOwnerSessions] = useState([
        { id: "shared", agentTypeId: owner, title: `${owner === "alpha" ? "Alpha" : "Beta"} shared` },
      ])
      return {
        sessions: ownerSessions,
        sourceAgentTypeId: owner,
        loading: false,
        activeSessionId: ownerSessions[0]?.id ?? null,
        activeSessionAgentTypeId: owner,
        activeSession: ownerSessions[0] ?? null,
        workspaceId: options.workspaceId,
        switch: vi.fn(),
        create: vi.fn(),
        delete: async (id) => {
          if (owner === "alpha") alphaDelete(id)
          if (owner === "beta") betaDelete(id)
          setOwnerSessions((current) => current.filter((session) => session.id !== id))
        },
      }
    }

    render(
      <WorkspaceAgentFront
        workspaceId="owner-routed-delete"
        workspaceLayout="plugin-tabs"
        chatPanel={SessionIdChatPanel}
        useSessions={useSessions}
        addressedAgentSelection
        useAddressedAgentSelection={useTestAgentSelection}
        persistenceEnabled={false}
      />,
    )

    await screen.findByText("Beta shared")
    expect(screen.getByRole("combobox", { name: "Agent" })).toHaveValue("alpha")
    await user.click(screen.getByLabelText("Delete Beta shared"))

    await waitFor(() => {
      expect(betaDelete).toHaveBeenCalledWith("shared")
      expect(alphaDelete).not.toHaveBeenCalled()
      expect(screen.getByRole("combobox", { name: "Agent" })).toHaveValue("alpha")
      expect(within(screen.getByLabelText("App navigation")).getByText("Alpha shared")).toBeInTheDocument()
      expect(within(screen.getByLabelText("App navigation")).queryByText("Beta shared")).not.toBeInTheDocument()
    })
  })

  it("aligns the selector and owner controller when closing across colliding addressed panes", async () => {
    const user = userEvent.setup()
    const alphaSwitch = vi.fn()
    const betaSwitch = vi.fn()
    function useTestAgentSelection() {
      const [selectedAgentTypeId, selectAgentTypeId] = useState("alpha")
      return {
        agents: [
          { agentTypeId: "alpha", label: "Alpha" },
          { agentTypeId: "beta", label: "Beta" },
        ],
        selectedAgentTypeId,
        loading: false,
        error: undefined,
        selectAgentTypeId,
      }
    }
    const useSessions: UseWorkspaceAgentSessions = (options) => {
      const owner = options.agentTypeId ?? "legacy"
      const ownerSession = { id: "shared", agentTypeId: owner, title: `${owner === "alpha" ? "Alpha" : "Beta"} shared` }
      return {
        sessions: [ownerSession],
        sourceAgentTypeId: owner,
        loading: false,
        activeSessionId: "shared",
        activeSessionAgentTypeId: owner,
        activeSession: ownerSession,
        workspaceId: options.workspaceId,
        switch: (id) => {
          if (owner === "alpha") alphaSwitch(id)
          if (owner === "beta") betaSwitch(id)
        },
        create: vi.fn(),
        delete: vi.fn(),
      }
    }
    function PresenceOwnedPane(props: WorkspaceChatPanelProps) {
      const owner = props.agentTypeId ?? "legacy"
      const presenceOwnerId = `owned-pane:${owner}`
      useEffect(() => {
        const detail = {
          sessionId: props.sessionId,
          agentTypeId: props.agentTypeId,
          presenceOwnerId,
        }
        window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
          detail: { ...detail, working: true },
        }))
        return () => {
          window.dispatchEvent(new CustomEvent("boring:chat-session-status", {
            detail: { ...detail, working: false },
          }))
        }
      }, [presenceOwnerId, props.agentTypeId, props.sessionId])
      return <div data-testid={`owned-pane-${owner}`}>{owner}/{props.sessionId}</div>
    }

    render(
      <WorkspaceAgentFront
        workspaceId="owner-routed-close"
        workspaceLayout="plugin-tabs"
        chatPanel={PresenceOwnedPane}
        useSessions={useSessions}
        addressedAgentSelection
        useAddressedAgentSelection={useTestAgentSelection}
        persistenceEnabled={false}
      />,
    )

    await screen.findByText("Beta shared")
    await user.click(screen.getByLabelText("Open Beta shared in new chat pane"))
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Agent" })).toHaveValue("beta")
      expect(betaSwitch).toHaveBeenCalledWith("shared")
      expect(screen.getByTestId("owned-pane-alpha")).toBeInTheDocument()
      expect(screen.getByTestId("owned-pane-beta")).toBeInTheDocument()
      expect(screen.getByLabelText("Beta streaming")).toBeInTheDocument()
    })
    const betaSwitchCount = betaSwitch.mock.calls.length

    await user.click(screen.getByLabelText("Close Beta shared pane"))

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Agent" })).toHaveValue("alpha")
      expect(alphaSwitch).toHaveBeenCalledWith("shared")
      expect(betaSwitch).toHaveBeenCalledTimes(betaSwitchCount)
      expect(screen.getByTestId("owned-pane-alpha").closest('[data-boring-workspace-part="chat-pane"]')).toHaveAttribute("data-boring-state", "active")
      expect(screen.getByLabelText("Beta idle")).toBeInTheDocument()
    })
  })

  it("restores the canonical non-first active session per agent and across remount", async () => {
    const user = userEvent.setup()
    function useTestAgentSelection() {
      const [selectedAgentTypeId, selectAgentTypeId] = useState("alpha")
      return {
        agents: [
          { agentTypeId: "alpha", label: "Alpha" },
          { agentTypeId: "beta", label: "Beta" },
        ],
        selectedAgentTypeId,
        loading: false,
        error: undefined,
        selectAgentTypeId,
      }
    }
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const owner = url.includes("/agents/beta/") ? "beta" : url.includes("/agents/alpha/") ? "alpha" : undefined
      if (owner) {
        return new Response(JSON.stringify({
          sessions: owner === "beta" ? [] : [
            { ref: { agentTypeId: owner, sessionId: `${owner}-first` }, title: `${owner} first`, status: "idle", createdAt: 1, updatedAt: 2 },
            { ref: { agentTypeId: owner, sessionId: `${owner}-second` }, title: `${owner} second`, status: "idle", createdAt: 1, updatedAt: 2 },
          ],
        }))
      }
      if (url.includes("/api/v1/tree")) return new Response(JSON.stringify({ entries: [] }))
      if (url.includes("/api/v1/ready-status")) return new Response(null, { status: 200 })
      if (url.includes("/api/v1/agent-plugins")) return new Response(JSON.stringify([]))
      if (url.includes("/api/v1/ui/commands/next")) return new Response(JSON.stringify([]))
      return new Response(null, { status: 204 })
    }))
    const props = {
      workspaceId: "canonical-per-agent-active",
      workspaceLayout: "plugin-tabs" as const,
      chatPanel: (panelProps: WorkspaceChatPanelProps) => <div data-testid="canonical-wire">{panelProps.agentTypeId}/{panelProps.sessionId}</div>,
      addressedAgentSelection: true,
      useAddressedAgentSelection: useTestAgentSelection,
    }

    const firstRender = render(<WorkspaceAgentFront {...props} />)
    await screen.findByText("alpha second")
    await user.click(screen.getByText("alpha second"))
    await waitFor(() => expect(screen.getByTestId("canonical-wire")).toHaveTextContent("alpha/alpha-second"))
    await user.selectOptions(screen.getByRole("combobox", { name: "Agent" }), "beta")
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Agent" })).toHaveValue("beta")
      expect(screen.getByText("No chats yet.")).toBeInTheDocument()
    })
    await user.selectOptions(screen.getByRole("combobox", { name: "Agent" }), "alpha")
    await waitFor(() => expect(screen.getByTestId("canonical-wire")).toHaveTextContent("alpha/alpha-second"))

    firstRender.unmount()
    render(<WorkspaceAgentFront {...props} />)
    await waitFor(() => expect(screen.getByTestId("canonical-wire")).toHaveTextContent("alpha/alpha-second"))
  })

  it("does not recreate or dispose an Alpha remote when deferred Beta becomes selected", async () => {
    const user = userEvent.setup()
    let releaseBeta!: () => void
    const betaReady = new Promise<void>((resolve) => {
      releaseBeta = resolve
    })
    function useTestAgentSelection() {
      const [selectedAgentTypeId, selectAgentTypeId] = useState("alpha")
      return {
        agents: [
          { agentTypeId: "alpha", label: "Alpha" },
          { agentTypeId: "beta", label: "Beta" },
        ],
        selectedAgentTypeId,
        loading: false,
        error: undefined,
        selectAgentTypeId,
      }
    }
    const useSessions: UseWorkspaceAgentSessions = (options) => {
      const owner = options.agentTypeId ?? "legacy"
      const [loaded, setLoaded] = useState(owner === "alpha")
      useEffect(() => {
        if (owner !== "beta") return
        let active = true
        void betaReady.then(() => {
          if (active) setLoaded(true)
        })
        return () => {
          active = false
        }
      }, [owner])
      const session = loaded ? { id: `${owner}-session`, agentTypeId: owner, title: `${owner} session` } : undefined
      return {
        sessions: session ? [session] : [],
        sourceAgentTypeId: owner,
        loading: !loaded,
        activeSessionId: session?.id ?? null,
        activeSessionAgentTypeId: owner,
        activeSession: session ?? null,
        workspaceId: options.workspaceId,
        switch: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      }
    }
    const created: Array<{ owner: string; dispose: ReturnType<typeof vi.fn> }> = []
    const createRemoteSession = vi.fn((owner: string) => {
      const dispose = vi.fn()
      created.push({ owner, dispose })
      return { dispose }
    })
    function RemoteLifecyclePanel(props: CapturedChatPanelProps) {
      useEffect(() => {
        const remote = createRemoteSession(props.agentTypeId ?? "legacy")
        return () => remote.dispose()
      }, [props.agentTypeId, props.hydrateMessages, props.sessionId])
      return <div data-testid={`remote-${props.agentTypeId}`}>{props.agentTypeId}/{props.sessionId}</div>
    }

    render(
      <WorkspaceAgentFront
        workspaceId="retained-remote-lifetime"
        workspaceLayout="plugin-tabs"
        chatPanel={RemoteLifecyclePanel}
        useSessions={useSessions}
        addressedAgentSelection
        useAddressedAgentSelection={useTestAgentSelection}
        persistenceEnabled={false}
      />,
    )

    await screen.findByTestId("remote-alpha")
    expect(createRemoteSession.mock.calls.filter(([owner]) => owner === "alpha")).toHaveLength(1)
    await user.selectOptions(screen.getByRole("combobox", { name: "Agent" }), "beta")
    expect(created.find((remote) => remote.owner === "alpha")?.dispose).not.toHaveBeenCalled()
    expect(createRemoteSession.mock.calls.filter(([owner]) => owner === "alpha")).toHaveLength(1)

    await act(async () => {
      releaseBeta()
      await betaReady
    })
    await screen.findByTestId("remote-beta")
    expect(created.find((remote) => remote.owner === "alpha")?.dispose).not.toHaveBeenCalled()
    expect(createRemoteSession.mock.calls.filter(([owner]) => owner === "alpha")).toHaveLength(1)
    expect(createRemoteSession.mock.calls.filter(([owner]) => owner === "beta")).toHaveLength(1)
  })

  it("refreshes a retained pane through its owner after another agent is selected", async () => {
    const user = userEvent.setup()
    const alphaRefresh = vi.fn()
    const betaRefresh = vi.fn()
    function useTestAgentSelection() {
      const [selectedAgentTypeId, selectAgentTypeId] = useState("alpha")
      return {
        agents: [
          { agentTypeId: "alpha", label: "Alpha" },
          { agentTypeId: "beta", label: "Beta" },
        ],
        selectedAgentTypeId,
        loading: false,
        error: undefined,
        selectAgentTypeId,
      }
    }
    const useSessions: UseWorkspaceAgentSessions = (options) => {
      const owner = options.agentTypeId ?? "legacy"
      const session = { id: `${owner}-session`, agentTypeId: owner, title: `${owner} session` }
      return {
        sessions: [session],
        sourceAgentTypeId: owner,
        loading: false,
        activeSessionId: session.id,
        activeSessionAgentTypeId: owner,
        activeSession: session,
        workspaceId: options.workspaceId,
        switch: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
        refresh: async () => {
          if (owner === "alpha") alphaRefresh()
          if (owner === "beta") betaRefresh()
        },
      }
    }
    function CompletionPanel(props: WorkspaceChatPanelProps) {
      return (
        <button type="button" onClick={() => props.onTurnComplete?.()}>
          Complete {props.agentTypeId}
        </button>
      )
    }

    render(
      <WorkspaceAgentFront
        workspaceId="owner-routed-refresh"
        workspaceLayout="plugin-tabs"
        chatPanel={CompletionPanel}
        useSessions={useSessions}
        addressedAgentSelection
        useAddressedAgentSelection={useTestAgentSelection}
        persistenceEnabled={false}
      />,
    )

    await screen.findByText("beta session")
    await user.click(screen.getByLabelText("Open beta session in new chat pane"))
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Agent" })).toHaveValue("beta"))
    alphaRefresh.mockClear()
    betaRefresh.mockClear()

    await user.click(screen.getByRole("button", { name: "Complete alpha" }))

    expect(alphaRefresh).toHaveBeenCalledTimes(1)
    expect(betaRefresh).not.toHaveBeenCalled()
  })

  it("never mounts a workspace-only Alpha placeholder on Beta's wire while Beta sessions are deferred", async () => {
    localStorage.setItem("boring-workspace:sessions:deferred-agent-transition", "alpha-stored-session")
    let resolveBetaSessions!: () => void
    const betaSessions = new Promise<void>((resolve) => {
      resolveBetaSessions = resolve
    })
    let selectAgent!: (agentTypeId: string) => void
    function useTestAgentSelection() {
      const [selectedAgentTypeId, setSelectedAgentTypeId] = useState("alpha")
      selectAgent = setSelectedAgentTypeId
      return {
        agents: [
          { agentTypeId: "alpha", label: "Alpha" },
          { agentTypeId: "beta", label: "Beta" },
        ],
        selectedAgentTypeId,
        loading: false,
        error: undefined,
        selectAgentTypeId: setSelectedAgentTypeId,
      }
    }
    const useSessions: UseWorkspaceAgentSessions = (options) => {
      const [betaReady, setBetaReady] = useState(false)
      useEffect(() => {
        if (options.agentTypeId !== "beta") return
        let cancelled = false
        void betaSessions.then(() => {
          if (!cancelled) setBetaReady(true)
        })
        return () => {
          cancelled = true
        }
      }, [options.agentTypeId])
      const session = options.agentTypeId === "alpha"
        ? { id: "alpha-session", agentTypeId: "alpha", title: "Alpha session" }
        : betaReady
          ? { id: "beta-session", agentTypeId: "beta", title: "Beta session" }
          : undefined
      return {
        sessions: session ? [session] : [],
        sourceAgentTypeId: options.agentTypeId === "beta" && !betaReady ? "alpha" : options.agentTypeId,
        loading: options.agentTypeId === "beta" && !betaReady,
        activeSessionId: session?.id ?? null,
        activeSessionAgentTypeId: session?.agentTypeId ?? null,
        activeSession: session ?? null,
        workspaceId: options.workspaceId,
        switch: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      }
    }
    const renderedWires: string[] = []
    function WireProbe(props: WorkspaceChatPanelProps) {
      renderedWires.push(`${props.agentTypeId}/${props.sessionId}`)
      return <div data-testid="deferred-agent-wire">{props.agentTypeId}/{props.sessionId}</div>
    }

    render(
      <WorkspaceAgentFront
        workspaceId="deferred-agent-transition"
        chatPanel={WireProbe}
        useSessions={useSessions}
        addressedAgentSelection
        useAddressedAgentSelection={useTestAgentSelection}
        persistenceEnabled={false}
      />,
    )
    await waitFor(() => expect(screen.getByTestId("deferred-agent-wire")).toHaveTextContent("alpha/alpha-session"))

    act(() => selectAgent("beta"))
    await waitFor(() => expect(screen.queryByTestId("deferred-agent-wire")).toBeNull())
    expect(screen.queryByText("alpha/alpha-session")).toBeNull()
    expect(renderedWires).not.toContain("beta/alpha-session")
    expect(renderedWires).not.toContain("beta/alpha-stored-session")
    expect(screen.queryByText("beta/alpha-stored-session")).toBeNull()

    await act(async () => {
      resolveBetaSessions()
      await betaSessions
    })
    await waitFor(() => expect(screen.getByTestId("deferred-agent-wire")).toHaveTextContent("beta/beta-session"))
    expect(renderedWires).not.toContain("beta/alpha-stored-session")
  })

  it("rejects an unowned stale Alpha result while Beta's authoritative result is deferred", async () => {
    let releaseBeta!: () => void
    const betaResult = new Promise<void>((resolve) => {
      releaseBeta = resolve
    })
    let selectAgent!: (agentTypeId: string) => void
    function useTestAgentSelection() {
      const [selectedAgentTypeId, setSelectedAgentTypeId] = useState("alpha")
      selectAgent = setSelectedAgentTypeId
      return {
        agents: [
          { agentTypeId: "alpha", label: "Alpha" },
          { agentTypeId: "beta", label: "Beta" },
        ],
        selectedAgentTypeId,
        loading: false,
        error: undefined,
        selectAgentTypeId: setSelectedAgentTypeId,
      }
    }
    const useSessions: UseWorkspaceAgentSessions = (options) => {
      const [betaReady, setBetaReady] = useState(false)
      useEffect(() => {
        if (options.agentTypeId !== "beta") return
        let cancelled = false
        void betaResult.then(() => {
          if (!cancelled) setBetaReady(true)
        })
        return () => {
          cancelled = true
        }
      }, [options.agentTypeId])
      const staleAlpha = options.agentTypeId === "beta" && !betaReady
      const sourceAgentTypeId = staleAlpha ? "alpha" : options.agentTypeId
      const sessionId = sourceAgentTypeId === "beta" ? "beta-session" : "alpha-session"
      const session = { id: sessionId, title: `${sourceAgentTypeId} session` }
      return {
        sessions: [session],
        sourceAgentTypeId,
        loading: false,
        activeSessionId: session.id,
        activeSession: session,
        workspaceId: options.workspaceId,
        switch: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      }
    }
    const renderedWires: string[] = []
    function WireProbe(props: WorkspaceChatPanelProps) {
      renderedWires.push(`${props.agentTypeId}/${props.sessionId}`)
      return <div data-testid="unowned-stale-agent-wire">{props.agentTypeId}/{props.sessionId}</div>
    }

    render(
      <WorkspaceAgentFront
        workspaceId="unowned-stale-agent-transition"
        chatPanel={WireProbe}
        useSessions={useSessions}
        addressedAgentSelection
        useAddressedAgentSelection={useTestAgentSelection}
        persistenceEnabled={false}
      />,
    )
    await waitFor(() => expect(screen.getByTestId("unowned-stale-agent-wire")).toHaveTextContent("alpha/alpha-session"))

    act(() => selectAgent("beta"))
    await waitFor(() => expect(screen.queryByTestId("unowned-stale-agent-wire")).toBeNull())
    expect(renderedWires).not.toContain("beta/alpha-session")

    await act(async () => {
      releaseBeta()
      await betaResult
    })
    await waitFor(() => expect(screen.getByTestId("unowned-stale-agent-wire")).toHaveTextContent("beta/beta-session"))
    expect(renderedWires).not.toContain("beta/alpha-session")
  })

  it("ignores a stale Alpha auto-submit create completion after selecting Beta", async () => {
    let resolveAlphaCreate!: (session: { id: string; agentTypeId: string; title: string }) => void
    let resolveBetaCreate!: (session: { id: string; agentTypeId: string; title: string }) => void
    const alphaCreate = new Promise<{ id: string; agentTypeId: string; title: string }>((resolve) => {
      resolveAlphaCreate = resolve
    })
    const betaCreate = new Promise<{ id: string; agentTypeId: string; title: string }>((resolve) => {
      resolveBetaCreate = resolve
    })
    let selectAgent!: (agentTypeId: string) => void
    function useTestAgentSelection() {
      const [selectedAgentTypeId, setSelectedAgentTypeId] = useState("alpha")
      selectAgent = setSelectedAgentTypeId
      return {
        agents: [
          { agentTypeId: "alpha", label: "Alpha" },
          { agentTypeId: "beta", label: "Beta" },
        ],
        selectedAgentTypeId,
        loading: false,
        error: undefined,
        selectAgentTypeId: setSelectedAgentTypeId,
      }
    }
    const createCalls: string[] = []
    const useSessions: UseWorkspaceAgentSessions = (options) => {
      const [session, setSession] = useState<{ id: string; agentTypeId: string; title: string }>()
      useEffect(() => setSession(undefined), [options.agentTypeId])
      return {
        sessions: session ? [session] : [],
        sourceAgentTypeId: options.agentTypeId,
        loading: false,
        activeSessionId: session?.id ?? null,
        activeSessionAgentTypeId: session?.agentTypeId ?? null,
        activeSession: session ?? null,
        workspaceId: options.workspaceId,
        switch: vi.fn(),
        create: vi.fn(() => {
          const owner = options.agentTypeId ?? "legacy"
          createCalls.push(owner)
          const creation = owner === "beta" ? betaCreate : alphaCreate
          return creation.then((created) => {
            if (owner === "beta") setSession(created)
            return created
          })
        }),
        delete: vi.fn(),
      }
    }
    const renderedWires: string[] = []
    function WireProbe(props: WorkspaceChatPanelProps) {
      renderedWires.push(`${props.agentTypeId}/${props.sessionId}`)
      return <div data-testid="auto-submit-agent-wire">{props.agentTypeId}/{props.sessionId}</div>
    }

    render(
      <WorkspaceAgentFront
        workspaceId="stale-auto-submit-agent"
        chatPanel={WireProbe}
        useSessions={useSessions}
        addressedAgentSelection
        useAddressedAgentSelection={useTestAgentSelection}
        chatParams={{ initialDraft: "send after create", autoSubmitInitialDraft: true }}
        persistenceEnabled={false}
      />,
    )
    await waitFor(() => expect(createCalls).toContain("alpha"))

    act(() => selectAgent("beta"))
    await waitFor(() => expect(createCalls).toContain("beta"))
    await act(async () => {
      resolveAlphaCreate({ id: "alpha-created", agentTypeId: "alpha", title: "Alpha created" })
      await alphaCreate
    })
    expect(renderedWires).not.toContain("beta/alpha-created")

    await act(async () => {
      resolveBetaCreate({ id: "beta-created", agentTypeId: "beta", title: "Beta created" })
      await betaCreate
    })
    await waitFor(() => expect(screen.getByTestId("auto-submit-agent-wire")).toHaveTextContent("beta/beta-created"))
    expect(renderedWires).not.toContain("beta/alpha-created")
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

  it("opens a controlled void-created session as a pane to the right", async () => {
    const user = userEvent.setup()

    function Harness() {
      const [sessions, setSessions] = useState([
        { id: "s1", title: "First session", updatedAt: Date.now() - 1_000 },
      ])
      const [activeSessionId, setActiveSessionId] = useState("s1")
      return (
        <WorkspaceAgentFront
          workspaceId="controlled-create-pane"
          chatPanel={SessionIdChatPanel}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSwitchSession={setActiveSessionId}
          onCreateSession={() => {
            setSessions((previous) => [
              { id: "created", title: "Created session", updatedAt: Date.now() },
              ...previous,
            ])
            setActiveSessionId("created")
          }}
          persistenceEnabled={false}
        />
      )
    }

    render(<Harness />)
    expandHistory()

    await user.click(screen.getByRole("button", { name: "New chat" }))

    await waitFor(() => {
      expect(visibleChatSessionIds()).toEqual(["s1", "created"])
    })
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

  it("keeps an async returned created pane while controlled sessions catch up", async () => {
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
      expect(visibleChatSessionIds()).toEqual(["s1", "created"])
    })

    await user.click(screen.getByRole("button", { name: "Refresh stale sessions" }))

    await waitFor(() => {
      expect(visibleChatSessionIds()).toEqual(["s1", "created"])
    })
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

  it("keeps hydration disabled after auth-return auto-submit props clear until the chat explicitly unlocks it", async () => {
    let capturedChatProps: unknown
    const getCapturedChatProps = () => capturedChatProps as CapturedChatPanelProps | undefined
    const CapturingChatPanel = (props: WorkspaceChatPanelProps) => {
      capturedChatProps = props
      return <div>Captured chat panel</div>
    }
    const useSessions = () => ({
      sessions: [{ id: "sess-auth-return", title: "Auth return" }],
      loading: false,
      error: undefined,
      activeSessionId: "sess-auth-return",
      activeSession: { id: "sess-auth-return", title: "Auth return" },
      switch: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    })

    const { rerender } = render(
      <WorkspaceAgentFront
        workspaceId="auth-return-lock"
        chatPanel={CapturingChatPanel}
        useSessions={useSessions}
        chatParams={{ initialDraft: "restore and send", autoSubmitInitialDraft: true }}
        persistenceEnabled={false}
      />,
    )

    expect(getCapturedChatProps()?.hydrateMessages).toBe(false)

    rerender(
      <WorkspaceAgentFront
        workspaceId="auth-return-lock"
        chatPanel={CapturingChatPanel}
        useSessions={useSessions}
        chatParams={{}}
        persistenceEnabled={false}
      />,
    )

    expect(getCapturedChatProps()?.hydrateMessages).toBe(false)

    act(() => {
      const onSettled = getCapturedChatProps()?.onAutoSubmitInitialDraftSettled
      onSettled?.()
    })

    await waitFor(() => {
      expect(getCapturedChatProps()?.hydrateMessages).toBe(true)
    })
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

  it("does not pass the New chat click event into remote session creation", () => {
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

    expect(create).toHaveBeenCalledOnce()
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
