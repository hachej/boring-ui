import { useEffect } from "react"
import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { WorkspaceAttentionProvider, useWorkspaceAttention } from "../WorkspaceAttentionProvider"

function SeedBlocker({ sessionId }: { sessionId: string }) {
  const { addBlocker } = useWorkspaceAttention()
  useEffect(() => {
    addBlocker({
      id: `question:${sessionId}`,
      reason: "ask-user.question",
      label: `Question for ${sessionId}`,
      sessionId,
      inbox: { kind: "question", sourceLabel: "ask_user" },
      sessionBadge: { kind: "question", label: "question" },
    })
  }, [addBlocker, sessionId])
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
        <SeedBlocker sessionId="deleted-session" />
        <BlockerList />
      </WorkspaceAttentionProvider>,
    )

    await waitFor(() => expect(screen.queryByText("Question for deleted-session")).not.toBeInTheDocument())
  })

  it("keeps session-scoped blockers while the session list is not authoritative", async () => {
    render(
      <WorkspaceAttentionProvider knownSessionIds={["live-session"]} knownSessionsAuthoritative={false}>
        <SeedBlocker sessionId="off-page-session" />
        <BlockerList />
      </WorkspaceAttentionProvider>,
    )

    expect(await screen.findByText("Question for off-page-session")).toBeInTheDocument()
  })
})
