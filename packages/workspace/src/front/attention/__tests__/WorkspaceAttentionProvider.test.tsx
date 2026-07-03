import { useEffect } from "react"
import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { WorkspaceAttentionProvider, useWorkspaceAttention } from "../WorkspaceAttentionProvider"

function SeedBlocker({ sessionId, pruneWhenSessionMissing = false }: { sessionId: string; pruneWhenSessionMissing?: boolean }) {
  const { addBlocker } = useWorkspaceAttention()
  useEffect(() => {
    addBlocker({
      id: `question:${sessionId}`,
      reason: "ask-user.question",
      label: `Question for ${sessionId}`,
      sessionId,
      pruneWhenSessionMissing,
      inbox: { kind: "question", sourceLabel: "ask_user" },
      sessionBadge: { kind: "question", label: "question" },
    })
  }, [addBlocker, pruneWhenSessionMissing, sessionId])
  return null
}

function BlockerList() {
  const { blockers } = useWorkspaceAttention()
  return <div>{blockers.map((blocker) => <span key={blocker.id}>{blocker.label}</span>)}</div>
}

describe("WorkspaceAttentionProvider", () => {
  it("removes session-scoped inbox blockers for sessions that no longer exist", async () => {
    render(
      <WorkspaceAttentionProvider knownSessionIds={["live-session"]}>
        <SeedBlocker sessionId="deleted-session" pruneWhenSessionMissing />
        <BlockerList />
      </WorkspaceAttentionProvider>,
    )

    await waitFor(() => expect(screen.queryByText("Question for deleted-session")).not.toBeInTheDocument())
  })

  it("keeps session-scoped blockers while the session list is not authoritative", async () => {
    render(
      <WorkspaceAttentionProvider knownSessionIds={["live-session"]} knownSessionsAuthoritative={false}>
        <SeedBlocker sessionId="off-page-session" pruneWhenSessionMissing />
        <BlockerList />
      </WorkspaceAttentionProvider>,
    )

    expect(await screen.findByText("Question for off-page-session")).toBeInTheDocument()
  })

  it("keeps external inbox blockers whose session id is not a workspace chat session", async () => {
    render(
      <WorkspaceAttentionProvider knownSessionIds={["live-session"]}>
        <SeedBlocker sessionId="external-review-thread" />
        <BlockerList />
      </WorkspaceAttentionProvider>,
    )

    expect(await screen.findByText("Question for external-review-thread")).toBeInTheDocument()
  })
})
