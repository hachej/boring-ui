import { timingSafeEqual } from "node:crypto"
import { AsyncLocalStorage } from "node:async_hooks"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { ASK_USER_ERROR_CODES } from "../shared/error-codes"
import { AskUserAnswerSchema, AskUserQuestionSchema, AskUserTranscriptEventSchema } from "../shared/schema"
import type { AskUserAnswer, AskUserDecisionRecord, AskUserQuestion, AskUserTranscriptEvent } from "../shared/types"
import { AskUserStoreError, type AskUserStore, type AskUserStoreChange, type AskUserStoreListener } from "./askUserStore"

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
type AttentionStatus = AskUserQuestion["status"] | "expired" | "superseded"

type RequestKey = {
  workspaceScopeId: string
  authSubjectId: string
  operation: "session.prompt"
  target: { kind: "session"; ref: { agentTypeId: string; sessionId: string } }
  requestId: string
}

export type AskUserAttentionRecord = {
  attentionId: string
  runRequestKey?: RequestKey
  toolCallId?: string
  workspaceScopeId?: string
  sessionRef?: { agentTypeId: string; sessionId: string }
  kind: "question"
  status: AttentionStatus
  ownerPrincipalId: string
  expiresAt?: string
  riskTier?: string
  payload: JsonValue
  answer?: { values: JsonValue; resolvedBy?: string; resolvedAt: string }
  resume: { state: "pending" | "resumed" | "outcome-unknown" | "unroutable"; resumeRequestId: string; error?: string }
  transcriptEvents: readonly JsonValue[]
  createdAt: number
  updatedAt: number
}

export interface AskUserAttentionCapability {
  create(record: AskUserAttentionRecord): Promise<void>
  get(attentionId: string): Promise<AskUserAttentionRecord | undefined>
  list(input?: { sessionId?: string; statuses?: readonly AttentionStatus[] }): Promise<AskUserAttentionRecord[]>
  transition(attentionId: string, expected: readonly AttentionStatus[], update: (record: AskUserAttentionRecord) => AskUserAttentionRecord): Promise<boolean>
  appendTranscriptEventIfMissing(attentionId: string, event: JsonValue, matches: (event: JsonValue) => boolean): Promise<boolean>
  resolveLegacySession(sessionId: string): Promise<readonly { workspaceScopeId: string; agentTypeId: string }[]>
  importOnce(records: readonly AskUserAttentionRecord[]): Promise<number>
  subscribe(listener: (change: AskUserStoreChange) => void): () => void
  isDraining(): boolean
}

export type AskUserRunContext = {
  workspaceScopeId?: string
  authSubjectId?: string
  requestId?: string
  sessionId?: string
  toolCallId?: string
}

/** The ask-user package knows this structural capability only; it imports no AgentHost internals. */
export class LedgerAskUserStore implements AskUserStore {
  private readonly runContexts = new AsyncLocalStorage<AskUserRunContext>()

  constructor(
    private readonly attention: AskUserAttentionCapability,
    private readonly legacyFilePath?: string,
  ) {}

  isDraining(): boolean { return this.attention.isDraining() }

  async withRunContext<T>(context: AskUserRunContext, run: () => Promise<T>): Promise<T> {
    return await this.runContexts.run(context, run)
  }

  async importLegacyOnce(): Promise<number> {
    if (!this.legacyFilePath) return await this.attention.importOnce([])
    let raw: string
    try { raw = await readFile(this.legacyFilePath, "utf8") } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return await this.attention.importOnce([])
      throw error
    }
    const parsed = JSON.parse(raw) as { version?: number; questions?: Record<string, AskUserQuestion>; answers?: Record<string, AskUserAnswer>; transcriptsBySession?: Record<string, AskUserTranscriptEvent[]> }
    if ((parsed.version ?? 0) > 1) throw new AskUserStoreError(ASK_USER_ERROR_CODES.UNSUPPORTED_STORE_VERSION, `ask-user store version ${parsed.version} is newer than supported version 1`)
    const records: AskUserAttentionRecord[] = []
    for (const candidate of Object.values(parsed.questions ?? {})) {
      const validated = AskUserQuestionSchema.safeParse(candidate)
      if (!validated.success) continue
      const question = validated.data
      const routes = await this.attention.resolveLegacySession(question.sessionId)
      const route = routes.length === 1 ? routes[0] : undefined
      const answerResult = AskUserAnswerSchema.safeParse(parsed.answers?.[question.questionId])
      const transcriptEvents = (parsed.transcriptsBySession?.[question.sessionId] ?? []).flatMap((event) => {
        const result = AskUserTranscriptEventSchema.safeParse(event)
        return result.success ? [result.data] : []
      })
      records.push(toLedger(question, {
        route,
        answer: answerResult.success ? answerResult.data : undefined,
        transcriptEvents,
        routable: Boolean(route),
      }))
    }
    return await this.attention.importOnce(records)
  }

  async getPending(sessionId: string): Promise<AskUserQuestion | null> {
    return (await this.listPending()).find((question) => question.sessionId === sessionId) ?? null
  }

  async listPending(): Promise<AskUserQuestion[]> {
    return (await this.attention.list({ statuses: ["ready"] })).map(fromLedger)
  }

  async getByQuestionId(questionId: string): Promise<AskUserQuestion | null> {
    const record = await this.attention.get(questionId)
    return record ? fromLedger(record) : null
  }

  async createPending(question: AskUserQuestion): Promise<void> {
    if (await this.getPending(question.sessionId)) throw new AskUserStoreError(ASK_USER_ERROR_CODES.PENDING_EXISTS, "a pending question already exists for this session")
    const route = await this.resolveRoute(question.sessionId)
    const ctx = this.runContexts.getStore()
    const runRequestKey = route && ctx?.requestId && ctx.authSubjectId
      ? { workspaceScopeId: route.workspaceScopeId, authSubjectId: ctx.authSubjectId, operation: "session.prompt" as const, target: { kind: "session" as const, ref: { agentTypeId: route.agentTypeId, sessionId: question.sessionId } }, requestId: ctx.requestId }
      : undefined
    await this.attention.create(toLedger(question, { route, runRequestKey, routable: Boolean(runRequestKey) }))
  }

  async answer(questionId: string, answer: AskUserAnswer): Promise<void> {
    const current = await this.require(questionId)
    if (answer.questionId !== questionId || answer.sessionId !== fromLedger(current).sessionId) throw new AskUserStoreError(ASK_USER_ERROR_CODES.SESSION_MISMATCH, "answer does not match question/session")
    if (current.status !== "ready") throw terminalError(current.status)
    if (current.expiresAt && Date.now() >= Date.parse(current.expiresAt)) throw new AskUserStoreError(ASK_USER_ERROR_CODES.QUESTION_EXPIRED, "question has expired")
    const changed = await this.attention.transition(questionId, ["ready"], (record) => ({ ...record, status: "answered", answer: { values: answer.values as JsonValue, resolvedBy: answer.resolvedBy, resolvedAt: answer.submittedAt }, updatedAt: Date.now() }))
    if (!changed) throw terminalError((await this.require(questionId)).status)
  }

  async getAnswer(questionId: string): Promise<AskUserAnswer | null> {
    const record = await this.attention.get(questionId)
    if (!record?.answer) return null
    const question = fromLedger(record)
    return { questionId, sessionId: question.sessionId, values: record.answer.values as AskUserAnswer["values"], submittedAt: record.answer.resolvedAt, riskTier: question.riskTier, resolvedBy: record.answer.resolvedBy }
  }

  async getDecisionRecord(questionId: string): Promise<AskUserDecisionRecord | null> {
    const question = await this.getByQuestionId(questionId)
    const answer = await this.getAnswer(questionId)
    if (!question || !answer) return null
    return { questionId, sessionId: question.sessionId, title: question.title, values: answer.values, riskTier: answer.riskTier, resolvedAt: answer.submittedAt, resolvedBy: answer.resolvedBy }
  }

  async listResolved(): Promise<AskUserQuestion[]> {
    return (await this.attention.list({ statuses: ["answered", "cancelled", "abandoned", "expired", "superseded"] })).map(fromLedger)
  }

  async cancel(questionId: string): Promise<void> {
    const current = await this.require(questionId)
    if (current.status !== "ready") throw terminalError(current.status)
    if (!await this.attention.transition(questionId, ["ready"], (record) => ({ ...record, status: "cancelled", updatedAt: Date.now() }))) throw terminalError((await this.require(questionId)).status)
  }

  async expire(questionId: string): Promise<void> {
    const current = await this.require(questionId)
    if (current.status !== "ready") throw terminalError(current.status)
    if (!await this.attention.transition(questionId, ["ready"], (record) => ({ ...record, status: "expired", updatedAt: Date.now() }))) throw terminalError((await this.require(questionId)).status)
  }

  async markAbandoned(questionId: string): Promise<boolean> {
    return await this.attention.transition(questionId, ["ready"], (record) => ({ ...record, status: "superseded", updatedAt: Date.now() }))
  }

  async restoreAbandoned(questionId: string): Promise<boolean> {
    const current = await this.require(questionId)
    if (current.status === "ready") return false
    if (current.status !== "abandoned") throw new AskUserStoreError(ASK_USER_ERROR_CODES.ANSWER_INVALID, "question is not abandoned")
    return await this.attention.transition(questionId, ["abandoned"], (record) => ({ ...record, status: "ready", updatedAt: Date.now() }))
  }

  async clearPending(sessionId: string): Promise<void> {
    const pending = await this.getPending(sessionId)
    if (pending) await this.cancel(pending.questionId)
  }

  async appendTranscriptEvent(event: AskUserTranscriptEvent): Promise<void> {
    await this.attention.appendTranscriptEventIfMissing(transcriptQuestionId(event), event as JsonValue, (candidate) => transcriptEventId(candidate) === transcriptEventId(event))
  }

  async appendTranscriptEventIfMissing(questionId: string, hasMatchingEvent: (events: AskUserTranscriptEvent[]) => boolean, buildEvent: () => AskUserTranscriptEvent): Promise<boolean> {
    const existing = (await this.attention.get(questionId))?.transcriptEvents as AskUserTranscriptEvent[] | undefined
    if (hasMatchingEvent(existing ?? [])) return false
    const event = buildEvent()
    return await this.attention.appendTranscriptEventIfMissing(questionId, event as JsonValue, (candidate) => hasMatchingEvent([candidate as AskUserTranscriptEvent]))
  }

  async listTranscriptEvents(sessionId: string): Promise<AskUserTranscriptEvent[]> {
    return (await this.attention.list()).filter((record) => fromLedger(record).sessionId === sessionId)
      .flatMap((record) => record.transcriptEvents as AskUserTranscriptEvent[])
  }

  async getTranscriptEventsForQuestion(questionId: string): Promise<AskUserTranscriptEvent[]> {
    return [...(((await this.attention.get(questionId))?.transcriptEvents ?? []) as AskUserTranscriptEvent[])]
  }

  subscribe(listener: AskUserStoreListener): () => void { return this.attention.subscribe(listener) }

  private async resolveRoute(sessionId: string): Promise<{ workspaceScopeId: string; agentTypeId: string } | undefined> {
    const routes = await this.attention.resolveLegacySession(sessionId)
    return routes.length === 1 ? routes[0] : undefined
  }

  private async require(questionId: string): Promise<AskUserAttentionRecord> {
    const record = await this.attention.get(questionId)
    if (!record) throw new AskUserStoreError(ASK_USER_ERROR_CODES.QUESTION_NOT_FOUND, `question ${questionId} not found`)
    return record
  }
}

export function toLedger(
  question: AskUserQuestion,
  options: {
    route?: { workspaceScopeId: string; agentTypeId: string }
    runRequestKey?: RequestKey
    answer?: AskUserAnswer
    transcriptEvents?: readonly AskUserTranscriptEvent[]
    routable?: boolean
  } = {},
): AskUserAttentionRecord {
  return {
    attentionId: question.questionId,
    runRequestKey: options.runRequestKey,
    toolCallId: question.toolCallId,
    workspaceScopeId: options.route?.workspaceScopeId,
    sessionRef: options.route ? { agentTypeId: options.route.agentTypeId, sessionId: question.sessionId } : undefined,
    kind: "question",
    status: question.status,
    ownerPrincipalId: question.ownerPrincipalId,
    expiresAt: question.expiresAt,
    riskTier: question.riskTier,
    payload: question as unknown as JsonValue,
    answer: options.answer ? { values: options.answer.values as JsonValue, resolvedBy: options.answer.resolvedBy, resolvedAt: options.answer.submittedAt } : undefined,
    resume: { state: options.routable ? "pending" : "unroutable", resumeRequestId: `attention:${question.questionId}` },
    transcriptEvents: (options.transcriptEvents ?? []) as JsonValue[],
    createdAt: Date.parse(question.createdAt),
    updatedAt: Date.parse(question.updatedAt),
  }
}

export function fromLedger(record: AskUserAttentionRecord): AskUserQuestion {
  const question = structuredClone(record.payload) as unknown as AskUserQuestion
  const status = record.status === "expired" || record.status === "superseded" ? "cancelled" : record.status
  return { ...question, status, updatedAt: new Date(record.updatedAt).toISOString() }
}

export function answerTokenMatches(actual: string, presented: string): boolean {
  const a = Buffer.from(actual)
  const b = Buffer.from(presented)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function legacyAskUserPath(workspaceRoot: string): string { return join(workspaceRoot, ".boring", "ask-user.json") }

function terminalError(status: AttentionStatus): AskUserStoreError {
  const code = status === "answered" ? ASK_USER_ERROR_CODES.ALREADY_ANSWERED : status === "cancelled" ? ASK_USER_ERROR_CODES.ALREADY_CANCELLED : ASK_USER_ERROR_CODES.ANSWER_INVALID
  return new AskUserStoreError(code, `question is ${status}`)
}

function transcriptQuestionId(event: AskUserTranscriptEvent): string {
  return event.type === "created" ? event.question.questionId : event.type === "answered" ? event.answer.questionId : event.questionId
}

function transcriptEventId(event: unknown): string {
  const value = event as AskUserTranscriptEvent
  return JSON.stringify([value.type, transcriptQuestionId(value), value.at])
}
