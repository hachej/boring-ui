import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { createElement, type ComponentType } from "react"

// Capture the props handed to DockviewReact so we can assert the rendering
// contract that keeps chat panes mounted across activation. The real dockview
// component needs a DOM grid engine we don't exercise here, so it is mocked.
const dockviewProps = vi.fn()
let dockviewPanelProps: Record<string, unknown> | null = null
vi.mock("dockview-react", () => ({
  DockviewReact: (props: Record<string, unknown>) => {
    dockviewProps(props)
    if (!dockviewPanelProps) return null
    const components = props.components as Record<string, ComponentType<Record<string, unknown>>>
    return createElement(components["chat-pane"], dockviewPanelProps)
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

  it("uses the adopted session id when a retained panel still carries its local id", () => {
    dockviewPanelProps = { api: { id: "local-1" } }
    const onActivePaneChange = vi.fn()

    render(
      <ChatPaneStageDock
        panes={[{ id: "native-1", viewId: "local-1", title: "Native session" }]}
        activePaneId="native-1"
        onActivePaneChange={onActivePaneChange}
        renderPane={(pane) => <div>{pane.id}</div>}
      />,
    )

    const pane = screen.getByLabelText("Chat session Native session")
    expect(pane).toHaveAttribute("data-boring-state", "active")
    fireEvent.mouseDown(pane)
    expect(onActivePaneChange).toHaveBeenCalledWith("native-1")
    dockviewPanelProps = null
  })
})
