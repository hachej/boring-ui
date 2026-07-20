"use client"

import { useEffect } from "react"
import { WORKSPACE_OPEN_PATH_SURFACE_KIND, useWorkspaceAttention, type WorkspaceAttentionBlocker } from "@hachej/boring-workspace"
import { definePlugin } from "@hachej/boring-workspace/plugin"
import { sharedQuestionsStore } from "../../runtime"
import type { AskUserQuestion } from "../../../shared/types"

export const INBOX_DEMO_SESSION_ID = "showcase"

export function createInboxDemoBlockers(now = Date.now()): WorkspaceAttentionBlocker[] {
  return [
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
    let cancelled = false
    void fetch("/api/v1/playground/inbox-demo", { method: "POST" })
      .then(async (response) => response.ok ? await response.json() as { pending?: AskUserQuestion } : null)
      .then((payload) => {
        if (!cancelled && payload?.pending) sharedQuestionsStore.setPending(payload.pending, INBOX_DEMO_SESSION_ID)
      })
    const blockers = createInboxDemoBlockers()
    for (const blocker of blockers) addBlocker(blocker)
    return () => {
      cancelled = true
      blockers.forEach((blocker) => removeBlocker(blocker.id))
      sharedQuestionsStore.setPending(null, INBOX_DEMO_SESSION_ID)
    }
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
