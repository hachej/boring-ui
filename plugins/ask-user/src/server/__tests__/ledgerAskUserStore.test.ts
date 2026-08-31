import { describe, expect, it, vi } from "vitest"
import { LedgerAskUserStore, fromLedger, toLedger, type AskUserAttentionCapability } from "../ledgerAskUserStore"
import type { AskUserQuestion } from "../../shared/types"

describe("LedgerAskUserStore mapping", () => {
  it("round-trips every question field losslessly", () => {
    const question: AskUserQuestion = {
      questionId: "q-1",
      sessionId: "session-1",
      toolCallId: "tool-1",
      ownerPrincipalId: "owner-1",
      status: "ready",
      title: "Approve release",
      context: "The full context",
      schema: { wireVersion: 1, fields: [{ type: "text", name: "answer", label: "Answer", required: true }] },
      artifacts: [{ id: "artifact-1", surfaceKind: "file", target: "report.md", title: "Report" }],
      answerToken: "secret-token",
      createdAt: "2026-08-31T12:00:00.000Z",
      updatedAt: "2026-08-31T12:00:00.000Z",
      riskTier: "consequential",
      expiresAt: "2026-08-31T12:10:00.000Z",
    }

    expect(fromLedger(toLedger(question))).toEqual(question)
  })

  it("maps host attention subscription changes to the AskUserStore vocabulary", () => {
    let notify: ((change: Parameters<Parameters<AskUserAttentionCapability["subscribe"]>[0]>[0]) => void) | undefined
    const attention = {
      subscribe(listener: Parameters<AskUserAttentionCapability["subscribe"]>[0]) {
        notify = listener
        return () => undefined
      },
    } as unknown as AskUserAttentionCapability
    const listener = vi.fn()
    new LedgerAskUserStore(attention).subscribe(listener)

    notify?.({ sessionId: "session-1", attentionId: "q-1", reason: "supersede" })

    expect(listener).toHaveBeenCalledWith({ sessionId: "session-1", questionId: "q-1", reason: "abandon" })
  })
})
