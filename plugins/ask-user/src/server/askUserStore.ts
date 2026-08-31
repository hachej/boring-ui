import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { ASK_USER_ERROR_CODES } from "../shared/error-codes"
import { AskUserAnswerSchema, AskUserQuestionSchema, AskUserTranscriptEventSchema } from "../shared/schema"
import type {
  AskUserAnswer,
  AskUserDecisionRecord,
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
  reason: "create" | "answer" | "cancel" | "abandon" | "clear" | "transcript" | "restore" | "import"
}

export type AskUserStoreListener = (change: AskUserStoreChange) => void

export interface AskUserStore {
  getPending(sessionId: string): Promise<AskUserQuestion | null>
  listPending(): Promise<AskUserQuestion[]>
  getByQuestionId(questionId: string): Promise<AskUserQuestion | null>
  createPending(question: AskUserQuestion): Promise<void>
  answer(questionId: string, answer: AskUserAnswer): Promise<void>
  getAnswer(questionId: string): Promise<AskUserAnswer | null>
  getDecisionRecord(questionId: string): Promise<AskUserDecisionRecord | null>
  listResolved(): Promise<AskUserQuestion[]>
  cancel(questionId: string): Promise<void>
  expire?(questionId: string): Promise<void>
  markAbandoned(questionId: string): Promise<boolean>
  restoreAbandoned(questionId: string): Promise<boolean>
  clearPending(sessionId: string): Promise<void>
  appendTranscriptEvent(event: AskUserTranscriptEvent): Promise<void>
  appendTranscriptEventIfMissing(
    questionId: string,
    hasMatchingEvent: (events: AskUserTranscriptEvent[]) => boolean,
    buildEvent: () => AskUserTranscriptEvent,
  ): Promise<boolean>
  listTranscriptEvents(sessionId: string): Promise<AskUserTranscriptEvent[]>
  getTranscriptEventsForQuestion(questionId: string): Promise<AskUserTranscriptEvent[]>
  subscribe(listener: AskUserStoreListener): () => void
}

type StoredAskUserState = {
  version?: number
  questions: Record<string, AskUserQuestion>
  pendingBySession: Record<string, string>
  answers: Record<string, AskUserAnswer>
  transcriptsBySession: Record<string, AskUserTranscriptEvent[]>
}

const EMPTY_STATE: StoredAskUserState = {
  version: 1,
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

  constructor(private readonly filePath: string) {}

  async getPending(sessionId: string): Promise<AskUserQuestion | null> {
    const state = await this.load()
    const questionId = state.pendingBySession[sessionId]
    if (!questionId) return null
    const question = state.questions[questionId]
    if (!question || !isPending(question)) return null
    return clone(question)
  }

  async listPending(): Promise<AskUserQuestion[]> {
    const state = await this.load()
    return Object.values(state.pendingBySession)
      .map((questionId) => state.questions[questionId])
      .filter(isPending)
      .map((question) => clone(question))
  }

  async getByQuestionId(questionId: string): Promise<AskUserQuestion | null> {
    const state = await this.load()
    return state.questions[questionId] ? clone(state.questions[questionId]) : null
  }

  async getAnswer(questionId: string): Promise<AskUserAnswer | null> {
    const state = await this.load()
    return state.answers[questionId] ? clone(state.answers[questionId]) : null
  }

  async getDecisionRecord(questionId: string): Promise<AskUserDecisionRecord | null> {
    const question = await this.getByQuestionId(questionId)
    const answer = await this.getAnswer(questionId)
    if (!question || !answer) return null
    return {
      questionId,
      sessionId: question.sessionId,
      title: question.title,
      values: clone(answer.values),
      riskTier: answer.riskTier ?? question.riskTier,
      resolvedAt: answer.submittedAt,
      resolvedBy: answer.resolvedBy,
    }
  }

  async listResolved(): Promise<AskUserQuestion[]> {
    const state = await this.load()
    return Object.values(state.questions).filter((question) => question.status !== "ready").map(clone)
  }

  async createPending(question: AskUserQuestion): Promise<void> {
    await this.mutate(async (state) => {
      const existing = state.pendingBySession[question.sessionId]
      if (existing && isPending(state.questions[existing])) {
        throw new AskUserStoreError(ASK_USER_ERROR_CODES.PENDING_EXISTS, "a pending question already exists for this session")
      }
      state.questions[question.questionId] = clone(question)
      if (isPending(question)) state.pendingBySession[question.sessionId] = question.questionId
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
      if (question.expiresAt && Date.now() >= Date.parse(question.expiresAt)) {
        throw new AskUserStoreError(ASK_USER_ERROR_CODES.QUESTION_EXPIRED, "question has expired")
      }
      question.status = "answered"
      question.updatedAt = nowIso()
      state.answers[questionId] = clone(answer)
      delete state.pendingBySession[question.sessionId]
      this.emit({ sessionId: question.sessionId, questionId, reason: "answer" })
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
      delete state.pendingBySession[question.sessionId]
      this.emit({ sessionId: question.sessionId, questionId, reason: "cancel" })
    })
  }

  async expire(questionId: string): Promise<void> { await this.cancel(questionId) }

  async markAbandoned(questionId: string): Promise<boolean> {
    let changed = false
    await this.mutate(async (state) => {
      const question = requireQuestion(state, questionId)
      if (!isPending(question)) return
      changed = true
      question.status = "abandoned"
      question.updatedAt = nowIso()
      delete state.pendingBySession[question.sessionId]
      this.emit({ sessionId: question.sessionId, questionId, reason: "abandon" })
    })
    return changed
  }

  async restoreAbandoned(questionId: string): Promise<boolean> {
    let changed = false
    await this.mutate(async (state) => {
      const question = requireQuestion(state, questionId)
      if (question.status === "ready") return
      if (question.status !== "abandoned") throw new AskUserStoreError(ASK_USER_ERROR_CODES.ANSWER_INVALID, "question is not abandoned")
      const existing = state.pendingBySession[question.sessionId]
      if (existing && existing !== questionId && isPending(state.questions[existing])) {
        throw new AskUserStoreError(ASK_USER_ERROR_CODES.PENDING_EXISTS, "a pending question already exists for this session")
      }
      changed = true
      question.status = "ready"
      question.updatedAt = nowIso()
      state.pendingBySession[question.sessionId] = questionId
      this.emit({ sessionId: question.sessionId, questionId, reason: "restore" })
    })
    return changed
  }

  async clearPending(sessionId: string): Promise<void> {
    await this.mutate(async (state) => {
      const questionId = state.pendingBySession[sessionId]
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

  async appendTranscriptEventIfMissing(
    questionId: string,
    hasMatchingEvent: (events: AskUserTranscriptEvent[]) => boolean,
    buildEvent: () => AskUserTranscriptEvent,
  ): Promise<boolean> {
    let appended = false
    await this.mutate(async (state) => {
      const events = Object.values(state.transcriptsBySession).flat().filter((event) => transcriptQuestionId(event) === questionId)
      if (hasMatchingEvent(events)) return
      appended = true
      const event = buildEvent()
      const sessionId = transcriptSessionId(event)
      state.transcriptsBySession[sessionId] = [...(state.transcriptsBySession[sessionId] ?? []), clone(event)]
      this.emit({ sessionId, questionId, reason: "transcript" })
    })
    return appended
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
      await fn(state)
      await this.save(state)
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
          const parsed = JSON.parse(raw) as StoredAskUserState
          if ((parsed.version ?? 0) > 1) throw new AskUserStoreError(ASK_USER_ERROR_CODES.UNSUPPORTED_STORE_VERSION, `ask-user store version ${parsed.version} is newer than supported version 1`)
          const questions = Object.fromEntries(Object.entries(parsed.questions ?? {}).flatMap(([id, value]) => {
            const result = AskUserQuestionSchema.safeParse(value)
            return result.success ? [[id, result.data]] : []
          }))
          const answers = Object.fromEntries(Object.entries(parsed.answers ?? {}).flatMap(([id, value]) => {
            const result = AskUserAnswerSchema.safeParse(value)
            return result.success ? [[id, result.data]] : []
          }))
          const transcriptsBySession = Object.fromEntries(Object.entries(parsed.transcriptsBySession ?? {}).map(([sessionId, events]) => [
            sessionId,
            events.flatMap((event) => {
              const result = AskUserTranscriptEventSchema.safeParse(event)
              return result.success ? [result.data] : []
            }),
          ]))
          const pendingBySession = Object.fromEntries(Object.entries(parsed.pendingBySession ?? {}).filter(([, id]) => questions[id]?.status === "ready"))
          this.state = { version: 1, questions, answers, transcriptsBySession, pendingBySession }
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
