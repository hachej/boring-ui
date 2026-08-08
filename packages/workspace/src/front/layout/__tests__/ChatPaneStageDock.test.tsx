import { describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { useEffect, type ComponentType } from "react"

// Capture the props handed to DockviewReact so we can assert the rendering
// contract that keeps chat panes mounted across activation. The real dockview
// component needs a DOM grid engine we don't exercise here, so it is mocked.
const dockviewProps = vi.fn()
const dockviewMounts = vi.fn()
vi.mock("dockview-react", () => ({
  DockviewReact: (props: Record<string, unknown>) => {
    dockviewProps(props)
    useEffect(() => {
      dockviewMounts()
    }, [])
    type MockPanelApi = { id: string; title: string; onDidTitleChange: () => { dispose: () => void } }
    const Header = props.defaultTabComponent as ComponentType<{ api: MockPanelApi }> | undefined
    const HeaderActions = props.rightHeaderActionsComponent as ComponentType<{ activePanel: { api: MockPanelApi } }> | undefined
    if (!Header) return null
    return (
      <div>
        {["a", "b"].map((id) => {
          const api = {
            id,
            title: id.toUpperCase(),
            onDidTitleChange: () => ({ dispose: () => {} }),
          }
          return (
            <div key={id}>
              <Header api={api} />
              {HeaderActions ? <HeaderActions activePanel={{ api }} /> : null}
            </div>
          )
        })}
      </div>
    )
  },
}))
// Side-effect CSS imports the component pulls in; no-op them under vitest.
vi.mock("dockview-react/dist/styles/dockview.css", () => ({}))
vi.mock("../dock/dockview-overrides.css", () => ({}))
vi.mock("../chat-pane-stage.css", () => ({}))

import { ChatPaneStageDock, readablePaneTitle } from "../ChatPaneStageDock"
import { dispatchChatSessionDragPayload } from "../ChatPaneStage"

function mockPanel(id: string) {
  return {
    id,
    title: id,
    api: { setTitle: vi.fn(), setActive: vi.fn() },
    group: { api: { setConstraints: vi.fn() } },
  }
}

function mockDockApi(initialIds: string[]) {
  const panels = initialIds.map(mockPanel)
  const api = {
    panels,
    activePanel: panels[0],
    getPanel: vi.fn((id: string) => panels.find((panel) => panel.id === id)),
    addPanel: vi.fn((options: { id: string }) => {
      const panel = mockPanel(options.id)
      panels.push(panel)
      return panel
    }),
    removePanel: vi.fn(),
    fromJSON: vi.fn(),
    toJSON: vi.fn(() => ({})),
    onDidActivePanelChange: vi.fn(() => ({ dispose: vi.fn() })),
    onWillShowOverlay: vi.fn(() => ({ dispose: vi.fn() })),
    onUnhandledDragOver: vi.fn(() => ({ dispose: vi.fn() })),
    onDidDrop: vi.fn(() => ({ dispose: vi.fn() })),
    onDidLayoutChange: vi.fn(() => ({ dispose: vi.fn() })),
  }
  return api
}

describe("ChatPaneStageDock", () => {
  it("decodes an addressed drop before opening the native session", () => {
    const onDrop = vi.fn()
    expect(dispatchChatSessionDragPayload(
      JSON.stringify({ version: 1, sessionId: "shared", agentTypeId: "beta" }),
      onDrop,
    )).toEqual({ sessionId: "shared", agentTypeId: "beta" })
    expect(onDrop).toHaveBeenCalledWith("shared", "beta")
  })

  it("renders the active pane in Dockview's visible group", () => {
    dockviewProps.mockClear()
    render(
      <ChatPaneStageDock
        panes={[
          { id: "a", title: "A" },
          { id: "b", title: "B" },
        ]}
        activePaneId="a"
        renderPane={(pane) => <div>{pane.id}</div>}
      />,
    )

    expect(dockviewProps).toHaveBeenCalled()
    expect(dockviewProps.mock.calls[0][0]).toMatchObject({ defaultRenderer: "onlyWhenVisible" })
  })

  it("remounts Dockview when the only pane switches sessions", () => {
    dockviewMounts.mockClear()
    const { rerender } = render(
      <ChatPaneStageDock
        panes={[{ id: "a", title: "A" }]}
        activePaneId="a"
        renderPane={(pane) => <div>{pane.id}</div>}
      />,
    )
    rerender(
      <ChatPaneStageDock
        panes={[{ id: "b", title: "B" }]}
        activePaneId="b"
        renderPane={(pane) => <div>{pane.id}</div>}
      />,
    )

    expect(dockviewMounts).toHaveBeenCalledTimes(2)
  })

  it("renders chat top actions only in the active pane header", () => {
    dockviewProps.mockClear()
    render(
      <ChatPaneStageDock
        panes={[
          { id: "a", title: "A" },
          { id: "b", title: "B" },
        ]}
        activePaneId="a"
        topActions={<button type="button">Pane menu</button>}
        renderPane={(pane) => <div>{pane.id}</div>}
      />,
    )

    expect(screen.getAllByRole("button", { name: "Pane menu" })).toHaveLength(1)
  })
  it.each(["right", "below"] as const)(
    "consumes a compound-key pending %s placement beside its reference pane",
    (direction) => {
      dockviewProps.mockClear()
      const consumed = vi.fn()
      render(
        <ChatPaneStageDock
          panes={[
            { id: "agent-a::session-1", title: "A" },
            { id: "agent-b::session-2", title: "B" },
          ]}
          activePaneId="agent-b::session-2"
          pendingPanePlacement={{
            paneId: "agent-b::session-2",
            referencePaneId: "agent-a::session-1",
            direction,
          }}
          onPendingPanePlacementConsumed={consumed}
          renderPane={(pane) => <div>{pane.id}</div>}
        />,
      )
      const api = mockDockApi(["agent-a::session-1"])
      const onReady = dockviewProps.mock.calls.at(-1)?.[0].onReady as (event: { api: typeof api }) => void

      act(() => onReady({ api }))

      expect(api.addPanel).toHaveBeenCalledWith(expect.objectContaining({
        id: "agent-b::session-2",
        position: {
          referencePanel: expect.objectContaining({ id: "agent-a::session-1" }),
          direction,
        },
      }))
      expect(consumed).toHaveBeenCalledOnce()
      expect(consumed).toHaveBeenCalledWith("agent-b::session-2")
    },
  )

  it("acknowledges a stale placement without re-adding an existing pane", () => {
    dockviewProps.mockClear()
    const consumed = vi.fn()
    render(
      <ChatPaneStageDock
        panes={[{ id: "a" }, { id: "b" }]}
        pendingPanePlacement={{ paneId: "b", referencePaneId: "a", direction: "right" }}
        onPendingPanePlacementConsumed={consumed}
        renderPane={(pane) => <div>{pane.id}</div>}
      />,
    )
    const api = mockDockApi(["a", "b"])
    const onReady = dockviewProps.mock.calls.at(-1)?.[0].onReady as (event: { api: typeof api }) => void

    act(() => onReady({ api }))

    expect(api.addPanel).not.toHaveBeenCalled()
    expect(consumed).toHaveBeenCalledWith("b")
  })

  it("disables both split controls while pane creation is pending", () => {
    const splitPane = vi.fn()
    render(
      <ChatPaneStageDock
        panes={[{ id: "a", title: "A" }]}
        splitPending
        onSplitPane={splitPane}
        renderPane={(pane) => <div>{pane.id}</div>}
      />,
    )

    expect(screen.getByRole("button", { name: "Split A chat vertically" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Split A chat horizontally" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Split A chat horizontally" }))
    expect(splitPane).not.toHaveBeenCalled()
  })

  it("gives every pane its own split and close controls", () => {
    const splitPane = vi.fn()
    const closePane = vi.fn()
    render(
      <ChatPaneStageDock
        panes={[
          { id: "a", title: "A" },
          { id: "b", title: "B" },
        ]}
        activePaneId="a"
        onSplitPane={splitPane}
        onClosePane={closePane}
        renderPane={(pane) => <div>{pane.id}</div>}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Split A chat vertically" }))
    fireEvent.click(screen.getByRole("button", { name: "Split A chat horizontally" }))
    fireEvent.click(screen.getByRole("button", { name: "Split B chat vertically" }))
    fireEvent.click(screen.getByRole("button", { name: "Split B chat horizontally" }))
    fireEvent.click(screen.getByRole("button", { name: "Close A pane" }))
    fireEvent.click(screen.getByRole("button", { name: "Close B pane" }))

    expect(splitPane).toHaveBeenNthCalledWith(1, "a", "right")
    expect(splitPane).toHaveBeenNthCalledWith(2, "a", "below")
    expect(splitPane).toHaveBeenNthCalledWith(3, "b", "right")
    expect(splitPane).toHaveBeenNthCalledWith(4, "b", "below")
    expect(closePane).toHaveBeenNthCalledWith(1, "a")
    expect(closePane).toHaveBeenNthCalledWith(2, "b")
  })

  it("hides the close control on the final remaining pane but keeps split", () => {
    const closePane = vi.fn()
    render(
      <ChatPaneStageDock
        panes={[{ id: "a", title: "A" }]}
        onSplitPane={vi.fn()}
        onClosePane={closePane}
        renderPane={(pane) => <div>{pane.id}</div>}
      />,
    )

    expect(screen.queryByRole("button", { name: /Close .* pane/ })).toBeNull()
    expect(screen.getByRole("button", { name: "Split A chat vertically" })).toBeTruthy()
  })

  it("restores the close control reactively once a second pane exists", () => {
    const closePane = vi.fn()
    const { rerender } = render(
      <ChatPaneStageDock
        panes={[{ id: "a", title: "A" }]}
        onSplitPane={vi.fn()}
        onClosePane={closePane}
        renderPane={(pane) => <div>{pane.id}</div>}
      />,
    )

    expect(screen.queryByRole("button", { name: /Close .* pane/ })).toBeNull()

    rerender(
      <ChatPaneStageDock
        panes={[
          { id: "a", title: "A" },
          { id: "b", title: "B" },
        ]}
        onSplitPane={vi.fn()}
        onClosePane={closePane}
        renderPane={(pane) => <div>{pane.id}</div>}
      />,
    )

    expect(screen.getByRole("button", { name: "Close A pane" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Close B pane" })).toBeTruthy()
  })

  it("opens session actions for pin, rename, and delete", () => {
    const onTogglePin = vi.fn()
    const onRename = vi.fn()
    const onDelete = vi.fn()
    vi.spyOn(window, "confirm").mockReturnValue(true)

    render(
      <ChatPaneStageDock
        panes={[{ id: "a", title: "Planning" }]}
        sessionActions={{ isPinned: () => false, onTogglePin, onRename, onDelete }}
        renderPane={(pane) => <div>{pane.id}</div>}
      />,
    )

    fireEvent.pointerDown(screen.getByRole("button", { name: "Chat actions for A" }), { button: 0, ctrlKey: false })
    fireEvent.click(screen.getByRole("menuitem", { name: "Pin chat" }))
    expect(onTogglePin).toHaveBeenCalledWith("a")

    fireEvent.pointerDown(screen.getByRole("button", { name: "Chat actions for A" }), { button: 0, ctrlKey: false })
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete chat" }))
    expect(onDelete).toHaveBeenCalledWith("a")

    fireEvent.pointerDown(screen.getByRole("button", { name: "Chat actions for A" }), { button: 0, ctrlKey: false })
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename chat" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Chat name" }), { target: { value: "Renamed chat" } })
    fireEvent.click(screen.getByRole("button", { name: "Rename" }))
    expect(onRename).toHaveBeenCalledWith("a", "Renamed chat")
  })

  it("replaces machine session identifiers with a readable title", () => {
    const id = "agent::123e4567-e89b-12d3-a456-426614174000"
    expect(readablePaneTitle(id, id)).toBe("New chat")
    expect(readablePaneTitle("123e4567-e89b-12d3-a456-426614174000", id)).toBe("New chat")
    expect(readablePaneTitle("Quarterly planning", id)).toBe("Quarterly planning")
  })
})
