import type {
  AskUserAnswer,
  AskUserQuestion,
  AskUserTranscriptEvent,
} from "../../shared/types"
import { AskUserStoreError, type AskUserStore, type AskUserStoreChange, type AskUserStoreListener } from "../askUserStore"
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
  private readonly pendingBySession = new Map<string, string>()
  private readonly answers = new Map<string, AskUserAnswer>()
  private readonly transcriptsBySession = new Map<string, AskUserTranscriptEvent[]>()
  private readonly listeners = new Set<AskUserStoreListener>()

  async getPending(sessionId: string): Promise<AskUserQuestion | null> {
    const questionId = this.pendingBySession.get(sessionId)
    if (!questionId) return null
    const question = this.questions.get(questionId)
    return question?.status === "ready" ? clone(question) : null
  }

  async listPending(): Promise<AskUserQuestion[]> {
    return [...this.pendingBySession.values()]
      .map((questionId) => this.questions.get(questionId))
      .filter((question): question is AskUserQuestion => question?.status === "ready")
      .map((question) => clone(question))
  }

  async getByQuestionId(questionId: string): Promise<AskUserQuestion | null> {
    const question = this.questions.get(questionId)
    return question ? clone(question) : null
  }

  async createPending(question: AskUserQuestion): Promise<void> {
    const existing = this.pendingBySession.get(question.sessionId)
    if (existing && this.questions.get(existing)?.status === "ready") throw new AskUserStoreError(ASK_USER_ERROR_CODES.PENDING_EXISTS, "a pending question already exists for this session")
    this.questions.set(question.questionId, clone(question))
    if (question.status === "ready") this.pendingBySession.set(question.sessionId, question.questionId)
    this.emit({ sessionId: question.sessionId, questionId: question.questionId, reason: "create" })
  }

  async answer(questionId: string, answer: AskUserAnswer): Promise<void> {
    const question = this.requireQuestion(questionId)
    question.status = "answered"
    question.updatedAt = new Date().toISOString()
    this.answers.set(questionId, clone(answer))
    this.pendingBySession.delete(question.sessionId)
    this.emit({ sessionId: question.sessionId, questionId, reason: "answer" })
  }

  async cancel(questionId: string): Promise<void> {
    const question = this.requireQuestion(questionId)
    question.status = "cancelled"
    question.updatedAt = new Date().toISOString()
    this.pendingBySession.delete(question.sessionId)
    this.emit({ sessionId: question.sessionId, questionId, reason: "cancel" })
  }

  async markAbandoned(questionId: string): Promise<void> {
    const question = this.requireQuestion(questionId)
    question.status = "abandoned"
    question.updatedAt = new Date().toISOString()
    this.pendingBySession.delete(question.sessionId)
    this.emit({ sessionId: question.sessionId, questionId, reason: "abandon" })
  }

  async clearPending(sessionId: string): Promise<void> {
    const questionId = this.pendingBySession.get(sessionId)
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

  private emit(change: AskUserStoreChange): void {
    for (const listener of this.listeners) listener(change)
  }
}
