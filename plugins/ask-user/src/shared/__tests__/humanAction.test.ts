import { describe, expect, it } from "vitest"
import type { AskUserQuestion } from "../types"
import { askUserHumanActionToBlockerProjection, askUserQuestionToHumanActionView } from "../humanAction"

const question: AskUserQuestion = {
  questionId: "q1",
  sessionId: "s1",
  ownerPrincipalId: "runtime",
  status: "ready",
  title: "Approve deploy?",
  context: "Pick the target before continuing.",
  schema: { wireVersion: 1, fields: [{ type: "radio", name: "target", label: "Target", options: [{ value: "staging", label: "Staging" }] }] },
  answerToken: "secret-answer-token",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:01:00.000Z",
}

describe("human action ask-user projections", () => {
  it("projects ask-user questions into redacted human action views", () => {
    const view = askUserQuestionToHumanActionView(question, { workspaceId: "w1" })

    expect(view).toMatchObject({
      actionId: "q1",
      workspaceId: "w1",
      scope: { type: "session", sessionId: "s1" },
      kind: "question",
      status: "ready",
      blocking: true,
      title: "Approve deploy?",
      response: { mode: "form" },
    })
    expect(JSON.stringify(view)).not.toContain("secret-answer-token")
    expect(JSON.stringify(view)).not.toContain("answerToken")
  })

  it("projects ready ask-user questions into explicit inbox blocker metadata without secrets", () => {
    const blocker = askUserHumanActionToBlockerProjection({ hint: question, question })

    expect(blocker).toMatchObject({
      id: "ask-user:s1:q1",
      reason: "ask-user.question",
      surfaceKind: "questions",
      target: "q1",
      label: "Approve deploy?",
      sessionId: "s1",
      sessionBadge: { kind: "question", label: "question", tone: "attention", priority: 10 },
      inbox: {
        kind: "question",
        sourceLabel: "question",
        source: { type: "plugin", id: "ask-user", label: "question" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:01:00.000Z",
        priority: 10,
      },
      actions: [{ id: "open", label: "Open Questions" }, { id: "cancel", label: "Cancel question" }],
    })
    expect(JSON.stringify(blocker)).not.toContain("secret-answer-token")
    expect(JSON.stringify(blocker)).not.toContain("answerToken")
  })

  it("does not project non-ready questions as active blockers", () => {
    expect(askUserHumanActionToBlockerProjection({
      hint: { questionId: "q1", sessionId: "s1", status: "answered" },
      question: { ...question, status: "answered" },
    })).toBeNull()
  })
})
