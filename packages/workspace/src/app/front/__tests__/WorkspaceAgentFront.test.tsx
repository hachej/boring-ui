import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UI_COMMAND_EVENT, type UiCommand } from "../../../front/bridge"
import type { WorkspaceChatPanelProps } from "../../../front/chrome/chat/types"
import type { PanelConfig } from "../../../front/registry/types"
import { definePlugin } from "../../../shared/plugins/frontFactory"
import type { PluginProviderProps } from "../../../shared/plugins/types"
import { WorkspaceAgentFront } from "../WorkspaceAgentFront"

type CapturedChatPanelProps = WorkspaceChatPanelProps & {
  initialDraft?: string
  autoSubmitInitialDraft?: boolean
  hydrateMessages?: boolean
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
      if (url.includes("/api/v1/agent/sessions")) {
        // Only the cold-start GET race is simulated; POST/DELETE pass through.
        const method = init?.method ?? "GET"
        if (method === "GET" && sessionsFailuresRemaining > 0) {
          sessionsFailuresRemaining -= 1
          return new Response(null, { status: 503 })
        }
        return new Response(JSON.stringify([]), { status: 200 })
      }
      if (url.includes("/api/v1/ready-status")) return new Response(null, { status: 200 })
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
    expect(screen.getByRole("button", { name: "Workbench" })).toBeInTheDocument()
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
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/agent/sessions"))).toBe(false)
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/agent/chat"))).toBe(false)
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
      if (url.includes("/api/v1/agent/sessions")) return new Response(JSON.stringify([{ id: `session-${workspaceId ?? "unknown"}`, title: "Session" }]), { status: 200 })
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
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/agent/sessions"))).toBe(true)
    })
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/agent/chat/session-workspace-a/messages"))).toBe(true)
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
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/agent/sessions"))).toBe(true)
    })
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/agent/chat/session-workspace-b/messages"))).toBe(true)
    })
    expect(fetchMock.mock.calls.some(([input, init]) => {
      const headers = init?.headers as Record<string, string> | undefined
      return String(input).includes("/api/v1/agent/chat/session-workspace-a/messages") && headers?.["x-boring-workspace-id"] === "workspace-b"
    })).toBe(false)
    resolveWorkspaceBTree?.(new Response(JSON.stringify({ entries: [] }), { status: 200 }))
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
      if (url.includes("/api/v1/agent/sessions") && workspaceId === "workspace-b") return new Response(JSON.stringify({ message: "nope" }), { status: 500 })
      if (url.includes("/api/v1/agent/sessions")) return new Response(JSON.stringify([{ id: "session-workspace-a", title: "A" }]), { status: 200 })
      return new Response(JSON.stringify([]), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const { rerender } = render(
      <WorkspaceAgentFront workspaceId="workspace-a" persistenceEnabled={false} />,
    )
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/agent/chat/session-workspace-a/messages"))).toBe(true)
    })
    fetchMock.mockClear()

    rerender(<WorkspaceAgentFront workspaceId="workspace-b" persistenceEnabled={false} />)
    resolveWorkspaceBTree?.(new Response(JSON.stringify({ entries: [] }), { status: 200 }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/agent/sessions"))).toBe(true)
    })
    expect(fetchMock.mock.calls.some(([input, init]) => {
      const headers = init?.headers as Record<string, string> | undefined
      return String(input).includes("/api/v1/agent/chat/session-workspace-a/messages") && headers?.["x-boring-workspace-id"] === "workspace-b"
    })).toBe(false)
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
    await user.click(screen.getByRole("button", { name: "Open artifact" }))

    await waitFor(() => {
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

  it("removes the empty auto-created default when the user manually creates a chat", async () => {
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

    fireEvent.click(screen.getAllByRole("button", { name: "New chat" })[0])

    await waitFor(() => {
      expect(create).toHaveBeenCalledOnce()
      expect(deleted).toHaveBeenCalledWith("auto")
    })
  })

  it("does not auto-create a replacement after the user deletes the last remote session", async () => {
    vi.useFakeTimers()
    const create = vi.fn(async () => ({ id: "created", title: "Created" }))
    const deleted = vi.fn()

    function useDeletingSessions() {
      const [sessionIds, setSessionIds] = useState(["only"])
      const sessions = sessionIds.map((id) => ({ id, title: "Only session", updatedAt: Date.now() }))
      return {
        sessions,
        activeSessionId: sessions[0]?.id ?? null,
        activeSession: sessions[0] ?? null,
        loading: false,
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
        workspaceId="delete-last"
        chatPanel={ChatPanel}
        useSessions={useDeletingSessions}
        persistenceEnabled={false}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Sessions" }))
    fireEvent.click(screen.getByLabelText("Delete Only session"))

    expect(deleted).toHaveBeenCalledWith("only")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500)
    })

    expect(create).not.toHaveBeenCalled()
    vi.useRealTimers()
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
  })

  it("opens a referenced session through the workspace openSession command", async () => {
    render(
      <WorkspaceAgentFront
        workspaceId="session-link-workspace"
        chatPanel={ChatPanel}
        sessions={[{ id: "sess-source", title: "Source" }, { id: "sess-target", title: "Target" }]}
        activeSessionId="sess-source"
        persistenceEnabled={false}
      />,
    )

    act(() => {
      window.dispatchEvent(new CustomEvent(UI_COMMAND_EVENT, {
        detail: { kind: "openSession", params: { sessionId: "sess-target" } satisfies UiCommand["params"] },
      }))
    })

    await waitFor(() => {
      expect(screen.getByLabelText("Session browser")).toHaveAttribute("aria-hidden", "false")
      expect(screen.getByText("Target")).toBeInTheDocument()
    })
  })

  it("shows a clear missing-session banner when a referenced session is unavailable", async () => {
    render(
      <WorkspaceAgentFront
        workspaceId="missing-session-link-workspace"
        chatPanel={ChatPanel}
        sessions={[{ id: "sess-source", title: "Source" }]}
        activeSessionId="sess-source"
        persistenceEnabled={false}
      />,
    )

    act(() => {
      window.dispatchEvent(new CustomEvent(UI_COMMAND_EVENT, {
        detail: { kind: "openSession", params: { sessionId: "sess-missing" } satisfies UiCommand["params"] },
      }))
    })

    expect(await screen.findByText(/was not found in this workspace\./)).toBeInTheDocument()
    expect(screen.getByText("sess-missing")).toBeInTheDocument()
    expect(screen.getByLabelText("Session browser")).toHaveAttribute("aria-hidden", "false")
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

    await user.click(screen.getByText("Session two"))
    expect(onSwitchSession).toHaveBeenCalledWith("s2")
    expect(observed).toHaveBeenCalledWith(expect.objectContaining({ detail: { sessionId: "s1" } }))

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
      if (url.includes("/api/v1/agent/sessions")) {
        const method = init?.method ?? "GET"
        if (method === "GET" && sessionsFailuresRemaining > 0) {
          sessionsFailuresRemaining -= 1
          return new Response(null, { status: 503 })
        }
        if (method === "GET") return new Response(JSON.stringify([{ id: "s1", title: "Existing" }]), { status: 200 })
      }
      if (url.includes("/api/v1/ready-status")) return new Response(null, { status: 200 })
      if (url.includes("/api/v1/agent/chat")) return new Response(JSON.stringify({ messages: [] }), { status: 200 })
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
      String(input).includes("/api/v1/agent/sessions") && (init?.method ?? "GET") === "POST",
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

  it("keeps the chat shell in transition until the first empty remote session is stable", async () => {
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
    expect(captured.at(-1)?.hydrateMessages).toBe(false)
  })
})
