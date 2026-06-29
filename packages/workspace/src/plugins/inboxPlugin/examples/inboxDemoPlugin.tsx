"use client"

import { useEffect } from "react"
import { WORKSPACE_OPEN_PATH_SURFACE_KIND, definePlugin } from "../../../plugin"
import { useWorkspaceAttention, type WorkspaceAttentionBlocker } from "../../../front/attention"

export const INBOX_DEMO_SESSION_ID = "showcase"

export function createInboxDemoBlockers(now = Date.now()): WorkspaceAttentionBlocker[] {
  return [
    {
      id: "demo-question-deploy",
      reason: "ask-user.question",
      label: "Pick the deploy target for the release smoke",
      sessionId: INBOX_DEMO_SESSION_ID,
      target: "README.md",
      surfaceKind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
      inbox: {
        kind: "question",
        sourceLabel: "question",
        createdAt: now - 4 * 60_000,
        priority: 10,
      },
      sessionBadge: { kind: "question", label: "question", tone: "attention", priority: 10 },
      actions: [{ id: "answer", label: "Answer" }, { id: "dismiss", label: "Dismiss" }],
    },
    {
      id: "demo-review-ui",
      reason: "external-review.request",
      label: "Review Codex notes on workspace inbox flow",
      sessionId: "codex-42",
      target: "analysis.py",
      surfaceKind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
      inbox: {
        kind: "review",
        sourceLabel: "review",
        createdAt: now - 2 * 60 * 60_000,
        priority: 8,
      },
      sessionBadge: { kind: "review", label: "review", tone: "warning", priority: 8 },
      actions: [{ id: "open", label: "Open review" }],
    },
  ]
}

function InboxDemoAttentionSeed() {
  const { addBlocker, removeBlocker } = useWorkspaceAttention()
  useEffect(() => {
    const blockers = createInboxDemoBlockers()
    for (const blocker of blockers) addBlocker(blocker)
    return () => blockers.forEach((blocker) => removeBlocker(blocker.id))
  }, [addBlocker, removeBlocker])
  return null
}

export const inboxDemoPlugin = definePlugin({
  id: "inbox-demo-playground",
  label: "Inbox Demo Playground",
  setup(api) {
    api.registerBinding({ id: "inbox-demo-attention-seed", component: InboxDemoAttentionSeed })
  },
})
