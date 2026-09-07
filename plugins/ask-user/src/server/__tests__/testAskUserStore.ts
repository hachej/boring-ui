import type {
  AskUserAnswer,
  AskUserQuestion,
  AskUserTranscriptEvent,
} from "../../shared/types"
import { AskUserStoreError, type AskUserResolvedQuestion, type AskUserStore, type AskUserStoreChange, type AskUserStoreListener } from "../askUserStore"
import { ASK_USER_ERROR_CODES } from "../../shared/error-codes"

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function transcriptSessionId(event: AskUserTranscriptEvent): string {
  switch (event.type) {
    case "created": return event.question.sessionId
    case "answered": return event.answer.sessionId
    default: return event.sessionId
  }
}

function transcriptQuestionId(event: AskUserTranscriptEvent): string {
  switch (event.type) {
    case "created": return event.question.questionId
    case "answered": return event.answer.questionId
    default: return event.questionId
  }
}

export class MemoryAskUserStore implements AskUserStore {
  private readonly questions = new Map<string, AskUserQuestion>()
  private readonly pendingBySession = new Map<string, string[]>()
  private readonly answers = new Map<string, AskUserAnswer>()
  private readonly transcriptsBySession = new Map<string, AskUserTranscriptEvent[]>()
  private readonly listeners = new Set<AskUserStoreListener>()

  async getPending(sessionId: string): Promise<AskUserQuestion | null> {
    const questions = (this.pendingBySession.get(sessionId) ?? [])
      .map((questionId) => this.questions.get(questionId))
      .filter((question): question is AskUserQuestion => question?.status === "ready")
    const question = questions.find((candidate) => candidate.blocking !== false) ?? questions.at(-1)
    return question?.status === "ready" ? clone(question) : null
  }

  async listPending(): Promise<AskUserQuestion[]> {
    return [...this.pendingBySession.values()].flat()
      .map((questionId) => this.questions.get(questionId))
      .filter((question): question is AskUserQuestion => question?.status === "ready")
      .map((question) => clone(question))
  }

  async listResolved(): Promise<AskUserResolvedQuestion[]> {
    return [...this.questions.values()]
      .filter((question) => question.status !== "ready")
      .map((question) => ({ question: clone(question), answer: this.answers.get(question.questionId) ? clone(this.answers.get(question.questionId)!) : null }))
  }

  async listUndeliveredAnswers(): Promise<AskUserResolvedQuestion[]> {
    return [...this.questions.values()]
      .filter((question) => question.status === "answered" && question.blocking === false && question.delivery?.status === "undelivered")
      .map((question) => ({ question: clone(question), answer: this.answers.get(question.questionId) ? clone(this.answers.get(question.questionId)!) : null }))
  }

  async getByQuestionId(questionId: string): Promise<AskUserQuestion | null> {
    const question = this.questions.get(questionId)
    return question ? clone(question) : null
  }

  async createPending(question: AskUserQuestion): Promise<void> {
    const existing = (this.pendingBySession.get(question.sessionId) ?? []).map((id) => this.questions.get(id))
    if (question.blocking !== false && existing.some((candidate) => candidate?.status === "ready" && candidate.blocking !== false)) throw new AskUserStoreError(ASK_USER_ERROR_CODES.PENDING_EXISTS, "a pending question already exists for this session")
    this.questions.set(question.questionId, clone(question))
    if (question.status === "ready") this.pendingBySession.set(question.sessionId, [...(this.pendingBySession.get(question.sessionId) ?? []), question.questionId])
    this.emit({ sessionId: question.sessionId, questionId: question.questionId, reason: "create" })
  }

  async answer(questionId: string, answer: AskUserAnswer): Promise<void> {
    const question = this.requireQuestion(questionId)
    question.status = "answered"
    question.updatedAt = new Date().toISOString()
    if (question.blocking === false) question.delivery = { status: "undelivered", updatedAt: question.updatedAt }
    this.answers.set(questionId, clone(answer))
    this.removePending(question.sessionId, questionId)
    this.emit({ sessionId: question.sessionId, questionId, reason: "answer" })
  }

  async markAnswerDelivered(questionId: string): Promise<void> {
    const question = this.requireQuestion(questionId)
    if (question.status !== "answered" || question.blocking !== false) throw new AskUserStoreError(ASK_USER_ERROR_CODES.ANSWER_INVALID, "only answered non-blocking questions have delivery state")
    if (question.delivery?.status === "delivered") return
    question.delivery = { status: "delivered", updatedAt: new Date().toISOString() }
    this.emit({ sessionId: question.sessionId, questionId, reason: "delivery" })
  }

  async cancel(questionId: string): Promise<void> {
    const question = this.requireQuestion(questionId)
    question.status = "cancelled"
    question.updatedAt = new Date().toISOString()
    this.removePending(question.sessionId, questionId)
    this.emit({ sessionId: question.sessionId, questionId, reason: "cancel" })
  }

  async markAbandoned(questionId: string): Promise<void> {
    const question = this.requireQuestion(questionId)
    question.status = "abandoned"
    question.updatedAt = new Date().toISOString()
    this.removePending(question.sessionId, questionId)
    this.emit({ sessionId: question.sessionId, questionId, reason: "abandon" })
  }

  async clearPending(sessionId: string): Promise<void> {
    const questionId = this.pendingBySession.get(sessionId)?.[0]
    this.pendingBySession.delete(sessionId)
    this.emit({ sessionId, ...(questionId ? { questionId } : {}), reason: "clear" })
  }

  async appendTranscriptEvent(event: AskUserTranscriptEvent): Promise<void> {
    const sessionId = transcriptSessionId(event)
    this.transcriptsBySession.set(sessionId, [...(this.transcriptsBySession.get(sessionId) ?? []), clone(event)])
    this.emit({ sessionId, questionId: transcriptQuestionId(event), reason: "transcript" })
  }

  async listTranscriptEvents(sessionId: string): Promise<AskUserTranscriptEvent[]> {
    return clone(this.transcriptsBySession.get(sessionId) ?? [])
  }

  async getTranscriptEventsForQuestion(questionId: string): Promise<AskUserTranscriptEvent[]> {
    return clone([...this.transcriptsBySession.values()].flat().filter((event) => transcriptQuestionId(event) === questionId))
  }

  subscribe(listener: AskUserStoreListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private requireQuestion(questionId: string): AskUserQuestion {
    const question = this.questions.get(questionId)
    if (!question) throw new AskUserStoreError(ASK_USER_ERROR_CODES.QUESTION_NOT_FOUND, `question ${questionId} not found`)
    return question
  }

  private removePending(sessionId: string, questionId: string): void {
    const remaining = (this.pendingBySession.get(sessionId) ?? []).filter((candidate) => candidate !== questionId)
    if (remaining.length > 0) this.pendingBySession.set(sessionId, remaining)
    else this.pendingBySession.delete(sessionId)
  }

  private emit(change: AskUserStoreChange): void {
    for (const listener of this.listeners) listener(change)
  }
}
