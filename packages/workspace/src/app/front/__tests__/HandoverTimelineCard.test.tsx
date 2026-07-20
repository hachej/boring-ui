import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { WorkspaceShellCapabilitiesProvider, type WorkspaceShellCapabilities } from "../../../shared/plugins/workspaceShellCapabilities"
import { HandoverTimelineCard } from "../HandoverTimelineCard"

const artifact = { id: "plan", surfaceKind: "workspace.open.path", target: "docs/plan.md", title: "Plan" }
const handover = {
  id: "handover:native-done",
  runId: "u",
  terminalEntryId: "native-done",
  artifacts: [artifact],
}

function capabilities(openArtifact: WorkspaceShellCapabilities["openArtifact"]): WorkspaceShellCapabilities {
  return {
    openArtifact,
    openDetachedChat: vi.fn(() => ({ success: false as const, reason: "open-failed" as const, message: "unused" })),
    openFullChat: vi.fn(() => ({ success: false as const, reason: "open-failed" as const, message: "unused" })),
    openInboxItem: vi.fn(() => ({ success: false as const, reason: "open-failed" as const, message: "unused" })),
    revealWorkspacePath: vi.fn(() => ({ success: false as const, reason: "open-failed" as const, message: "unused" })),
    openBrowserLocalDetachedChat: vi.fn(() => ({ success: false as const, reason: "open-failed" as const, message: "unused" })),
  }
}

describe("HandoverTimelineCard", () => {
  it("renders a distinct terminal card and routes explicit artifact opening through shell capabilities", async () => {
    const user = userEvent.setup()
    const openArtifact = vi.fn(() => ({ success: true as const }))
    render(
      <WorkspaceShellCapabilitiesProvider value={capabilities(openArtifact)}>
        <HandoverTimelineCard handover={handover} sessionId="native-session" />
      </WorkspaceShellCapabilitiesProvider>,
    )

    expect(screen.getByRole("region", { name: "Handover" })).toHaveTextContent("Reviewable outputs from this completed run")
    await user.click(screen.getByRole("button", { name: "Open Plan" }))
    expect(openArtifact).toHaveBeenCalledWith({ type: "surface", surfaceKind: "workspace.open.path", target: "docs/plan.md" }, {
      sessionId: "native-session",
      title: "Plan",
      instanceId: "human-artifact:plan",
    })
  })

  it("marks an artifact unavailable when its registered surface cannot open", async () => {
    const user = userEvent.setup()
    const openArtifact = vi.fn(() => ({ success: false as const, reason: "no-artifact" as const, message: "missing" }))
    render(
      <WorkspaceShellCapabilitiesProvider value={capabilities(openArtifact)}>
        <HandoverTimelineCard handover={handover} sessionId="native-session" />
      </WorkspaceShellCapabilitiesProvider>,
    )
    await user.click(screen.getByRole("button", { name: "Open Plan" }))
    expect(screen.getByLabelText("Plan unavailable")).toHaveTextContent("Unavailable")
  })
})
