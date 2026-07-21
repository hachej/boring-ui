import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { InboxOverlay } from "../InboxOverlay"

const openArtifact = vi.hoisted(() => vi.fn(() => ({ success: true as const })))
const openInboxArtifact = vi.hoisted(() => vi.fn(() => ({ success: true as const })))
const blocker = {
  id: "ask-user:s1:q1",
  reason: "ask-user.question",
  surfaceKind: "questions",
  target: "q1",
  label: "Need input",
  sessionId: "s1",
  pruneWhenSessionMissing: true,
  sessionBadge: { kind: "question", label: "question", priority: 10 },
  inbox: { kind: "question" as const, sourceLabel: "question", artifacts: [] },
}
const blockers = [blocker]

vi.mock("@hachej/boring-workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hachej/boring-workspace")>()
  return {
    ...actual,
    useWorkspaceAttention: () => ({ blockers }),
    useAppLeftOverlayChrome: () => ({ headerInsetStart: false, headerInsetEnd: false }),
    useWorkspaceShellCapabilities: () => ({ openArtifact }),
  }
})

vi.mock("../../runtime", () => ({
  useQuestionsRuntime: () => ({ apiBaseUrl: "", authHeaders: {}, activeSessionId: "s1" }),
}))

vi.mock("../taskProvenanceClient", () => ({ useRelatedTasks: () => new Map() }))
vi.mock("../WorkspaceInboxShellContext", () => ({
  useWorkspaceInboxShell: () => ({
    openInboxArtifact,
    openDetachedChat: vi.fn(() => ({ success: true as const })),
  }),
}))

describe("InboxOverlay", () => {
  beforeEach(() => {
    openInboxArtifact.mockClear()
    blockers.splice(0, blockers.length, blocker)
  })

  it("selects an inline Human Intention without auto-opening Questions or Chat", async () => {
    const user = userEvent.setup()
    openArtifact.mockClear()
    render(<InboxOverlay onClose={() => undefined} />)

    const row = screen.getByText("Need input").closest<HTMLElement>("[role=button]")
    expect(row).not.toBeNull()
    expect(row).toHaveAttribute("aria-expanded", "false")
    await user.click(row!)

    expect(row).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("button", { name: "Open Need input" })).toHaveTextContent("Question")
    expect(screen.getByRole("button", { name: "All 1" })).toBeInTheDocument()
    expect(openArtifact).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Open Need input" }))
    expect(openInboxArtifact).toHaveBeenCalledWith(expect.objectContaining({ id: blocker.id }), expect.objectContaining({ surfaceKind: "questions", target: "q1" }))
    expect(row).toHaveAttribute("aria-expanded", "true")

    await user.click(row!)
    expect(row).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("button", { name: "Open Need input" })).not.toBeInTheDocument()
  })

  it("keeps multiple waiting questions independently discoverable", async () => {
    const user = userEvent.setup()
    blockers.push({ ...blocker, id: "ask-user:s2:q2", target: "q2", label: "Second decision", sessionId: "s2" })
    render(<InboxOverlay onClose={() => undefined} />)

    expect(screen.getByRole("button", { name: "All 2" })).toBeInTheDocument()
    const first = screen.getByText("Need input").closest<HTMLElement>("[role=button]")!
    const second = screen.getByText("Second decision").closest<HTMLElement>("[role=button]")!
    await user.click(first)
    expect(screen.getByRole("button", { name: "Open Need input" })).toBeInTheDocument()
    await user.click(second)
    expect(screen.queryByRole("button", { name: "Open Need input" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open Second decision" })).toBeInTheDocument()
  })
})
