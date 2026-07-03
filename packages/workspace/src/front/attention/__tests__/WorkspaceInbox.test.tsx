import { useEffect } from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"
import {
  WORKSPACE_ATTENTION_ACTION_EVENT,
  WorkspaceAttentionProvider,
  useWorkspaceAttention,
} from "../WorkspaceAttentionProvider"
import { WORKSPACE_INBOX_DETAIL_PANEL_ID, WorkspaceInboxDetailPanel, WorkspaceInboxPane } from "../WorkspaceInbox"

function SeedBlocker({ sessionId = "session-123" }: { sessionId?: string } = {}) {
  const { addBlocker } = useWorkspaceAttention()
  useEffect(() => {
    addBlocker({
      id: `question-${sessionId}`,
      reason: "ask-user.question",
      label: "Pick the deploy target",
      sessionId,
      target: "deploy-plan.md",
      sessionBadge: { kind: "question", label: "question", tone: "attention", priority: 10 },
      actions: [{ id: "answer", label: "Answer" }],
    })
  }, [addBlocker, sessionId])
  return null
}

describe("WorkspaceInboxPane", () => {
  test("renders attention blockers, opens detail panel, and emits action events", () => {
    const onAction = vi.fn()
    window.addEventListener(WORKSPACE_ATTENTION_ACTION_EVENT, onAction)

    const addPanel = vi.fn()

    render(
      <WorkspaceAttentionProvider>
        <SeedBlocker />
        <WorkspaceInboxPane containerApi={{ addPanel } as never} />
        <WorkspaceInboxDetailPanel params={{ blockerId: "question-session-123" }} api={{} as never} containerApi={{} as never} />
      </WorkspaceAttentionProvider>,
    )

    expect(screen.getAllByText("Pick the deploy target").length).toBeGreaterThan(0)
    expect(screen.getAllByText("question").length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Session session-123/).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole("button", { name: /Pick the deploy target/ }))
    expect(addPanel).toHaveBeenCalledWith(expect.objectContaining({
      component: WORKSPACE_INBOX_DETAIL_PANEL_ID,
      params: { blockerId: "question-session-123" },
      title: "Pick the deploy target",
    }))

    fireEvent.click(screen.getByRole("button", { name: "Answer" }))

    expect(onAction).toHaveBeenCalledTimes(1)
    expect((onAction.mock.calls[0]?.[0] as CustomEvent).detail).toMatchObject({
      blockerId: "question-session-123",
      actionId: "answer",
      sessionId: "session-123",
    })

    window.removeEventListener(WORKSPACE_ATTENTION_ACTION_EVENT, onAction)
  })

  test("removes session-scoped inbox entries whose sessions no longer exist", async () => {
    render(
      <WorkspaceAttentionProvider knownSessionIds={["live-session"]}>
        <SeedBlocker sessionId="deleted-session" />
        <WorkspaceInboxPane />
      </WorkspaceAttentionProvider>,
    )

    await waitFor(() => expect(screen.queryByText("Pick the deploy target")).not.toBeInTheDocument())
    expect(screen.getByText("Inbox zero")).toBeInTheDocument()
  })

  test("does not prune while sessions are non-authoritative", async () => {
    render(
      <WorkspaceAttentionProvider knownSessionIds={["live-session"]} knownSessionsAuthoritative={false}>
        <SeedBlocker sessionId="off-page-session" />
        <WorkspaceInboxPane />
      </WorkspaceAttentionProvider>,
    )

    expect(await screen.findByText("Pick the deploy target")).toBeInTheDocument()
  })
})
