import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import type { WorkspaceChatPanelProps } from "../../../front/chrome/chat/types"
import type { AppLeftPaneProps } from "../../../front/layout/plugin-tabs/AppLeftPane"

let capturedAppLeftPane: AppLeftPaneProps | undefined

vi.mock("../../../front/layout/plugin-tabs/AppLeftPane", () => ({
  AppLeftPane: (props: AppLeftPaneProps) => {
    capturedAppLeftPane = props
    return <div data-testid="captured-app-left" />
  },
}))

import { WorkspaceAgentFront, type UseWorkspaceAgentSessions } from "../WorkspaceAgentFront"

function ChatPanel(props: WorkspaceChatPanelProps) {
  return <div data-testid="chat-pane">Chat {props.sessionId}</div>
}

describe("WorkspaceAgentFront session action ownership", () => {
  it("makes saved create, switch, and delete callbacks inert across source and enablement commits", async () => {
    const alpha = {
      create: vi.fn(),
      switch: vi.fn(),
      delete: vi.fn(),
    }
    const beta = {
      create: vi.fn(),
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
            persistenceEnabled={false}
          />
        </>
      )
    }

    render(<Harness />)
    await waitFor(() => expect(screen.getByText("Chat alpha-row")).toBeInTheDocument())
    const savedAlpha = {
      create: capturedAppLeftPane?.onCreateSession,
      switch: capturedAppLeftPane?.onSwitchSession,
      delete: capturedAppLeftPane?.onDeleteSession,
    }

    fireEvent.click(screen.getByRole("button", { name: "Switch source" }))
    await waitFor(() => expect(capturedAppLeftPane?.onCreateSession).toBeUndefined())
    act(() => {
      savedAlpha.create?.()
      savedAlpha.switch?.("alpha-row", "alpha")
      savedAlpha.delete?.("alpha-row", "alpha")
    })
    expect(alpha.create).not.toHaveBeenCalled()
    expect(alpha.switch).not.toHaveBeenCalled()
    expect(alpha.delete).not.toHaveBeenCalled()
    expect(beta.create).not.toHaveBeenCalled()
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
    await act(async () => { await Promise.resolve() })
    act(() => { capturedAppLeftPane?.onCreateSession?.() })
    expect(beta.create).toHaveBeenCalledTimes(2)
  })
})
