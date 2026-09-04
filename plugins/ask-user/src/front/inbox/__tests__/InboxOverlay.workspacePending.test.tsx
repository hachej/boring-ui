import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { InboxOverlay } from "../InboxOverlay"

// Regression for the owner-visible bug: the Orchestrator agent session raised
// `[Factory Plugin] Merge approval`, but the browser shell never tracked that
// session, so no attention blocker survived pruning and the Inbox showed
// "Inbox zero" while the gate was pending.
const workspacePending = [{
  questionId: "q-merge",
  sessionId: "orchestrator-session",
  status: "ready" as const,
  title: "[Factory Plugin] Merge approval",
  context: "Approve the epic PR",
  artifacts: [],
  createdAt: "2026-09-03T10:00:00.000Z",
  updatedAt: "2026-09-03T10:05:00.000Z",
}]

vi.mock("@hachej/boring-workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hachej/boring-workspace")>()
  return {
    ...actual,
    useWorkspaceAttention: () => ({ blockers: [] }),
    useAppLeftOverlayChrome: () => ({ headerInsetStart: false, headerInsetEnd: false }),
    useWorkspaceShellCapabilities: () => ({ openArtifact: vi.fn(() => ({ success: true as const })) }),
  }
})

vi.mock("../../runtime", () => ({
  useQuestionsRuntime: () => ({ agentTypeId: "boring-orchestrator", apiBaseUrl: "", authHeaders: {}, activeSessionId: "browser-session" }),
}))
vi.mock("../taskProvenanceClient", () => ({ useRelatedTasks: () => new Map() }))
vi.mock("../sessionTitleClient", () => ({
  useInboxSessionTitles: () => new Map([["orchestrator-session", "[Factory Plugin] Orchestrator"]]),
}))
vi.mock("../workspacePendingClient", () => ({ useWorkspacePendingQuestions: () => workspacePending }))
vi.mock("../WorkspaceInboxShellContext", () => ({
  useWorkspaceInboxShell: () => ({
    openInboxArtifact: vi.fn(() => ({ success: true as const })),
    openDetachedChat: vi.fn(() => ({ success: true as const })),
  }),
}))

describe("InboxOverlay workspace-wide pending questions", () => {
  it("lists a pending question from an agent session the browser shell never opened", () => {
    render(<InboxOverlay onClose={() => undefined} />)

    expect(screen.queryByText("Inbox zero")).not.toBeInTheDocument()
    expect(screen.getByText("[Factory Plugin] Merge approval")).toBeInTheDocument()
    // The row names the asking agent session, so the owner knows where to answer.
    expect(screen.getByText("[Factory Plugin] Orchestrator")).toBeInTheDocument()
    expect(screen.getByLabelText("Open chat for [Factory Plugin] Orchestrator")).toBeInTheDocument()
  })
})
