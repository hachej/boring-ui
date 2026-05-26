import { randomUUID } from "node:crypto"
import type { BridgeActorAttribution } from "../../shared/workspace-bridge-rpc"
import {
  type PendingQuestionAnswer,
  type PendingQuestionCancelReason,
  type PendingQuestionRecord,
  type PendingQuestionStore,
} from "./pendingQuestionStore"

export interface PendingQuestionRuntimeCreateInput {
  requestId: string
  sessionId: string
  toolCallId?: string
  actor?: BridgeActorAttribution
  payload?: unknown
}

export type PendingQuestionWaitResult =
  | { status: "answered"; answer: PendingQuestionAnswer }
  | { status: "cancelled"; questionId: string; sessionId: string; reason: PendingQuestionCancelReason }

interface Waiter {
  sessionId: string
  resolve: (result: PendingQuestionWaitResult) => void
  cleanup: () => void
}

export class PendingQuestionRuntime {
  private readonly waiters = new Map<string, Waiter>()

  constructor(
    readonly store: PendingQuestionStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createPending(input: PendingQuestionRuntimeCreateInput): Promise<PendingQuestionRecord> {
    const at = this.isoNow()
    const question: PendingQuestionRecord = {
      questionId: randomUUID(),
      requestId: input.requestId,
      sessionId: input.sessionId,
      toolCallId: input.toolCallId,
      actorKind: input.actor?.actorKind,
      ownerPrincipalId: input.actor?.onBehalfOf?.id,
      status: "pending",
      nonce: randomUUID(),
      payload: input.payload,
      createdAt: at,
      updatedAt: at,
    }
    const record = await this.store.createPending(question)
    if (record.questionId === question.questionId) {
      await this.store.appendTranscriptEvent({ type: "created", question: record, at })
    }
    return record
  }

  async wait(question: PendingQuestionRecord, signal?: AbortSignal): Promise<PendingQuestionWaitResult> {
    const latest = await this.store.getByQuestionId(question.questionId)
    if (latest?.status === "answered") {
      const answer = await this.store.getAnswer(question.questionId)
      if (answer) return { status: "answered", answer }
    }
    if (latest && latest.status !== "pending") {
      return {
        status: "cancelled",
        questionId: latest.questionId,
        sessionId: latest.sessionId,
        reason: cancelReasonForFinalStatus(latest.status),
      }
    }
    if (signal?.aborted) return { status: "cancelled", questionId: question.questionId, sessionId: question.sessionId, reason: "aborted" }
    return new Promise((resolve) => {
      const onAbort = () => {
        void this.cancel(question.questionId, "aborted").catch(() => undefined)
      }
      this.waiters.set(question.questionId, {
        sessionId: question.sessionId,
        resolve,
        cleanup: () => signal?.removeEventListener("abort", onAbort),
      })
      signal?.addEventListener("abort", onAbort, { once: true })
    })
  }

  async answer(questionId: string, sessionId: string, nonce: string, values: unknown): Promise<void> {
    const answer: PendingQuestionAnswer = { questionId, sessionId, nonce, values, answeredAt: this.isoNow() }
    await this.store.answer(questionId, answer)
    await this.store.appendTranscriptEvent({ type: "answered", questionId, sessionId, at: answer.answeredAt, answerRedacted: true })
    this.resolve(questionId, { status: "answered", answer })
  }

  async cancel(questionId: string, reason: PendingQuestionCancelReason = "user_cancelled"): Promise<void> {
    const question = await this.store.getByQuestionId(questionId)
    if (!question || question.status !== "pending") return
    if (reason === "timeout") await this.store.markTimedOut(questionId)
    else await this.store.cancel(questionId, reason)
    if (reason === "timeout") {
      await this.store.appendTranscriptEvent({ type: "timed_out", questionId, sessionId: question.sessionId, at: this.isoNow() })
    } else {
      await this.store.appendTranscriptEvent({ type: "cancelled", questionId, sessionId: question.sessionId, reason, at: this.isoNow() })
    }
    this.resolve(questionId, { status: "cancelled", questionId, sessionId: question.sessionId, reason })
  }

  async abandonServerRestart(): Promise<string[]> {
    const ids = await this.store.abandonPendingForServerRestart()
    for (const questionId of ids) {
      const question = await this.store.getByQuestionId(questionId)
      if (!question) continue
      await this.store.appendTranscriptEvent({ type: "abandoned", questionId, sessionId: question.sessionId, reason: "server_restart", at: this.isoNow() })
      this.resolve(questionId, { status: "cancelled", questionId, sessionId: question.sessionId, reason: "server_restart" })
    }
    return ids
  }

  private resolve(questionId: string, result: PendingQuestionWaitResult): void {
    const waiter = this.waiters.get(questionId)
    if (!waiter) return
    this.waiters.delete(questionId)
    waiter.cleanup()
    waiter.resolve(result)
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}

function cancelReasonForFinalStatus(status: PendingQuestionRecord["status"]): PendingQuestionCancelReason {
  if (status === "timed_out") return "timeout"
  if (status === "abandoned") return "abandoned"
  return "user_cancelled"
}
