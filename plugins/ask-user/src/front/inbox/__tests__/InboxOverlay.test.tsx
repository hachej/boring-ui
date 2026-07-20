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

vi.mock("../../runtime", () => ({
  useQuestionsRuntime: () => ({ apiBaseUrl: "", authHeaders: {}, activeSessionId: "s1" }),
}))

vi.mock("../taskProvenanceClient", () => ({ useRelatedTasks: () => new Map() }))
vi.mock("../InboxDetailPanel", () => ({
  InboxDetailPanel: ({ params }: { params?: { itemId?: string } }) => <div>Inline detail {params?.itemId}</div>,
}))

vi.mock("../WorkspaceInboxShellContext", () => ({
  useWorkspaceInboxShell: () => ({
    openInboxArtifact: vi.fn(() => ({ success: true as const })),
    openDetachedChat: vi.fn(() => ({ success: true as const })),
  }),
}))

describe("InboxOverlay", () => {
  it("selects an inline Human Intention without auto-opening Questions or Chat", async () => {
    const user = userEvent.setup()
    openArtifact.mockClear()
    render(<InboxOverlay onClose={() => undefined} />)

    const row = screen.getByText("Need input").closest<HTMLElement>("[role=button]")
    expect(row).not.toBeNull()
    await user.click(row!)

    expect(screen.getByText("Inline detail ask-user:s1:q1")).toBeInTheDocument()
    expect(openArtifact).not.toHaveBeenCalled()
  })
})
