import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkspaceAttentionBlocker } from "@hachej/boring-workspace"
import { InboxOverlay } from "../InboxOverlay"

const openArtifact = vi.hoisted(() => vi.fn(() => ({ success: true as const })))
const openInboxArtifact = vi.hoisted(() => vi.fn(() => ({ success: true as const })))
const blocker: WorkspaceAttentionBlocker = {
  id: "ask-user:s1:q1",
  reason: "ask-user.question",
  surfaceKind: "questions",
  target: "q1",
  label: "Need input",
  agentTypeId: "alpha",
  sessionId: "s1",
  pruneWhenSessionMissing: true,
  sessionBadge: { kind: "question", label: "question", priority: 10 },
  inbox: { kind: "question" as const, sourceLabel: "question", artifacts: [] },
}
const blockers: WorkspaceAttentionBlocker[] = [blocker]

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
vi.mock("../sessionTitleClient", () => ({ useInboxSessionTitles: () => new Map([["s1", "Session one"], ["s2", "Session two"]]) }))
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
    expect(screen.getByText("Session one")).toBeInTheDocument()
    expect(screen.queryByText(/Session s1/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/s1/)).not.toBeInTheDocument()
    expect(screen.getByLabelText("Open chat for Session one")).toBeInTheDocument()
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

  it("separates human-first titles from correlation chips and renders Markdown context", async () => {
    const user = userEvent.setup()
    blockers.splice(0, blockers.length, {
      ...blocker,
      label: "Merge: inline artifacts in chat",
      inbox: {
        kind: "approval",
        sourceLabel: "merge",
        intentKind: "merge",
        correlationId: "wt-391-forward-gb0o.2 · PR #1301",
        context: "## What changed\nArtifacts now stay **inline**.\n\n## Test steps\n1. Open Inbox.\n2. Expand this row.",
        artifacts: [],
      },
    })
    render(<InboxOverlay onClose={() => undefined} />)

    expect(screen.getByText("Merge: inline artifacts in chat")).toBeInTheDocument()
    expect(screen.getByText("wt-391-forward-gb0o.2 · PR #1301")).toBeInTheDocument()
    expect(screen.getByText("merge")).toBeInTheDocument()
    await user.click(screen.getByText("Merge: inline artifacts in chat").closest<HTMLElement>("[role=button]")!)
    expect(screen.getByRole("heading", { name: "What changed" })).toBeInTheDocument()
    expect(screen.getByText("inline").tagName).toBe("STRONG")
    expect(screen.getByText("inline")).toHaveClass("font-semibold")
    expect(screen.getByRole("heading", { name: "Test steps" })).toBeInTheDocument()
    expect(screen.getByText("Expand this row.")).toBeInTheDocument()
  })

  it("turns a legacy bead-prefixed title into a readable subject plus chip", async () => {
    blockers.splice(0, blockers.length, { ...blocker, label: "[br-123] Merge approval: legacy card" })
    render(<InboxOverlay onClose={() => undefined} />)

    expect(screen.getByText("Merge approval: legacy card")).toBeInTheDocument()
    expect(screen.getByText("br-123")).toBeInTheDocument()
    expect(screen.queryByText("[br-123] Merge approval: legacy card")).not.toBeInTheDocument()
  })

  it("keeps legacy plain-text context line breaks readable", async () => {
    const user = userEvent.setup()
    blockers.splice(0, blockers.length, {
      ...blocker,
      inbox: { kind: "question", sourceLabel: "question", ...blocker.inbox, context: "Proof: 41 tests green.\nRisk: revert the commit." },
    })
    render(<InboxOverlay onClose={() => undefined} />)

    await user.click(screen.getByText("Need input").closest<HTMLElement>("[role=button]")!)
    const context = screen.getByTestId("ask-user-markdown")
    expect(context).toHaveTextContent("Proof: 41 tests green. Risk: revert the commit.")
    expect(context.querySelector("p")).toHaveClass("whitespace-pre-wrap")
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
