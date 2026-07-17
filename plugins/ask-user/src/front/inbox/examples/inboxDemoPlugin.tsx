"use client"

import { useEffect } from "react"
import { WORKSPACE_OPEN_PATH_SURFACE_KIND, useWorkspaceAttention, type WorkspaceAttentionBlocker } from "@hachej/boring-workspace"
import { definePlugin } from "@hachej/boring-workspace/plugin"
import { sharedQuestionsStore } from "../../runtime"
import type { AskUserQuestion } from "../../../shared/types"

export const INBOX_DEMO_SESSION_ID = "showcase"

const mockQuestion: AskUserQuestion = {
  questionId: "demo-question-deploy",
  sessionId: INBOX_DEMO_SESSION_ID,
  ownerPrincipalId: "demo-principal",
  status: "ready",
  title: "Validate Release Deployment",
  context: "Please review the repository documentation and approve the production release.",
  artifact: {
    surfaceKind: "file",
    target: "README.md",
  },
  answerToken: "demo-token",
  createdAt: new Date(Date.now() - 4 * 60_000).toISOString(),
  updatedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
  schema: {
    wireVersion: 1,
    submitLabel: "Approve & Deploy",
    fields: [
      {
        type: "checkbox",
        name: "verified_readme",
        label: "I have verified that README.md matches this release"
      },
      {
        type: "radio",
        name: "environment",
        label: "Target Environment",
        options: [
          { value: "production", label: "Production (US-East)", description: "High availability multi-zone cluster" },
          { value: "staging", label: "Staging (US-West)", description: "Isolated pre-production sandbox" }
        ],
        required: true
      },
      {
        type: "textarea",
        name: "notes",
        label: "Release Notes / Deployment Comments (optional)"
      }
    ]
  }
}

export function createInboxDemoBlockers(now = Date.now()): WorkspaceAttentionBlocker[] {
  return [
    {
      id: "demo-question-deploy",
      reason: "ask-user.question",
      label: "Pick the deploy target for the release smoke",
      sessionId: INBOX_DEMO_SESSION_ID,
      pruneWhenSessionMissing: true,
      target: "README.md",
      surfaceKind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
      inbox: {
        kind: "question",
        sourceLabel: "question",
        createdAt: now - 4 * 60_000,
        priority: 10,
        artifact: {
          surfaceKind: "file",
          target: "README.md",
        }
      },
      sessionBadge: { kind: "question", label: "question", tone: "attention", priority: 10 },
      actions: [{ id: "open", label: "Open Questions" }],
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
    sharedQuestionsStore.setPending(mockQuestion, INBOX_DEMO_SESSION_ID)
    const blockers = createInboxDemoBlockers()
    for (const blocker of blockers) addBlocker(blocker)
    return () => {
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
