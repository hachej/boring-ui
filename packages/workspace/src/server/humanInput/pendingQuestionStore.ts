export type PendingQuestionStatus = "pending" | "answered" | "cancelled" | "timed_out" | "abandoned"
export type PendingQuestionCancelReason = "user_cancelled" | "aborted" | "timeout" | "server_restart" | "abandoned"

export interface PendingQuestionRecord {
  questionId: string
  requestId: string
  sessionId: string
  toolCallId?: string
  actorKind?: "human" | "agent" | "system" | "service"
  ownerPrincipalId?: string
  status: PendingQuestionStatus
  nonce: string
  payload?: unknown
  createdAt: string
  updatedAt: string
}

export interface PendingQuestionAnswer {
  questionId: string
  sessionId: string
  nonce: string
  values: unknown
  answeredAt: string
}

export type PendingQuestionTranscriptEvent =
  | { type: "created"; question: PendingQuestionRecord; at: string }
  | { type: "answered"; questionId: string; sessionId: string; at: string; answerRedacted: true }
  | { type: "cancelled"; questionId: string; sessionId: string; reason: PendingQuestionCancelReason; at: string }
  | { type: "timed_out"; questionId: string; sessionId: string; at: string }
  | { type: "abandoned"; questionId: string; sessionId: string; reason: PendingQuestionCancelReason; at: string }

export class PendingQuestionStoreError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = "PendingQuestionStoreError"
  }
}

export interface PendingQuestionStore {
  getPending(sessionId: string): Promise<PendingQuestionRecord | null>
  getByQuestionId(questionId: string): Promise<PendingQuestionRecord | null>
  getByRequestId(requestId: string): Promise<PendingQuestionRecord | null>
  getAnswer(questionId: string): Promise<PendingQuestionAnswer | null>
  createPending(question: PendingQuestionRecord): Promise<PendingQuestionRecord>
  answer(questionId: string, answer: PendingQuestionAnswer): Promise<void>
  cancel(questionId: string, reason: PendingQuestionCancelReason): Promise<void>
  markTimedOut(questionId: string): Promise<void>
  markAbandoned(questionId: string, reason?: PendingQuestionCancelReason): Promise<void>
  abandonPendingForServerRestart(): Promise<string[]>
  appendTranscriptEvent(event: PendingQuestionTranscriptEvent): Promise<void>
  listTranscriptEvents(sessionId: string): Promise<PendingQuestionTranscriptEvent[]>
}

interface State {
  questions: Map<string, PendingQuestionRecord>
  answers: Map<string, PendingQuestionAnswer>
  pendingBySession: Map<string, string>
  questionByRequest: Map<string, string>
  transcriptsBySession: Map<string, PendingQuestionTranscriptEvent[]>
}

export const PENDING_QUESTION_ERROR_CODES = {
  PendingExists: "PENDING_QUESTION_EXISTS",
  QuestionNotFound: "PENDING_QUESTION_NOT_FOUND",
  SessionMismatch: "PENDING_QUESTION_SESSION_MISMATCH",
  NonceMismatch: "PENDING_QUESTION_NONCE_MISMATCH",
  AlreadyFinal: "PENDING_QUESTION_ALREADY_FINAL",
} as const

export class InMemoryPendingQuestionStore implements PendingQuestionStore {
  private readonly state: State = {
    questions: new Map(),
    answers: new Map(),
    pendingBySession: new Map(),
    questionByRequest: new Map(),
    transcriptsBySession: new Map(),
  }

  async getPending(sessionId: string): Promise<PendingQuestionRecord | null> {
    const questionId = this.state.pendingBySession.get(sessionId)
    if (!questionId) return null
    const question = this.state.questions.get(questionId)
    return question?.status === "pending" ? clone(question) : null
  }

  async getByQuestionId(questionId: string): Promise<PendingQuestionRecord | null> {
    return cloneOrNull(this.state.questions.get(questionId))
  }

  async getByRequestId(requestId: string): Promise<PendingQuestionRecord | null> {
    const questionId = this.state.questionByRequest.get(requestId)
    return questionId ? cloneOrNull(this.state.questions.get(questionId)) : null
  }

  async getAnswer(questionId: string): Promise<PendingQuestionAnswer | null> {
    return cloneOrNull(this.state.answers.get(questionId))
  }

  async createPending(question: PendingQuestionRecord): Promise<PendingQuestionRecord> {
    const existingForRequest = await this.getByRequestId(question.requestId)
    if (existingForRequest) return existingForRequest
    const existingPending = this.state.pendingBySession.get(question.sessionId)
    if (existingPending) {
      throw new PendingQuestionStoreError(PENDING_QUESTION_ERROR_CODES.PendingExists, "a pending question already exists for this session")
    }
    this.state.questions.set(question.questionId, clone(question))
    this.state.questionByRequest.set(question.requestId, question.questionId)
    if (question.status === "pending") this.state.pendingBySession.set(question.sessionId, question.questionId)
    return clone(question)
  }

  async answer(questionId: string, answer: PendingQuestionAnswer): Promise<void> {
    const question = this.requireQuestion(questionId)
    this.assertPending(question)
    if (answer.sessionId !== question.sessionId) {
      throw new PendingQuestionStoreError(PENDING_QUESTION_ERROR_CODES.SessionMismatch, "answer session does not match question")
    }
    if (answer.nonce !== question.nonce) {
      throw new PendingQuestionStoreError(PENDING_QUESTION_ERROR_CODES.NonceMismatch, "answer nonce does not match question")
    }
    question.status = "answered"
    question.updatedAt = answer.answeredAt
    this.state.answers.set(questionId, clone(answer))
    this.state.pendingBySession.delete(question.sessionId)
  }

  async cancel(questionId: string, reason: PendingQuestionCancelReason): Promise<void> {
    this.finalize(questionId, reason === "timeout" ? "timed_out" : "cancelled")
  }

  async markTimedOut(questionId: string): Promise<void> {
    this.finalize(questionId, "timed_out")
  }

  async markAbandoned(questionId: string): Promise<void> {
    this.finalize(questionId, "abandoned")
  }

  async abandonPendingForServerRestart(): Promise<string[]> {
    const abandoned: string[] = []
    for (const [sessionId, questionId] of [...this.state.pendingBySession.entries()]) {
      const question = this.state.questions.get(questionId)
      if (!question || question.status !== "pending") continue
      question.status = "abandoned"
      question.updatedAt = new Date().toISOString()
      this.state.pendingBySession.delete(sessionId)
      abandoned.push(questionId)
    }
    return abandoned
  }

  async appendTranscriptEvent(event: PendingQuestionTranscriptEvent): Promise<void> {
    const sessionId = transcriptSessionId(event)
    this.state.transcriptsBySession.set(sessionId, [...(this.state.transcriptsBySession.get(sessionId) ?? []), clone(event)])
  }

  async listTranscriptEvents(sessionId: string): Promise<PendingQuestionTranscriptEvent[]> {
    return clone(this.state.transcriptsBySession.get(sessionId) ?? [])
  }

  private finalize(questionId: string, status: Exclude<PendingQuestionStatus, "pending" | "answered">): void {
    const question = this.requireQuestion(questionId)
    this.assertPending(question)
    question.status = status
    question.updatedAt = new Date().toISOString()
    this.state.pendingBySession.delete(question.sessionId)
  }

  private requireQuestion(questionId: string): PendingQuestionRecord {
    const question = this.state.questions.get(questionId)
    if (!question) throw new PendingQuestionStoreError(PENDING_QUESTION_ERROR_CODES.QuestionNotFound, "question not found")
    return question
  }

  private assertPending(question: PendingQuestionRecord): void {
    if (question.status !== "pending") {
      throw new PendingQuestionStoreError(PENDING_QUESTION_ERROR_CODES.AlreadyFinal, "question is already final")
    }
  }
}

function transcriptSessionId(event: PendingQuestionTranscriptEvent): string {
  if (event.type === "created") return event.question.sessionId
  return event.sessionId
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function cloneOrNull<T>(value: T | undefined): T | null {
  return value ? clone(value) : null
}
