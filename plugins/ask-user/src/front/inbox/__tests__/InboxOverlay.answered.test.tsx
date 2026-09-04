import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { InboxOverlay } from "../InboxOverlay"

const answered = [{
  questionId: "q-gate-2",
  sessionId: "orchestrator-session",
  title: "[Farewell API] Merge approval",
  contextFirstLine: "The epic PR is open and the demo ran at the exact SHA.",
  askedAt: "2026-09-03T10:00:00.000Z",
  answeredAt: "2026-09-03T10:07:00.000Z",
  decision: "approve",
  values: { decision: "approve", notes: "Demo matched the brief." },
  status: "answered" as const,
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
  useInboxSessionTitles: () => new Map([["orchestrator-session", "[Farewell API] Orchestrator"]]),
}))
vi.mock("../workspacePendingClient", () => ({ useWorkspacePendingQuestions: () => [] }))
vi.mock("../workspaceAnsweredClient", () => ({ useWorkspaceAnsweredQuestions: () => answered }))
vi.mock("../WorkspaceInboxShellContext", () => ({
  useWorkspaceInboxShell: () => ({
    openInboxArtifact: vi.fn(() => ({ success: true as const })),
    openDetachedChat: vi.fn(() => ({ success: true as const })),
  }),
}))

describe("InboxOverlay Answered tab", () => {
  it("keeps answered decisions out of the open tabs and shows them under Answered", async () => {
    const user = userEvent.setup()
    render(<InboxOverlay onClose={() => undefined} />)

    // The open queue is empty; the decision must not sit in it as a to-do.
    expect(screen.getByText("Inbox zero")).toBeInTheDocument()
    expect(screen.queryByText("[Farewell API] Merge approval")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /^Answered/ }))

    const row = screen.getByText("[Farewell API] Merge approval").closest<HTMLElement>("[role=button]")
    expect(row).not.toBeNull()
    expect(row!).toHaveTextContent("approve")
    expect(row!).toHaveTextContent("[Farewell API] Orchestrator")

    // The badge is toned from the workspace token contract, not a palette class
    // the host app's Tailwind build would never generate for this plugin.
    const badge = screen.getAllByText("approve").find((node) => node.className.includes("rounded-full"))
    expect(badge?.getAttribute("style")).toContain("var(--success)")

    // Expanding shows what was asked and the notes the owner wrote.
    await user.click(row!)
    expect(screen.getByText("The epic PR is open and the demo ran at the exact SHA.")).toBeInTheDocument()
    expect(screen.getByText("Demo matched the brief.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open the session that asked" })).toBeInTheDocument()
  })
})
