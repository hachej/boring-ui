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
