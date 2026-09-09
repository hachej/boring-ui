import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { ASK_USER_ERROR_CODES } from "../shared/error-codes"
import type {
  AskUserAnswer,
  AskUserQuestion,
  AskUserTranscriptEvent,
} from "../shared/types"

export class AskUserStoreError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export type AskUserStoreChange = {
  sessionId: string
  questionId?: string
  reason: "create" | "answer" | "cancel" | "abandon" | "clear" | "transcript" | "delivery"
}

export type AskUserStoreListener = (change: AskUserStoreChange) => void

/** A question the owner has already dealt with, paired with the answer they
 * submitted (absent for cancelled/abandoned questions). */
export type AskUserResolvedQuestion = {
  question: AskUserQuestion
  answer: AskUserAnswer | null
}

export interface AskUserStore {
  getPending(sessionId: string): Promise<AskUserQuestion | null>
  listPending(): Promise<AskUserQuestion[]>
  /** Every non-pending question in the workspace, across sessions. */
  listResolved(): Promise<AskUserResolvedQuestion[]>
  listUndeliveredAnswers(): Promise<AskUserResolvedQuestion[]>
  getByQuestionId(questionId: string): Promise<AskUserQuestion | null>
  createPending(question: AskUserQuestion): Promise<void>
  answer(questionId: string, answer: AskUserAnswer): Promise<void>
  markAnswerDelivered(questionId: string): Promise<void>
  cancel(questionId: string): Promise<void>
  markAbandoned(questionId: string): Promise<void>
  clearPending(sessionId: string): Promise<void>
  appendTranscriptEvent(event: AskUserTranscriptEvent): Promise<void>
  listTranscriptEvents(sessionId: string): Promise<AskUserTranscriptEvent[]>
  getTranscriptEventsForQuestion(questionId: string): Promise<AskUserTranscriptEvent[]>
  subscribe(listener: AskUserStoreListener): () => void
}

type StoredAskUserState = {
  questions: Record<string, AskUserQuestion>
  /** String entries are accepted when reading stores written before non-blocking asks. */
  pendingBySession: Record<string, string | string[]>
  answers: Record<string, AskUserAnswer>
  transcriptsBySession: Record<string, AskUserTranscriptEvent[]>
}

const EMPTY_STATE: StoredAskUserState = {
  questions: {},
  pendingBySession: {},
  answers: {},
  transcriptsBySession: {},
}

export class FileAskUserStore implements AskUserStore {
  private state: StoredAskUserState | null = null
  private loadInFlight: Promise<StoredAskUserState> | null = null
  private writeChain = Promise.resolve()
  private readonly listeners = new Set<AskUserStoreListener>()
  private stagedChanges: AskUserStoreChange[] | null = null

  constructor(private readonly filePath: string) {}

  async getPending(sessionId: string): Promise<AskUserQuestion | null> {
    const state = await this.load()
    const pending = pendingQuestionsForSession(state, sessionId)
    const question = preferredPending(pending)
    return question ? clone(question) : null
  }

  async listPending(): Promise<AskUserQuestion[]> {
    const state = await this.load()
    return [...new Set(Object.values(state.pendingBySession).flatMap(pendingIds))]
      .map((questionId) => state.questions[questionId])
      .filter(isPending)
      .map((question) => clone(question))
  }

  async listResolved(): Promise<AskUserResolvedQuestion[]> {
    const state = await this.load()
    return Object.values(state.questions)
      .filter((question) => question.status !== "ready")
      .map((question) => ({ question: clone(question), answer: state.answers[question.questionId] ? clone(state.answers[question.questionId]) : null }))
  }

  async listUndeliveredAnswers(): Promise<AskUserResolvedQuestion[]> {
    const state = await this.load()
    return Object.values(state.questions)
      .filter((question) => question.status === "answered" && question.blocking === false && question.delivery?.status === "undelivered")
      .map((question) => ({ question: clone(question), answer: state.answers[question.questionId] ? clone(state.answers[question.questionId]) : null }))
  }

  async getByQuestionId(questionId: string): Promise<AskUserQuestion | null> {
    const state = await this.load()
    return state.questions[questionId] ? clone(state.questions[questionId]) : null
  }

  async createPending(question: AskUserQuestion): Promise<void> {
    await this.mutate(async (state) => {
      const existing = pendingQuestionsForSession(state, question.sessionId)
      if (question.blocking !== false && existing.some((candidate) => candidate.blocking !== false)) {
        throw new AskUserStoreError(ASK_USER_ERROR_CODES.PENDING_EXISTS, "a pending question already exists for this session")
      }
      state.questions[question.questionId] = clone(question)
      if (isPending(question)) {
        const existingIds = pendingIds(state.pendingBySession[question.sessionId])
        state.pendingBySession[question.sessionId] = existingIds.length === 0
          ? question.questionId
          : [...existingIds, question.questionId]
      }
      this.emit({ sessionId: question.sessionId, questionId: question.questionId, reason: "create" })
    })
  }

  async answer(questionId: string, answer: AskUserAnswer): Promise<void> {
    await this.mutate(async (state) => {
      const question = requireQuestion(state, questionId)
      if (answer.questionId !== questionId || answer.sessionId !== question.sessionId) {
        throw new AskUserStoreError(ASK_USER_ERROR_CODES.SESSION_MISMATCH, "answer does not match question/session")
      }
      if (question.status === "cancelled") throw new AskUserStoreError(ASK_USER_ERROR_CODES.ALREADY_CANCELLED, "question already cancelled")
      if (question.status === "answered") throw new AskUserStoreError(ASK_USER_ERROR_CODES.ALREADY_ANSWERED, "question already answered")
      if (question.status !== "ready") throw new AskUserStoreError(ASK_USER_ERROR_CODES.ANSWER_INVALID, "question is not ready")
      question.status = "answered"
      question.updatedAt = nowIso()
      if (question.blocking === false) question.delivery = { status: "undelivered", updatedAt: question.updatedAt }
      state.answers[questionId] = clone(answer)
      removePendingId(state, question.sessionId, questionId)
      this.emit({ sessionId: question.sessionId, questionId, reason: "answer" })
    })
  }

  async markAnswerDelivered(questionId: string): Promise<void> {
    await this.mutate(async (state) => {
      const question = requireQuestion(state, questionId)
      if (question.status !== "answered" || question.blocking !== false) {
        throw new AskUserStoreError(ASK_USER_ERROR_CODES.ANSWER_INVALID, "only answered non-blocking questions have delivery state")
      }
      if (question.delivery?.status === "delivered") return
      question.delivery = { status: "delivered", updatedAt: nowIso() }
      this.emit({ sessionId: question.sessionId, questionId, reason: "delivery" })
    })
  }

  async cancel(questionId: string): Promise<void> {
    await this.mutate(async (state) => {
      const question = requireQuestion(state, questionId)
      if (question.status === "answered") throw new AskUserStoreError(ASK_USER_ERROR_CODES.ALREADY_ANSWERED, "question already answered")
      if (question.status === "cancelled") throw new AskUserStoreError(ASK_USER_ERROR_CODES.ALREADY_CANCELLED, "question already cancelled")
      if (!isPending(question)) throw new AskUserStoreError(ASK_USER_ERROR_CODES.QUESTION_NOT_FOUND, "question is not pending")
      question.status = "cancelled"
      question.updatedAt = nowIso()
      removePendingId(state, question.sessionId, questionId)
      this.emit({ sessionId: question.sessionId, questionId, reason: "cancel" })
    })
  }

  async markAbandoned(questionId: string): Promise<void> {
    await this.mutate(async (state) => {
      const question = requireQuestion(state, questionId)
      if (!isPending(question)) return
      question.status = "abandoned"
      question.updatedAt = nowIso()
      removePendingId(state, question.sessionId, questionId)
      this.emit({ sessionId: question.sessionId, questionId, reason: "abandon" })
    })
  }

  async clearPending(sessionId: string): Promise<void> {
    await this.mutate(async (state) => {
      const questionId = pendingIds(state.pendingBySession[sessionId])[0]
      if (!questionId) return
      delete state.pendingBySession[sessionId]
      this.emit({ sessionId, questionId, reason: "clear" })
    })
  }

  async appendTranscriptEvent(event: AskUserTranscriptEvent): Promise<void> {
    await this.mutate(async (state) => {
      const sessionId = transcriptSessionId(event)
      state.transcriptsBySession[sessionId] = [...(state.transcriptsBySession[sessionId] ?? []), clone(event)]
      this.emit({ sessionId, questionId: transcriptQuestionId(event), reason: "transcript" })
    })
  }

  async listTranscriptEvents(sessionId: string): Promise<AskUserTranscriptEvent[]> {
    const state = await this.load()
    return clone(state.transcriptsBySession[sessionId] ?? [])
  }

  async getTranscriptEventsForQuestion(questionId: string): Promise<AskUserTranscriptEvent[]> {
    const state = await this.load()
    const events = Object.values(state.transcriptsBySession).flat().filter((event) => transcriptQuestionId(event) === questionId)
    return clone(events)
  }

  subscribe(listener: AskUserStoreListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async mutate(fn: (state: StoredAskUserState) => Promise<void> | void): Promise<void> {
    const run = this.writeChain.then(async () => {
      const state = await this.load()
      const changes: AskUserStoreChange[] = []
      this.stagedChanges = changes
      try {
        await fn(state)
        await this.save(state)
      } finally {
        this.stagedChanges = null
      }
      for (const change of changes) this.notify(change)
    })
    this.writeChain = run.catch(() => undefined)
    return run
  }

  private async load(): Promise<StoredAskUserState> {
    if (this.state) return this.state
    if (!this.loadInFlight) {
      this.loadInFlight = (async () => {
        try {
          const raw = await readFile(this.filePath, "utf8")
          this.state = { ...clone(EMPTY_STATE), ...JSON.parse(raw) }
        } catch (error) {
          if ((error as { code?: string }).code !== "ENOENT") throw error
          this.state = clone(EMPTY_STATE)
        }
        return this.state as StoredAskUserState
      })().finally(() => {
        this.loadInFlight = null
      })
    }
    return this.loadInFlight
  }

  private async save(state: StoredAskUserState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tmp = join(dirname(this.filePath), `.${randomUUID()}.tmp`)
    await writeFile(tmp, JSON.stringify(state, null, 2), "utf8")
    await rename(tmp, this.filePath)
  }

  private emit(change: AskUserStoreChange): void {
    if (this.stagedChanges) {
      this.stagedChanges.push(change)
      return
    }
    this.notify(change)
  }

  private notify(change: AskUserStoreChange): void {
    for (const listener of this.listeners) {
      try {
        const result = listener(change) as unknown
        if (isPromiseLike(result)) result.catch(() => undefined)
      } catch {
        // Store mutations must not be rolled back because an observer failed.
      }
    }
  }
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return !!value && typeof value === "object" && "catch" in value && typeof value.catch === "function"
}

function isPending(question: AskUserQuestion | undefined): question is AskUserQuestion {
  return question?.status === "ready"
}

function pendingIds(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value
  return value ? [value] : []
}

function pendingQuestionsForSession(state: StoredAskUserState, sessionId: string): AskUserQuestion[] {
  return pendingIds(state.pendingBySession[sessionId])
    .map((questionId) => state.questions[questionId])
    .filter(isPending)
}

function preferredPending(questions: AskUserQuestion[]): AskUserQuestion | undefined {
  return questions.find((question) => question.blocking !== false) ?? questions.at(-1)
}

function removePendingId(state: StoredAskUserState, sessionId: string, questionId: string): void {
  const remaining = pendingIds(state.pendingBySession[sessionId]).filter((candidate) => candidate !== questionId)
  if (remaining.length === 1) state.pendingBySession[sessionId] = remaining[0]!
  else if (remaining.length > 1) state.pendingBySession[sessionId] = remaining
  else delete state.pendingBySession[sessionId]
}

function requireQuestion(state: StoredAskUserState, questionId: string): AskUserQuestion {
  const question = state.questions[questionId]
  if (!question) throw new AskUserStoreError(ASK_USER_ERROR_CODES.QUESTION_NOT_FOUND, `question ${questionId} not found`)
  return question
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

function nowIso(): string {
  return new Date().toISOString()
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
