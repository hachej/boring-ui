import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { TopBar } from "../TopBar"

describe("TopBar", () => {
  it("renders the provided right-side chrome", () => {
    render(<TopBar topBarRight={<div data-testid="sentinel-slot">User menu</div>} />)

    expect(screen.getByTestId("sentinel-slot")).toBeInTheDocument()
  })

  it("renders no host chrome when topBarRight is omitted", () => {
    render(<TopBar />)

    expect(screen.queryByTestId("sentinel-slot")).toBeNull()
  })

  it("shows only the session/workspace title in the default title block", () => {
    render(<TopBar appTitle="Boring UI" sessionTitle="boring-ui-factory" />)

    expect(screen.getByText("boring-ui-factory")).toBeInTheDocument()
    expect(screen.queryByText("Boring UI")).not.toBeInTheDocument()
  })

  it("names the owning Agent beside the chat title", () => {
    render(<TopBar appTitle="Boring UI" sessionTitle="Planning" sessionAgentLabel="Coder" />)

    const label = document.querySelector('[data-boring-workspace-part="topbar-agent"]')
    expect(label).toHaveTextContent("Coder")
    // Quiet secondary treatment that truncates rather than pushing the search
    // and avatar controls out of the bar.
    expect(label?.className).toContain("text-[11px]")
    expect(label?.className).toContain("text-muted-foreground")
    expect(label?.className).toContain("truncate")
    expect(label?.className).toContain("min-w-0")
    // The title stays primary and gives up its width first.
    expect(screen.getByText("Planning").className).toContain("shrink-[2]")
    expect(screen.getByText("Planning").getAttribute("title")).toBe("Planning — Coder")
  })

  it("omits the Agent in a single-Agent workspace and beside a bare app title", () => {
    const { rerender } = render(<TopBar appTitle="Boring UI" sessionTitle="Planning" />)
    expect(document.querySelector('[data-boring-workspace-part="topbar-agent"]')).toBeNull()

    // No session means the bar is showing the app name; attributing the
    // workspace itself to one persona would be wrong.
    rerender(<TopBar appTitle="Boring UI" sessionAgentLabel="Coder" />)
    expect(document.querySelector('[data-boring-workspace-part="topbar-agent"]')).toBeNull()
  })

  it("pads the bar for the status-bar and notch insets", () => {
    render(<TopBar />)

    const header = screen.getByLabelText("App top bar")
    expect(header.className).toContain("env(safe-area-inset-top)")
    expect(header.className).toContain("env(safe-area-inset-left)")
    expect(header.className).toContain("env(safe-area-inset-right)")
  })

  it("tags both top-bar controls for coarse-pointer target escalation", () => {
    render(<TopBar onCommandPalette={() => {}} onNewChat={() => {}} />)

    expect(screen.getByLabelText("Search catalogs and commands").className).toContain("topbar-search-action")
    expect(screen.getByLabelText("New chat").className).toContain("topbar-icon-action")
  })

  it("tags the ⌘K badge so touch devices can drop it", () => {
    render(<TopBar onCommandPalette={() => {}} />)

    expect(screen.getByText("⌘K").className).toContain("topbar-desktop-hint")
  })
})
