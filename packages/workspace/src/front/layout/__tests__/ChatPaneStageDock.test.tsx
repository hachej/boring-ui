import { describe, expect, it, vi } from "vitest"
import { act, render } from "@testing-library/react"

// Capture the props handed to DockviewReact so we can assert the rendering
// contract that keeps chat panes mounted across activation. The real dockview
// component needs a DOM grid engine we don't exercise here, so it is mocked.
const dockviewProps = vi.fn()
vi.mock("dockview-react", () => ({
  DockviewReact: (props: Record<string, unknown>) => {
    dockviewProps(props)
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
