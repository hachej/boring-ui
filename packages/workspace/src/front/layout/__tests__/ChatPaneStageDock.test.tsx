import { describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"

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
})
