// @vitest-environment node

import { describe, expect, it, vi } from "vitest"
import type { WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"
import type { AskUserAnswer, AskUserQuestion } from "../../shared/types"
import { AskUserAnswerDelivery, createWorkspaceAgentAnswerDeliveryTransport, formatOwnerAnswerPrompt, type AskUserAnswerDeliveryTransport } from "../askUserAnswerDelivery"
import { MemoryAskUserStore } from "./testAskUserStore"

const now = "2026-09-06T00:00:00.000Z"

function question(questionId = "q1"): AskUserQuestion {
  return {
    questionId,
    sessionId: "session-1",
    ownerPrincipalId: "owner-1",
    blocking: false,
    agentTypeId: "orchestrator",
    workspaceId: "workspace-1",
    askingUserId: "owner-1",
    status: "ready",
    title: "Review PR 42",
    schema: {
      wireVersion: 1,
      fields: [
        { type: "radio", name: "decision", label: "Decision", options: [{ value: "approve", label: "Approve" }, { value: "changes", label: "Changes" }] },
        { type: "textarea", name: "notes", label: "Notes" },
      ],
    },
    artifacts: [],
    answerToken: "token",
    createdAt: now,
    updatedAt: now,
  }
}

function answer(questionId = "q1"): AskUserAnswer {
  return { questionId, sessionId: "session-1", values: { decision: "approve", notes: "ship it" }, submittedAt: now }
}

async function persistedAnswer(store: MemoryAskUserStore, questionId = "q1") {
  await store.createPending(question(questionId))
  await store.answer(questionId, answer(questionId))
}

describe("non-blocking answer delivery", () => {
  it("formats the owner follow-up with field values and notes", () => {
    expect(formatOwnerAnswerPrompt(question(), answer())).toBe(
      "Owner answered `Review PR 42` (question q1): Decision: approve; notes: ship it",
    )
  })

  it("uses one stable require-idle prompt request for the asking session", async () => {
    const dispatch = vi.fn(async (_input, _onEvent, onAccepted) => {
      await onAccepted?.({ ref: { agentTypeId: "orchestrator", sessionId: "session-1" }, receipt: { accepted: true, disposition: "prompt" } })
      return { ref: { agentTypeId: "orchestrator", sessionId: "session-1" }, receipt: { accepted: true, disposition: "prompt" } }
    })
    const resolver = {
      async runWithWorkspaceAgent(input: unknown, run: (binding: { dispatch: typeof dispatch }) => Promise<void>) {
        expect(input).toMatchObject({ agentTypeId: "orchestrator", context: { workspaceId: "workspace-1", userId: "owner-1" }, requestId: "ask-user-answer:q1" })
        await run({ dispatch })
      },
    } as unknown as WorkspaceAgentDispatcherResolver
    const transport = createWorkspaceAgentAnswerDeliveryTransport(resolver)

    await expect(transport.deliver(question(), answer(), "follow-up")).resolves.toBe("accepted")
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      requestId: "ask-user-answer:q1",
      clientNonce: "ask-user-answer:q1",
      content: "follow-up",
      requireIdle: true,
    }), expect.any(Function), expect.any(Function))
  })

  it("delivers an answer and records the idempotent delivered state", async () => {
    const store = new MemoryAskUserStore()
    const deliver = vi.fn(async () => "accepted" as const)
    const delivery = new AskUserAnswerDelivery(store, { deliver })
    const stop = delivery.start()

    await persistedAnswer(store)
    await vi.waitFor(async () => expect((await store.getByQuestionId("q1"))?.delivery?.status).toBe("delivered"))
    await delivery.retry()

    expect(deliver).toHaveBeenCalledTimes(1)
    await stop()
  })

  it("keeps a busy answer queued and delivers it on a later tick", async () => {
    vi.useFakeTimers()
    try {
      const store = new MemoryAskUserStore()
      const deliver = vi.fn<AskUserAnswerDeliveryTransport["deliver"]>()
        .mockResolvedValueOnce("busy")
        .mockResolvedValueOnce("accepted")
      const delivery = new AskUserAnswerDelivery(store, { deliver }, 100)
      const stop = delivery.start()

      await persistedAnswer(store)
      await vi.waitFor(async () => expect(deliver).toHaveBeenCalledTimes(1))
      await expect(store.getByQuestionId("q1")).resolves.toMatchObject({ delivery: { status: "undelivered" } })

      await vi.advanceTimersByTimeAsync(100)
      await vi.waitFor(async () => expect((await store.getByQuestionId("q1"))?.delivery?.status).toBe("delivered"))
      expect(deliver).toHaveBeenCalledTimes(2)
      await stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it("retries an undelivered persisted answer on boot", async () => {
    const store = new MemoryAskUserStore()
    await persistedAnswer(store)
    const deliver = vi.fn(async () => "accepted" as const)
    const delivery = new AskUserAnswerDelivery(store, { deliver })
    const stop = delivery.start()

    await vi.waitFor(async () => expect((await store.getByQuestionId("q1"))?.delivery?.status).toBe("delivered"))
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ questionId: "q1" }), expect.objectContaining({ questionId: "q1" }), expect.stringContaining("Owner answered"))
    await stop()
  })
})
