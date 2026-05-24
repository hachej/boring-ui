import { ASK_USER_ERROR_CODES } from "../shared/error-codes"
import type { AskUserAnswerValue, AskUserFormSchema, AskUserQuestion } from "../shared/types"
import { validateQuestionValues, type QuestionFormValues, type QuestionValidationResult } from "./primitives"

export type QuestionsClientResult = { ok: true; status: string }
export class QuestionsClientError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 0) { super(message) }
}

export type QuestionsClientOptions = { apiBaseUrl?: string; headers?: Record<string, string> }

type PendingQuestionRecord = {
  questionId: string
  sessionId: string
  status: "pending" | "answered" | "cancelled" | "timed_out" | "abandoned"
  nonce: string
  payload?: unknown
  createdAt: string
  updatedAt: string
}

type BridgeResponse<T> =
  | { ok: true; output: T }
  | { ok: false; error?: { code?: string; message?: string } }

export function readPendingQuestionFromState(state: Record<string, unknown> | null | undefined): AskUserQuestion | null {
  const slot = state?.["questions.pending"]
  if (!slot || typeof slot !== "object") return null
  const question = (slot as { question?: unknown }).question
  return normalizeQuestion(question)
}

export function normalizeQuestion(value: unknown): AskUserQuestion | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  if (typeof raw.questionId !== "string" || typeof raw.sessionId !== "string") return null
  const payload = raw.payload && typeof raw.payload === "object" ? raw.payload as Record<string, unknown> : raw
  const schema = isAskUserFormSchema(payload.schema) ? payload.schema : undefined
  return {
    questionId: raw.questionId,
    sessionId: raw.sessionId,
    ownerPrincipalId: typeof raw.ownerPrincipalId === "string" ? raw.ownerPrincipalId : "workspace-bridge",
    status: raw.status === "pending" || raw.status === "ready" ? "ready" : raw.status === "answered" || raw.status === "cancelled" || raw.status === "abandoned" ? raw.status : "abandoned",
    title: typeof payload.title === "string" ? payload.title : undefined,
    context: typeof payload.context === "string" ? payload.context : undefined,
    schema,
    answerToken: typeof raw.answerToken === "string" ? raw.answerToken : typeof raw.nonce === "string" ? raw.nonce : "",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
  }
}

export function createQuestionsClient(options: QuestionsClientOptions = {}) {
  async function callBridge<T>(op: string, input: Record<string, unknown>, sessionId?: string): Promise<T> {
    const response = await fetch(`${options.apiBaseUrl ?? ""}/api/v1/workspace-bridge/call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(sessionId ? { "x-boring-session-id": sessionId } : {}),
        ...(options.headers ?? {}),
      },
      body: JSON.stringify({ op, input }),
    })
    const payload = await response.json().catch(() => ({})) as BridgeResponse<T> & { error?: { code?: string; message?: string } }
    if (!response.ok || !payload.ok) {
      throw new QuestionsClientError(payload.error?.code ?? ASK_USER_ERROR_CODES.UI_UNAVAILABLE, payload.error?.message ?? "Question bridge call failed", response.status)
    }
    return payload.output
  }

  return {
    async pending(sessionId: string): Promise<AskUserQuestion | null> {
      const output = await callBridge<{ pending: PendingQuestionRecord | null }>("human-input.v1.pending", { sessionId }, sessionId)
      return normalizeQuestion(output.pending)
    },
    cancel(question: AskUserQuestion) {
      ensureNonce(question)
      return callBridge<QuestionsClientResult>("human-input.v1.cancel", { questionId: question.questionId, sessionId: question.sessionId, nonce: question.answerToken, reason: "user_cancelled" }, question.sessionId)
    },
    submit(question: AskUserQuestion, values: Record<string, AskUserAnswerValue>) {
      ensureNonce(question)
      if (!question.schema) throw new QuestionsClientError(ASK_USER_ERROR_CODES.QUESTION_NOT_READY, "Question is not ready")
      const validation = validateQuestionValues(question.schema, values as QuestionFormValues)
      if (!validation.valid) throw new QuestionsClientError(ASK_USER_ERROR_CODES.ANSWER_INVALID, firstValidationMessage(validation))
      return callBridge<QuestionsClientResult>("human-input.v1.answer", { questionId: question.questionId, sessionId: question.sessionId, nonce: question.answerToken, values }, question.sessionId)
    },
  }
}

function ensureNonce(question: AskUserQuestion): void {
  if (!question.answerToken) throw new QuestionsClientError(ASK_USER_ERROR_CODES.QUESTION_NOT_READY, "Question nonce is missing")
}

function firstValidationMessage(validation: QuestionValidationResult): string {
  return Object.values(validation.errors)[0] ?? "Invalid answer"
}

function isAskUserFormSchema(value: unknown): value is AskUserFormSchema {
  return !!value && typeof value === "object" && (value as { wireVersion?: unknown }).wireVersion === 1 && Array.isArray((value as { fields?: unknown }).fields)
}
