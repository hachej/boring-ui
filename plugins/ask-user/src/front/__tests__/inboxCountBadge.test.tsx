import type { ReactNode } from "react"
import { useEffect } from "react"
import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { WorkspaceAttentionProvider, useWorkspaceAttention } from "@hachej/boring-workspace"
import { captureFrontPlugin } from "@hachej/boring-workspace/plugin"
import { createAskUserPlugin } from "../index"

/**
 * The Inbox is the ratified single triage surface, so its rail badge is THE
 * "a human is blocking" signal in the app-left — and it has to agree with the
 * attention rollups the pane draws on its collapsed group headers, in both
 * arithmetic (sessions, not items) and register (amber, not the accent that
 * means "selected" everywhere else).
 */
function inboxTrailing(): ReactNode {
  // Reached through the real plugin registration rather than by exporting the
  // badge for the test, so losing the Inbox action fails here too.
  const captured = captureFrontPlugin(createAskUserPlugin({ appLeftInbox: true }))
  const actions = captured.registrations.appLeftActions as readonly { id: string; trailing?: unknown }[] | undefined
  const inbox = actions?.find((action) => action.id === "inbox")
  if (!inbox?.trailing) throw new Error("ask-user no longer contributes an Inbox app-left action with a trailing badge")
  const Trailing = inbox.trailing as () => ReactNode
  return <Trailing />
}

function Seed({ questions }: { questions: readonly { id: string; sessionId?: string; agentTypeId?: string }[] }) {
  const { addBlocker, removeBlocker } = useWorkspaceAttention()
  useEffect(() => {
    for (const question of questions) {
      addBlocker({
        id: question.id,
        reason: "ask-user.question",
        ...(question.sessionId ? { sessionId: question.sessionId } : {}),
        ...(question.agentTypeId ? { agentTypeId: question.agentTypeId } : {}),
        // `inbox` is what makes a blocker an INBOX item — the badge counts the
        // Inbox's own contents, not every attention blocker on the surface.
        inbox: { kind: "question", sourceLabel: "Ask user" },
        sessionBadge: { kind: "question", label: "question", tone: "attention", priority: 10 },
      })
    }
    return () => { for (const question of questions) removeBlocker(question.id) }
  }, [addBlocker, removeBlocker, questions])
  return null
}

function renderBadge(questions: readonly { id: string; sessionId?: string; agentTypeId?: string }[]) {
  return render(
    <WorkspaceAttentionProvider>
      <Seed questions={questions} />
      {inboxTrailing()}
    </WorkspaceAttentionProvider>,
  )
}

const badge = () => document.querySelector('[data-boring-workspace-part="app-left-inbox-count"]')

describe("Inbox app-left count badge", () => {
  it("renders nothing at all when no one is waiting", async () => {
    renderBadge([])
    await waitFor(() => expect(badge()).toBeNull())
  })

  it("counts the chats waiting for a human, not the questions they asked", async () => {
    renderBadge([
      { id: "q1", sessionId: "s1", agentTypeId: "alpha" },
      // Same chat, second question: one chat still needs you, not two.
      { id: "q2", sessionId: "s1", agentTypeId: "alpha" },
      { id: "q3", sessionId: "s2", agentTypeId: "beta" },
    ])
    await waitFor(() => expect(badge()).toHaveTextContent("2"))
    expect(badge()).toHaveAttribute("aria-label", "2 chats waiting for you")
    // Same mark and same token as the pane's collapsed-header rollups.
    expect(badge()?.className).toContain("var(--attention)")
    expect(badge()?.querySelector("span.rounded-full")).not.toBeNull()
  })

  it("drops back down as blockers clear, and disappears at zero", async () => {
    const { rerender } = renderBadge([
      { id: "q1", sessionId: "s1", agentTypeId: "alpha" },
      { id: "q2", sessionId: "s2", agentTypeId: "beta" },
    ])
    await waitFor(() => expect(badge()).toHaveTextContent("2"))

    const only = [{ id: "q1", sessionId: "s1", agentTypeId: "alpha" }]
    rerender(
      <WorkspaceAttentionProvider>
        <Seed questions={only} />
        {inboxTrailing()}
      </WorkspaceAttentionProvider>,
    )
    await waitFor(() => expect(badge()).toHaveTextContent("1"))

    rerender(
      <WorkspaceAttentionProvider>
        <Seed questions={[]} />
        {inboxTrailing()}
      </WorkspaceAttentionProvider>,
    )
    await waitFor(() => expect(badge()).toBeNull())
  })

  it("caps a flooded inbox at 99+", async () => {
    renderBadge(Array.from({ length: 120 }, (_, index) => ({
      id: `q${index}`,
      sessionId: `s${index}`,
      agentTypeId: "alpha",
    })))
    await waitFor(() => expect(badge()).toHaveTextContent("99+"))
  })
})
