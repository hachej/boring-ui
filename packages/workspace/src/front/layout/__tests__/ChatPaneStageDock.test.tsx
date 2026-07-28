import { afterEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"

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
    return null
  },
}))
// Side-effect CSS imports the component pulls in; no-op them under vitest.
vi.mock("dockview-react/dist/styles/dockview.css", () => ({}))
vi.mock("../dock/dockview-overrides.css", () => ({}))
vi.mock("../chat-pane-stage.css", () => ({}))

import { ChatPaneStageDock } from "../ChatPaneStageDock"
import { dispatchChatSessionDragPayload } from "../ChatPaneStage"

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
})
