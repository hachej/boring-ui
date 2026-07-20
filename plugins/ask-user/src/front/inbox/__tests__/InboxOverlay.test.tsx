import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { InboxOverlay } from "../InboxOverlay"

const openArtifact = vi.hoisted(() => vi.fn(() => ({ success: true as const })))
const blocker = {
  id: "ask-user:s1:q1",
  reason: "ask-user.question",
  surfaceKind: "ask-user.questions",
  target: "q1",
  label: "Need input",
  sessionId: "s1",
  pruneWhenSessionMissing: true,
  sessionBadge: { kind: "question", label: "question", priority: 10 },
  inbox: { kind: "question" as const, sourceLabel: "question", artifacts: [] },
}

vi.mock("@hachej/boring-workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hachej/boring-workspace")>()
  return {
    ...actual,
    useWorkspaceAttention: () => ({ blockers: [blocker] }),
    useAppLeftOverlayChrome: () => ({ headerInsetStart: false, headerInsetEnd: false }),
    useWorkspaceShellCapabilities: () => ({ openArtifact }),
  }
})

vi.mock("../WorkspaceInboxShellContext", () => ({
  useWorkspaceInboxShell: () => ({
    openInboxArtifact: vi.fn(() => ({ success: true as const })),
    openDetachedChat: vi.fn(() => ({ success: true as const })),
  }),
}))

describe("InboxOverlay", () => {
  it("opens the blocking question surface when its row is explicitly selected", async () => {
    const user = userEvent.setup()
    openArtifact.mockClear()
    render(<InboxOverlay onClose={() => undefined} />)

    const row = screen.getByText("Need input").closest<HTMLElement>("[role=button]")
    expect(row).not.toBeNull()
    await user.click(row!)

    expect(openArtifact).toHaveBeenCalledWith({
      type: "surface",
      surfaceKind: "ask-user.questions",
      target: "q1",
    }, {
      sessionId: "s1",
      title: "Need input",
      instanceId: "ask-user:s1:q1",
    })
  })
})
