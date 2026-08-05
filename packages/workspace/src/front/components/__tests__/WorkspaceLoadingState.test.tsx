import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { WorkspaceLoadingState } from "../WorkspaceLoadingState"

describe("WorkspaceLoadingState", () => {
  it("renders the default loading copy as an accessible status", () => {
    const { container } = render(<WorkspaceLoadingState />)

    const status = screen.getByRole("status")
    expect(status).toHaveAttribute("aria-busy", "true")
    expect(screen.getByText("Loading workspace")).toBeInTheDocument()
    expect(screen.getByText("Preparing the workspace context.")).toBeInTheDocument()
    expect(container.querySelector('[data-boring-workspace-part="transcript-loading-surface"]')).toBeInTheDocument()
    expect(container.querySelector('[data-boring-workspace-part="composer-loading-placeholder"]'))
      .toHaveClass("min-h-[var(--composer-input-group-height)]")
  })

  it("renders custom copy", () => {
    render(
      <WorkspaceLoadingState
        title="Switching workspace"
        description="Restoring files, sessions, and layout."
        status="Loading workspace"
      />,
    )

    expect(screen.getByText("Switching workspace")).toBeInTheDocument()
    expect(screen.getByText("Restoring files, sessions, and layout.")).toBeInTheDocument()
    expect(screen.getByText("Loading workspace")).toBeInTheDocument()
  })

  it("can render inside a bounded container", () => {
    const { container } = render(
      <WorkspaceLoadingState fullscreen={false} className="custom-loading" />,
    )

    const root = container.querySelector(".custom-loading")
    expect(root).toBeInTheDocument()
    expect(root).toHaveClass("min-h-[240px]")
    expect(root).not.toHaveClass("min-h-screen")
  })
})
