import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import type { ComponentType } from "react"

// Capture the props handed to DockviewReact so we can assert the rendering
// contract that keeps chat panes mounted across activation. The real dockview
// component needs a DOM grid engine we don't exercise here, so it is mocked.
const dockviewProps = vi.fn()
vi.mock("dockview-react", () => ({
  DockviewReact: (props: Record<string, unknown>) => {
    dockviewProps(props)
    const Header = props.defaultTabComponent as ComponentType<{ api: { id: string; title: string; onDidTitleChange: () => { dispose: () => void } } }> | undefined
    if (!Header) return null
    return (
      <div>
        {["a", "b"].map((id) => (
          <Header
            key={id}
            api={{
              id,
              title: id.toUpperCase(),
              onDidTitleChange: () => ({ dispose: () => {} }),
            }}
          />
        ))}
      </div>
    )
  },
}))
// Side-effect CSS imports the component pulls in; no-op them under vitest.
vi.mock("dockview-react/dist/styles/dockview.css", () => ({}))
vi.mock("../dock/dockview-overrides.css", () => ({}))
vi.mock("../chat-pane-stage.css", () => ({}))

import { ChatPaneStageDock } from "../ChatPaneStageDock"

describe("ChatPaneStageDock", () => {
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
