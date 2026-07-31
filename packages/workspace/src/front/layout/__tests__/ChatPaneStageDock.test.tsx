import { afterEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
import type { ComponentType } from "react"

// Capture the props handed to DockviewReact so we can assert the rendering
// contract that keeps chat panes mounted across activation. The real dockview
// component needs a DOM grid engine we don't exercise here, so it is mocked.
const dockviewProps = vi.fn()
let renderedDockviewPaneId: string | null = null
vi.mock("dockview-react", () => ({
  DockviewReact: (props: Record<string, unknown>) => {
    dockviewProps(props)
    if (renderedDockviewPaneId) {
      const components = props.components as Record<string, React.FunctionComponent<{
        params: { paneId: string }
        api: { id: string }
      }>>
      const Component = components["chat-pane"]
      return <Component params={{ paneId: renderedDockviewPaneId }} api={{ id: renderedDockviewPaneId }} />
    }
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

import { ChatPaneStageDock } from "../ChatPaneStageDock"
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
  afterEach(() => {
    renderedDockviewPaneId = null
  })

  it("decodes an addressed drop before opening the native session", () => {
    const onDrop = vi.fn()
    expect(dispatchChatSessionDragPayload(
      JSON.stringify({ version: 1, sessionId: "shared", agentTypeId: "beta" }),
      onDrop,
    )).toEqual({ sessionId: "shared", agentTypeId: "beta" })
    expect(onDrop).toHaveBeenCalledWith("shared", "beta")
  })

  it('mounts panes with the "always" renderer so switching panes preserves scroll (#276)', () => {
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

    // The default "onlyWhenVisible" renderer detaches and re-appends a group's
    // content element on activation, which resets the transcript scroll
    // container's scrollTop to 0. "always" keeps it mounted in place.
    expect(dockviewProps).toHaveBeenCalled()
    expect(dockviewProps.mock.calls[0][0]).toMatchObject({ defaultRenderer: "always" })
  })

  it("discards a persisted tab stack so every restored chat gets its own split group", () => {
    localStorage.setItem("split-stage:chatPaneLayout", JSON.stringify({
      grid: {
        root: {
          type: "leaf",
          data: {
            id: "legacy-tab-group",
            views: ["alpha-session", "beta-session"],
            activeView: "beta-session",
          },
        },
        height: 600,
        width: 1200,
        orientation: "HORIZONTAL",
      },
      panels: {
        "alpha-session": { id: "alpha-session" },
        "beta-session": { id: "beta-session" },
      },
    }))
    dockviewProps.mockClear()
    render(
      <ChatPaneStageDock
        panes={[
          { id: "alpha-session", title: "Alpha" },
          { id: "beta-session", title: "Beta" },
        ]}
        activePaneId="beta-session"
        storageKey="split-stage"
        renderPane={(pane) => <div>{pane.id}</div>}
      />,
    )

    interface TestPanel {
      id: string
      title: string
      api: {
        renderer: string
        setActive: ReturnType<typeof vi.fn>
        setTitle: ReturnType<typeof vi.fn>
      }
      group: { api: { setConstraints: ReturnType<typeof vi.fn> } }
    }
    const panels: TestPanel[] = []
    const addPanel = vi.fn((options: { id: string; title: string }) => {
      const panel = {
        id: options.id,
        title: options.title,
        api: {
          renderer: "onlyWhenVisible",
          setActive: vi.fn(),
          setTitle: vi.fn(),
        },
        group: { api: { setConstraints: vi.fn() } },
      }
      panels.push(panel)
      return panel
    })
    const disposable = () => ({ dispose: vi.fn() })
    const api = {
      panels,
      getPanel: (id: string) => panels.find((panel) => panel.id === id),
      addPanel,
      removePanel: vi.fn(),
      fromJSON: vi.fn(),
      onDidActivePanelChange: disposable,
      onWillShowOverlay: disposable,
      onUnhandledDragOver: disposable,
      onDidDrop: disposable,
      onDidLayoutChange: disposable,
    }

    const onReady = dockviewProps.mock.calls[0][0].onReady as (event: { api: unknown }) => void
    act(() => onReady({ api }))

    expect(api.fromJSON).not.toHaveBeenCalled()
    expect(addPanel).toHaveBeenNthCalledWith(1, expect.objectContaining({
      id: "alpha-session",
      position: undefined,
    }))
    expect(addPanel).toHaveBeenNthCalledWith(2, expect.objectContaining({
      id: "beta-session",
      position: {
        referencePanel: expect.objectContaining({ id: "alpha-session" }),
        direction: "right",
      },
    }))
  })

  it("does not re-activate an already-active pane during composer gestures", () => {
    renderedDockviewPaneId = "alpha-session"
    const onActivePaneChange = vi.fn()
    render(
      <ChatPaneStageDock
        panes={[
          { id: "alpha-session", title: "Alpha" },
          { id: "beta-session", title: "Beta" },
        ]}
        activePaneId="alpha-session"
        onActivePaneChange={onActivePaneChange}
        renderPane={() => <button type="button">Submit Alpha</button>}
      />,
    )

    const submit = screen.getByRole("button", { name: "Submit Alpha" })
    fireEvent.focus(submit)
    fireEvent.mouseDown(submit)

    expect(onActivePaneChange).not.toHaveBeenCalled()
  })

  it("repairs a Dockview active pane that remains hidden after a session replacement", () => {
    dockviewProps.mockClear()
    render(
      <ChatPaneStageDock
        panes={[{ id: "native-1", title: "Native" }]}
        activePaneId="native-1"
        renderPane={(pane) => <div>{pane.id}</div>}
      />,
    )

    const setActive = vi.fn()
    const setRenderer = vi.fn()
    const activePaneElement = {
      dataset: { boringPaneId: "native-1" },
    } as unknown as HTMLElement
    const panelWindow = {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        callback(0)
        return 1
      },
      document: {
        querySelectorAll: () => [activePaneElement],
      },
      getComputedStyle: () => ({ visibility: "hidden" }),
    }
    const panel = {
      id: "native-1",
      title: "Native",
      api: {
        renderer: "always",
        setActive,
        setRenderer,
        setTitle: vi.fn(),
        getWindow: () => panelWindow,
      },
    }
    const disposable = () => ({ dispose: vi.fn() })
    const api = {
      panels: [panel],
      getPanel: (id: string) => id === panel.id ? panel : undefined,
      removePanel: vi.fn(),
      onDidActivePanelChange: disposable,
      onWillShowOverlay: disposable,
      onUnhandledDragOver: disposable,
      onDidDrop: disposable,
      onDidLayoutChange: disposable,
    }

    const onReady = dockviewProps.mock.calls[0][0].onReady as (event: { api: unknown }) => void
    act(() => onReady({ api }))

    expect(setActive).toHaveBeenCalledOnce()
    expect(setRenderer).toHaveBeenCalledWith("onlyWhenVisible")
  })

  it("renders chat top actions in every pane header, not only the active pane", () => {
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

    expect(screen.getAllByRole("button", { name: "Pane menu" })).toHaveLength(2)
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

  it("wires vertical and horizontal split controls to the pane they belong to", () => {
    const splitPane = vi.fn()
    render(
      <ChatPaneStageDock
        panes={[
          { id: "a", title: "A" },
          { id: "b", title: "B" },
        ]}
        activePaneId="a"
        onSplitPane={splitPane}
        renderPane={(pane) => <div>{pane.id}</div>}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Split A chat vertically" }))
    fireEvent.click(screen.getByRole("button", { name: "Split B chat horizontally" }))

    expect(splitPane).toHaveBeenNthCalledWith(1, "a", "right")
    expect(splitPane).toHaveBeenNthCalledWith(2, "b", "below")
  })
})
