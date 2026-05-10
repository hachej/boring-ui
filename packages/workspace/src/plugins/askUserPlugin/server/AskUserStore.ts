import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { ASK_USER_ERROR_CODES } from "../shared/error-codes"
import { AskUserFormSchemaSchema } from "../shared/schema"
import type {
  AskUserAnswer,
  AskUserFormPatch,
  AskUserFormSchema,
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
  reason: "create" | "patch" | "finalize" | "answer" | "cancel" | "abandon" | "clear" | "transcript"
}

export type AskUserStoreListener = (change: AskUserStoreChange) => void

export interface AskUserStore {
  getPending(sessionId: string): Promise<AskUserQuestion | null>
  getByQuestionId(questionId: string): Promise<AskUserQuestion | null>
  createPending(question: AskUserQuestion): Promise<void>
  applyPatch(questionId: string, patch: AskUserFormPatch, expectedVersion?: number): Promise<AskUserQuestion>
  finalize(questionId: string, submitLabel?: string, expectedVersion?: number): Promise<AskUserQuestion>
  answer(questionId: string, answer: AskUserAnswer): Promise<void>
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
  pendingBySession: Record<string, string>
  appliedPatchIds: Record<string, string[]>
  answers: Record<string, AskUserAnswer>
  transcriptsBySession: Record<string, AskUserTranscriptEvent[]>
}

const EMPTY_STATE: StoredAskUserState = {
  questions: {},
  pendingBySession: {},
  appliedPatchIds: {},
  answers: {},
  transcriptsBySession: {},
}

export class FileAskUserStore implements AskUserStore {
  private state: StoredAskUserState | null = null
  private writeChain = Promise.resolve()
  private readonly listeners = new Set<AskUserStoreListener>()

  constructor(
    private readonly filePath: string,
    private readonly options: { retainedPatchIds?: number } = {},
  ) {}

  async getPending(sessionId: string): Promise<AskUserQuestion | null> {
    const state = await this.load()
    const questionId = state.pendingBySession[sessionId]
    if (!questionId) return null
    const question = state.questions[questionId]
    if (!question || !isPending(question)) return null
    return clone(question)
  }

  async getByQuestionId(questionId: string): Promise<AskUserQuestion | null> {
    const state = await this.load()
    return state.questions[questionId] ? clone(state.questions[questionId]) : null
  }

  async createPending(question: AskUserQuestion): Promise<void> {
    await this.mutate(async (state) => {
      const existing = state.pendingBySession[question.sessionId]
      if (existing && isPending(state.questions[existing])) {
        throw new AskUserStoreError(ASK_USER_ERROR_CODES.PENDING_EXISTS, `session ${question.sessionId} already has a pending question`)
      }
      state.questions[question.questionId] = clone(question)
      if (isPending(question)) state.pendingBySession[question.sessionId] = question.questionId
      state.appliedPatchIds[question.questionId] = []
      this.emit({ sessionId: question.sessionId, questionId: question.questionId, reason: "create" })
    })
  }

  async applyPatch(questionId: string, patch: AskUserFormPatch, expectedVersion?: number): Promise<AskUserQuestion> {
    let result: AskUserQuestion | null = null
    await this.mutate(async (state) => {
      const question = requireQuestion(state, questionId)
      if (question.status !== "draft") {
        throw new AskUserStoreError(ASK_USER_ERROR_CODES.PATCH_INVALID, "patches are only allowed while question is draft")
      }
      const applied = state.appliedPatchIds[questionId] ?? []
      if (applied.includes(patch.patchId)) {
        result = clone(question)
        return
      }
      assertExpectedVersion(question, expectedVersion)
      applyPatchToQuestion(question, patch)
      question.draftVersion += 1
      question.updatedAt = nowIso()
      state.appliedPatchIds[questionId] = [...applied, patch.patchId].slice(-this.retainedPatchIds)
      result = clone(question)
      this.emit({ sessionId: question.sessionId, questionId, reason: "patch" })
    })
    return result!
  }

  async finalize(questionId: string, submitLabel?: string, expectedVersion?: number): Promise<AskUserQuestion> {
    let result: AskUserQuestion | null = null
    await this.mutate(async (state) => {
      const question = requireQuestion(state, questionId)
      if (question.status !== "draft") {
        throw new AskUserStoreError(ASK_USER_ERROR_CODES.PATCH_INVALID, "finalize is only allowed while question is draft")
      }
      assertExpectedVersion(question, expectedVersion)
      const schema: AskUserFormSchema = {
        wireVersion: 1,
        fields: question.draftFields ?? [],
        ...(submitLabel !== undefined ? { submitLabel } : {}),
      }
      const parsed = AskUserFormSchemaSchema.safeParse(schema)
      if (!parsed.success) {
        throw new AskUserStoreError(ASK_USER_ERROR_CODES.SCHEMA_INVALID, parsed.error.message)
      }
      question.schema = parsed.data
      question.status = "ready"
      question.updatedAt = nowIso()
      question.draftVersion += 1
      state.pendingBySession[question.sessionId] = questionId
      result = clone(question)
      this.emit({ sessionId: question.sessionId, questionId, reason: "finalize" })
    })
    return result!
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

  async markAbandoned(questionId: string): Promise<void> {
    await this.mutate(async (state) => {
      const question = requireQuestion(state, questionId)
      if (!isPending(question)) return
      question.status = "abandoned"
      question.updatedAt = nowIso()
      delete state.pendingBySession[question.sessionId]
      this.emit({ sessionId: question.sessionId, questionId, reason: "abandon" })
    })
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

  private get retainedPatchIds(): number {
    return this.options.retainedPatchIds ?? 32
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
    try {
      const raw = await readFile(this.filePath, "utf8")
      this.state = { ...clone(EMPTY_STATE), ...JSON.parse(raw) }
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error
      this.state = clone(EMPTY_STATE)
    }
    return this.state as StoredAskUserState
  }

  private async save(state: StoredAskUserState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tmp = join(dirname(this.filePath), `.${randomUUID()}.tmp`)
    await writeFile(tmp, JSON.stringify(state, null, 2), "utf8")
    await rename(tmp, this.filePath)
  }

  private emit(change: AskUserStoreChange): void {
    for (const listener of this.listeners) listener(change)
  }
}

function isPending(question: AskUserQuestion | undefined): question is AskUserQuestion {
  return question?.status === "draft" || question?.status === "ready"
}

function requireQuestion(state: StoredAskUserState, questionId: string): AskUserQuestion {
  const question = state.questions[questionId]
  if (!question) throw new AskUserStoreError(ASK_USER_ERROR_CODES.QUESTION_NOT_FOUND, `question ${questionId} not found`)
  return question
}

function assertExpectedVersion(question: AskUserQuestion, expectedVersion: number | undefined): void {
  if (expectedVersion !== undefined && expectedVersion !== question.draftVersion) {
    throw new AskUserStoreError(ASK_USER_ERROR_CODES.PATCH_STALE, `expected draftVersion ${expectedVersion}, got ${question.draftVersion}`)
  }
}

function applyPatchToQuestion(question: AskUserQuestion, patch: AskUserFormPatch): void {
  switch (patch.type) {
    case "set_title":
      question.title = patch.title
      return
    case "set_context":
      question.context = patch.context
      return
    case "add_field": {
      const fields = question.draftFields ?? []
      if (fields.some((field) => field.name === patch.field.name)) {
        throw new AskUserStoreError(ASK_USER_ERROR_CODES.PATCH_INVALID, `field ${patch.field.name} already exists`)
      }
      question.draftFields = [...fields, clone(patch.field)]
      return
    }
    case "update_field": {
      if (Object.prototype.hasOwnProperty.call(patch.patch, "type")) {
        throw new AskUserStoreError(ASK_USER_ERROR_CODES.PATCH_INVALID, "update_field.patch.type is forbidden")
      }
      const fields = question.draftFields ?? []
      const index = fields.findIndex((field) => field.name === patch.name)
      if (index === -1) throw new AskUserStoreError(ASK_USER_ERROR_CODES.PATCH_INVALID, `field ${patch.name} not found`)
      question.draftFields = fields.map((field, i) => (i === index ? ({ ...field, ...patch.patch } as typeof field) : field))
      return
    }
    case "remove_field": {
      const fields = question.draftFields ?? []
      if (!fields.some((field) => field.name === patch.name)) {
        throw new AskUserStoreError(ASK_USER_ERROR_CODES.PATCH_INVALID, `field ${patch.name} not found`)
      }
      question.draftFields = fields.filter((field) => field.name !== patch.name)
      return
    }
    case "finalize":
      return
  }
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
