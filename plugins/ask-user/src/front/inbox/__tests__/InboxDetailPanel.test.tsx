import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { InboxDetailPanel } from "../InboxDetailPanel"

const artifact = { id: "plan", surfaceKind: "workspace.open.path", target: "docs/plan.md", title: "Plan" }
const blocker = {
  id: "ask-user:s1:q1",
  reason: "ask-user.question",
  surfaceKind: "ask-user.questions",
  target: "q1",
  label: "Choose",
  sessionId: "s1",
  pruneWhenSessionMissing: true,
  sessionBadge: { kind: "question", label: "question", priority: 10 },
  inbox: { kind: "question" as const, sourceLabel: "question", artifacts: [artifact] },
}
const pending = {
  questionId: "q1",
  sessionId: "s1",
  ownerPrincipalId: "user",
  status: "ready" as const,
  title: "Choose",
  artifacts: [artifact],
  answerToken: "token",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  schema: { wireVersion: 1 as const, fields: [{ type: "text" as const, name: "answer", label: "Answer", required: true }] },
}
const submit = vi.hoisted(() => vi.fn(async () => ({ ok: true, status: "answered" })))
const cancel = vi.hoisted(() => vi.fn(async () => ({ ok: true, status: "cancelled" })))
type ShellResult = { success: true } | { success: false; reason: "open-failed"; message: string }
const openInboxArtifact = vi.hoisted(() => vi.fn((): ShellResult => ({ success: true })))
const openDetachedChat = vi.hoisted(() => vi.fn((): ShellResult => ({ success: true })))
const setPending = vi.hoisted(() => vi.fn())

vi.mock("@hachej/boring-workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hachej/boring-workspace")>()
  return { ...actual, useWorkspaceAttention: () => ({ blockers: [blocker] }) }
})
vi.mock("../../runtime", () => ({
  useQuestionsRuntime: () => ({
    apiBaseUrl: "",
    authHeaders: {},
    subscribe: () => () => undefined,
    getPending: (sessionId: string) => sessionId === "s1" ? pending : null,
    setPending,
  }),
}))
vi.mock("../../client", () => ({ createQuestionsClient: () => ({ submit, cancel }) }))
vi.mock("../WorkspaceInboxShellContext", () => ({
  useWorkspaceInboxShell: () => ({ openInboxArtifact, openDetachedChat }),
}))

describe("InboxDetailPanel", () => {
  beforeEach(() => {
    submit.mockClear()
    cancel.mockClear()
    openInboxArtifact.mockReset().mockReturnValue({ success: true })
    openDetachedChat.mockReset().mockReturnValue({ success: true })
    setPending.mockClear()
  })

  it("keeps the live form, tasks, artifacts, and exact chat actions independent", async () => {
    const user = userEvent.setup()
    render(<InboxDetailPanel
      params={{ itemId: blocker.id }}
      relatedTasks={[
        { adapterId: "github", taskId: "1", number: "#1", title: "First", statusId: "todo", url: "https://example.test/1" },
        { adapterId: "github", taskId: "2", number: "#2", title: "Second", statusId: "done" },
      ]}
    />)

    expect(screen.getByRole("link", { name: "Open task #1 First" })).toHaveAttribute("href", "https://example.test/1")
    expect(screen.getByText("#2")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Open Plan" }))
    expect(openInboxArtifact).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "s1" }), artifact)
    expect(submit).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Open chat" }))
    expect(openDetachedChat).toHaveBeenCalledWith("s1", { title: "Choose" })

    await user.type(screen.getByRole("textbox", { name: "Answer" }), "Ship it")
    await user.click(screen.getByRole("button", { name: "Send answers" }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith(pending, { answer: "Ship it" }))
    expect(setPending).toHaveBeenCalledWith(null, "s1")
  })

  it("surfaces exact shell action failures inline", async () => {
    const user = userEvent.setup()
    openInboxArtifact.mockReturnValueOnce({ success: false, reason: "open-failed", message: "Could not open Plan" })
    render(<InboxDetailPanel params={{ itemId: blocker.id }} />)
    await user.click(screen.getByRole("button", { name: "Open Plan" }))
    expect(screen.getByText("Could not open Plan")).toBeInTheDocument()
  })
})
