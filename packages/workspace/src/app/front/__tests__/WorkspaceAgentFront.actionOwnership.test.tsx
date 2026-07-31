import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import type { WorkspaceChatPanelProps } from "../../../front/chrome/chat/types"
import type { ChatLayoutProps } from "../../../front/layout"
import type { AppLeftPaneProps } from "../../../front/layout/plugin-tabs/AppLeftPane"

let capturedAppLeftPane: AppLeftPaneProps | undefined
let capturedChatLayout: ChatLayoutProps | undefined

vi.mock("../../../front/layout/plugin-tabs/AppLeftPane", () => ({
  AppLeftPane: (props: AppLeftPaneProps) => {
    capturedAppLeftPane = props
    return <div data-testid="captured-app-left" />
  },
}))

vi.mock("../../../front/layout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../front/layout")>()
  return {
    ...actual,
    ChatLayout: (props: ChatLayoutProps) => {
      capturedChatLayout = props
      const sessionId = (props.centerParams as { sessionId?: string } | undefined)?.sessionId
      return <div data-testid="chat-pane">Chat {sessionId}</div>
    },
  }
})

import { WorkspaceAgentFront, type UseWorkspaceAgentSessions } from "../WorkspaceAgentFront"

function ChatPanel(props: WorkspaceChatPanelProps) {
  return <div data-testid="chat-pane">Chat {props.sessionId}</div>
}

describe("WorkspaceAgentFront session action ownership", () => {
  it("makes saved explicit-session callbacks inert after an operation identity commit", async () => {
    const alpha = { create: vi.fn(() => ({ id: "alpha-created" })), switch: vi.fn(), delete: vi.fn() }
    const beta = { create: vi.fn(() => ({ id: "beta-created" })), switch: vi.fn(), delete: vi.fn() }
    const sessions = [
      { id: "first", title: "First" },
      { id: "second", title: "Second" },
    ]
    const front = (workspaceId: string, actions: typeof alpha) => (
      <WorkspaceAgentFront
        workspaceId={workspaceId}
        workspaceLayout="plugin-tabs"
        chatPanel={ChatPanel}
        sessions={sessions}
        activeSessionId="first"
        onCreateSession={actions.create}
        onSwitchSession={actions.switch}
        onDeleteSession={actions.delete}
      />
    )

    const view = render(front("explicit-alpha", alpha))
    await waitFor(() => expect(screen.getByText("Chat first")).toBeInTheDocument())
    const saved = {
      create: capturedAppLeftPane?.onCreateSession,
      switch: capturedAppLeftPane?.onSwitchSession,
      open: capturedAppLeftPane?.onOpenSessionAsPane,
      delete: capturedAppLeftPane?.onDeleteSession,
      pin: capturedAppLeftPane?.onToggleSessionPinned,
      activatePane: capturedChatLayout?.onActiveChatPaneChange,
      closePane: capturedChatLayout?.onCloseChatPane,
      createPane: capturedChatLayout?.onCreateChatPaneAfter,
      splitPane: capturedChatLayout?.onSplitChatPane,
      consumePlacement: capturedChatLayout?.onPendingChatPanePlacementConsumed,
    }

    const deferredCreate = saved.create?.()
    view.rerender(front("explicit-beta", beta))
    await act(async () => { await deferredCreate })
    await waitFor(() => expect(screen.getByText("Chat first")).toBeInTheDocument())
    const activePaneBefore = capturedChatLayout?.activeChatPaneId
    const storageBefore = Object.fromEntries(
      Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
        .filter((key): key is string => key !== null)
        .map((key) => [key, localStorage.getItem(key)]),
    )

    act(() => {
      saved.switch?.("second")
      saved.open?.("second")
      saved.delete?.("first")
      saved.pin?.("second")
      saved.activatePane?.("second")
      saved.closePane?.("first")
      saved.createPane?.("first")
      saved.splitPane?.("first", "right")
      saved.consumePlacement?.("second")
    })
    await act(async () => { await Promise.resolve() })

    expect(alpha.create).not.toHaveBeenCalled()
    expect(alpha.switch).not.toHaveBeenCalled()
    expect(alpha.delete).not.toHaveBeenCalled()
    expect(beta.create).not.toHaveBeenCalled()
    expect(beta.switch).not.toHaveBeenCalled()
    expect(beta.delete).not.toHaveBeenCalled()
    expect(capturedChatLayout?.activeChatPaneId).toBe(activePaneBefore)
    expect(capturedAppLeftPane?.pinnedSessionRefs).toEqual([])
    expect(Object.fromEntries(
      Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
        .filter((key): key is string => key !== null)
        .map((key) => [key, localStorage.getItem(key)]),
    )).toEqual(storageBefore)
  })

  it("releases last-session replacement guards after a synchronous custom create failure", async () => {
    const create = vi.fn()
      .mockImplementationOnce(() => { throw new Error("sync replacement failed") })
      .mockResolvedValueOnce({ id: "replacement", title: "Replacement" })
    const remove = vi.fn()

    render(
      <WorkspaceAgentFront
        workspaceId="sync-replacement-retry"
        workspaceLayout="plugin-tabs"
        chatPanel={ChatPanel}
        useSessions={(options) => ({
          sourceIdentity: options.sourceIdentity,
          sessions: [{ id: "only", title: "Only" }],
          activeSessionId: "only",
          activeSession: { id: "only", title: "Only" },
          loading: false,
          hasMore: false,
          create,
          switch: vi.fn(),
          delete: remove,
        })}
        persistenceEnabled={false}
      />,
    )

    await waitFor(() => expect(capturedAppLeftPane?.onDeleteSession).toEqual(expect.any(Function)))
    const deleteOnly = capturedAppLeftPane?.onDeleteSession
    if (!deleteOnly) throw new Error("Expected delete callback")
    await expect(deleteOnly("only")).rejects.toThrow("sync replacement failed")
    await expect(deleteOnly("only")).resolves.toBeUndefined()

    expect(create).toHaveBeenCalledTimes(2)
    expect(remove).toHaveBeenCalledOnce()
  })

  it("makes saved session callbacks inert across source and enablement commits", async () => {
    const autoSubmitSettled = vi.fn()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ reloaded: true }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    const alpha = {
      create: vi.fn(() => ({ id: "alpha-created", agentTypeId: "alpha" })),
      switch: vi.fn(),
      delete: vi.fn(),
    }
    let betaCreateCount = 0
    const beta = {
      create: vi.fn(async () => ({ id: `beta-created-${++betaCreateCount}`, agentTypeId: "beta" })),
      switch: vi.fn(),
      delete: vi.fn(),
    }
    let betaEnabledIdentity: string | undefined
    let betaDisabledIdentity: string | undefined

    function Harness() {
      const [source, setSource] = useState<"alpha" | "beta">("alpha")
      const [betaReady, setBetaReady] = useState(false)
      const [provision, setProvision] = useState(true)
      const useSessions: UseWorkspaceAgentSessions = (options) => {
        const actions = source === "alpha" ? alpha : beta
        const ready = source === "alpha" || betaReady
        if (source === "beta" && ready) {
          if (options.enabled === false) betaDisabledIdentity = options.sourceIdentity
          else betaEnabledIdentity = options.sourceIdentity
        }
        const session = { id: `${source}-row`, agentTypeId: source, title: `${source} row` }
        return {
          sourceIdentity: ready ? options.sourceIdentity : undefined,
          sessions: ready ? [session] : [],
          activeSession: ready ? session : undefined,
          activeSessionId: ready ? session.id : undefined,
          loading: !ready,
          ...actions,
        }
      }
      return (
        <>
          <button type="button" onClick={() => setSource("beta")}>Switch source</button>
          <button type="button" onClick={() => setBetaReady(true)}>Settle beta</button>
          <button type="button" onClick={() => setProvision((value) => !value)}>Toggle provision</button>
          <WorkspaceAgentFront
            workspaceId="action-ownership"
            agentTypeId={source}
            workspaceLayout="plugin-tabs"
            chatPanel={ChatPanel}
            useSessions={useSessions}
            provisionWorkspace={provision}
            chatParams={{ onAutoSubmitInitialDraftSettled: autoSubmitSettled }}
            persistenceEnabled={false}
          />
        </>
      )
    }

    render(<Harness />)
    await waitFor(() => expect(screen.getByText("Chat alpha-row")).toBeInTheDocument())
    const alphaCenterParams = capturedChatLayout?.centerParams as WorkspaceChatPanelProps | undefined
    const savedAlpha = {
      create: capturedAppLeftPane?.onCreateSession,
      switch: capturedAppLeftPane?.onSwitchSession,
      delete: capturedAppLeftPane?.onDeleteSession,
      pin: capturedAppLeftPane?.onToggleSessionPinned,
      close: capturedChatLayout?.onCloseChatPane,
      settle: alphaCenterParams?.onAutoSubmitInitialDraftSettled,
      reload: alphaCenterParams?.onReloadAgentPlugins,
    }

    fireEvent.click(screen.getByRole("button", { name: "Switch source" }))
    await waitFor(() => expect(capturedAppLeftPane?.onCreateSession).toBeUndefined())
    expect(capturedAppLeftPane?.onToggleSessionPinned).toBeUndefined()
    act(() => {
      savedAlpha.create?.()
      savedAlpha.switch?.("alpha-row", "alpha")
      savedAlpha.delete?.("alpha-row", "alpha")
      savedAlpha.pin?.("alpha-row", "alpha")
      savedAlpha.close?.("alpha-row")
      savedAlpha.settle?.()
    })
    if (!savedAlpha.reload) throw new Error("Expected source-owned reload callback")
    await expect(savedAlpha.reload()).rejects.toThrow("Session source is unavailable")
    expect(alpha.create).not.toHaveBeenCalled()
    expect(alpha.switch).not.toHaveBeenCalled()
    expect(alpha.delete).not.toHaveBeenCalled()
    expect(beta.create).not.toHaveBeenCalled()
    expect(autoSubmitSettled).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/v1/agent/reload"))).toBe(false)
    expect(capturedAppLeftPane?.pinnedSessionRefs).toEqual([])
    expect(screen.queryByText("Chat alpha-row")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Settle beta" }))
    await waitFor(() => expect(capturedAppLeftPane?.onCreateSession).toEqual(expect.any(Function)))
    const savedBeta = {
      create: capturedAppLeftPane?.onCreateSession,
      switch: capturedAppLeftPane?.onSwitchSession,
      delete: capturedAppLeftPane?.onDeleteSession,
    }

    fireEvent.click(screen.getByRole("button", { name: "Toggle provision" }))
    await waitFor(() => expect(capturedAppLeftPane?.onCreateSession).toBeUndefined())
    expect(betaDisabledIdentity).toBeTruthy()
    expect(betaDisabledIdentity).not.toBe(betaEnabledIdentity)
    act(() => {
      savedBeta.create?.()
      savedBeta.switch?.("beta-row", "beta")
      savedBeta.delete?.("beta-row", "beta")
    })
    expect(beta.create).not.toHaveBeenCalled()
    expect(beta.switch).not.toHaveBeenCalled()
    expect(beta.delete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Toggle provision" }))
    await waitFor(() => expect(capturedAppLeftPane?.onCreateSession).toEqual(expect.any(Function)))
    act(() => { capturedAppLeftPane?.onCreateSession?.() })
    await waitFor(() => expect(beta.create).toHaveBeenCalledOnce())
    await act(async () => { await Promise.resolve() })
    act(() => { capturedAppLeftPane?.onCreateSession?.() })
    await waitFor(() => expect(beta.create).toHaveBeenCalledTimes(2))
  })

  it("cancels an in-flight create when ownership disappears and allows a renewed explicit create", async () => {
    const oldCreate = (() => {
      let resolve!: (value: { id: string; agentTypeId: string }) => void
      const promise = new Promise<{ id: string; agentTypeId: string }>((nextResolve) => { resolve = nextResolve })
      return { promise, resolve }
    })()
    const create = vi.fn()
      .mockImplementationOnce(() => oldCreate.promise)
      .mockResolvedValueOnce({ id: "renewed", agentTypeId: "alpha", title: "Renewed" })

    function Harness() {
      const [ready, setReady] = useState(true)
      const session = { id: "existing", agentTypeId: "alpha", title: "Existing" }
      return (
        <>
          <button type="button" onClick={() => setReady(false)}>Lose ownership</button>
          <button type="button" onClick={() => setReady(true)}>Restore ownership</button>
          <WorkspaceAgentFront
            workspaceId="cancel-create-on-ownership-loss"
            agentTypeId="alpha"
            workspaceLayout="plugin-tabs"
            chatPanel={ChatPanel}
            useSessions={(options) => ({
              sourceIdentity: ready ? options.sourceIdentity : undefined,
              sessions: ready ? [session] : [],
              activeSessionId: ready ? session.id : undefined,
              activeSession: ready ? session : undefined,
              loading: !ready,
              create,
              switch: vi.fn(),
              delete: vi.fn(),
            })}
            persistenceEnabled={false}
          />
        </>
      )
    }

    render(<Harness />)
    await waitFor(() => expect(capturedAppLeftPane?.onCreateSession).toEqual(expect.any(Function)))
    act(() => { capturedAppLeftPane?.onCreateSession?.() })
    await waitFor(() => expect(create).toHaveBeenCalledOnce())

    fireEvent.click(screen.getByRole("button", { name: "Lose ownership" }))
    await waitFor(() => expect(capturedAppLeftPane?.onCreateSession).toBeUndefined())
    fireEvent.click(screen.getByRole("button", { name: "Restore ownership" }))
    await waitFor(() => expect(capturedAppLeftPane?.onCreateSession).toEqual(expect.any(Function)))
    act(() => { capturedAppLeftPane?.onCreateSession?.() })
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))

    act(() => { oldCreate.resolve({ id: "late", agentTypeId: "alpha" }) })
    await act(async () => { await oldCreate.promise })
    expect(create).toHaveBeenCalledTimes(2)
  })

  it("does not publish a fallback active id during terminal or unattested source transitions", async () => {
    const onActiveSessionIdChange = vi.fn()

    function Harness() {
      const [mode, setMode] = useState<"ready" | "terminal" | "source">("ready")
      const agentTypeId = mode === "source" ? "beta" : "alpha"
      const useSessions: UseWorkspaceAgentSessions = (options) => {
        if (mode === "terminal") {
          return {
            sourceIdentity: options.sourceIdentity,
            sessions: [],
            activeSessionId: undefined,
            loading: false,
            error: new Error("terminal sessions failure"),
            create: vi.fn(() => ({ id: "terminal-created" })),
            switch: vi.fn(),
            delete: vi.fn(),
          }
        }
        if (mode === "source") {
          return {
            sourceIdentity: undefined,
            sessions: [],
            activeSessionId: undefined,
            loading: false,
            create: vi.fn(() => ({ id: "source-created" })),
            switch: vi.fn(),
            delete: vi.fn(),
          }
        }
        const session = { id: "alpha-row", agentTypeId: "alpha", title: "Alpha" }
        return {
          sourceIdentity: options.sourceIdentity,
          sessions: [session],
          activeSessionId: session.id,
          activeSession: session,
          loading: false,
          create: vi.fn(() => ({ id: "ready-created", agentTypeId: "alpha" })),
          switch: vi.fn(),
          delete: vi.fn(),
        }
      }
      return (
        <>
          <button type="button" onClick={() => setMode("terminal")}>Terminal transition</button>
          <button type="button" onClick={() => setMode("source")}>Source transition</button>
          <WorkspaceAgentFront
            workspaceId="active-id-attestation"
            agentTypeId={agentTypeId}
            chatPanel={ChatPanel}
            useSessions={useSessions}
            onActiveSessionIdChange={onActiveSessionIdChange}
            persistenceEnabled={false}
          />
        </>
      )
    }

    render(<Harness />)
    await waitFor(() => expect(onActiveSessionIdChange).toHaveBeenLastCalledWith("alpha-row"))
    onActiveSessionIdChange.mockClear()

    fireEvent.click(screen.getByRole("button", { name: "Terminal transition" }))
    await waitFor(() => expect(screen.getByText("Sessions failed to load")).toBeInTheDocument())
    await act(async () => { await Promise.resolve() })
    expect(onActiveSessionIdChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Source transition" }))
    await act(async () => { await Promise.resolve() })
    expect(onActiveSessionIdChange).not.toHaveBeenCalled()
  })
})
