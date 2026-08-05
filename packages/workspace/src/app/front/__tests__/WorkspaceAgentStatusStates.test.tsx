import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ChatSessionTransitionState, WorkbenchWarmupOverlay } from "../WorkspaceAgentStatusStates"

describe("WorkspaceAgentStatusStates", () => {
  it("uses the shared transcript and composer geometry while loading sessions", () => {
    const { container } = render(<ChatSessionTransitionState />)

    const status = screen.getByRole("status", { name: "Loading saved chats" })
    expect(status).toHaveAttribute("aria-busy", "true")
    expect(container.querySelector('[data-boring-workspace-part="transcript-loading-surface"]')).toBeInTheDocument()
    expect(container.querySelector('[data-boring-workspace-part="composer-loading-placeholder"]')).toBeInTheDocument()
  })

  it("renders workbench-shaped warmup geometry with accessible requirement copy", () => {
    const { container } = render(
      <WorkbenchWarmupOverlay status={{ status: "preparing", requirement: "sandbox-exec" }} />,
    )

    const status = screen.getByRole("status")
    expect(status).toHaveAttribute("aria-busy", "true")
    expect(screen.getByText("Preparing secure runtime…")).toBeInTheDocument()
    expect(screen.getByText(/Chat is ready while files/)).toBeInTheDocument()
    expect(container.querySelector('[data-boring-workspace-part="workbench-loading-surface"]')).toBeInTheDocument()
    expect(container.querySelector('[data-boring-workspace-part="composer-loading-placeholder"]')).not.toBeInTheDocument()
  })

  it("renders failure as an error with a reload action, not a loading skeleton", () => {
    const { container } = render(
      <WorkbenchWarmupOverlay status={{ status: "failed", message: "Runtime unavailable" }} />,
    )

    expect(screen.getByText("Workspace unavailable")).toBeInTheDocument()
    expect(screen.getByText("Runtime unavailable")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reload workspace" })).toBeInTheDocument()
    expect(container.querySelector('[data-boring-workspace-part="workbench-loading-surface"]')).not.toBeInTheDocument()
  })
})
