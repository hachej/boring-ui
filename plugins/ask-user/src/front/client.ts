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
    status: normalizeQuestionStatus(raw.status),
    title: typeof payload.title === "string" ? payload.title : undefined,
    context: typeof payload.context === "string" ? payload.context : undefined,
    schema,
    nonce: typeof raw.nonce === "string" ? raw.nonce : "",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
  }
}

export function createQuestionsClient(options: QuestionsClientOptions = {}) {
  async function callBridge<T>(
    op: string,
    input: Record<string, unknown>,
    sessionId?: string,
    idempotencyKey?: string,
  ): Promise<T> {
    const response = await fetch(`${options.apiBaseUrl ?? ""}/api/v1/workspace-bridge/call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(sessionId ? { "x-boring-session-id": sessionId } : {}),
        ...(options.headers ?? {}),
      },
      body: JSON.stringify({ op, input, ...(idempotencyKey ? { idempotencyKey } : {}) }),
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
    async cancel(question: AskUserQuestion) {
      ensureNonce(question)
      return await callBridge<QuestionsClientResult>(
        "human-input.v1.cancel",
        { questionId: question.questionId, sessionId: question.sessionId, nonce: question.nonce, reason: "user_cancelled" },
        question.sessionId,
        await deriveIdempotencyKey("human-input.v1.cancel", {
          questionId: question.questionId,
          sessionId: question.sessionId,
          nonce: question.nonce,
          reason: "user_cancelled",
        }),
      )
    },
    async submit(question: AskUserQuestion, values: Record<string, AskUserAnswerValue>) {
      ensureNonce(question)
      if (!question.schema) throw new QuestionsClientError(ASK_USER_ERROR_CODES.QUESTION_NOT_READY, "Question is not ready")
      const validation = validateQuestionValues(question.schema, values as QuestionFormValues)
      if (!validation.valid) throw new QuestionsClientError(ASK_USER_ERROR_CODES.ANSWER_INVALID, firstValidationMessage(validation))
      return await callBridge<QuestionsClientResult>(
        "human-input.v1.answer",
        { questionId: question.questionId, sessionId: question.sessionId, nonce: question.nonce, values },
        question.sessionId,
        await deriveIdempotencyKey("human-input.v1.answer", {
          questionId: question.questionId,
          sessionId: question.sessionId,
          nonce: question.nonce,
          values,
        }),
      )
    },
  }
}

async function deriveIdempotencyKey(op: string, inputValue: Record<string, unknown>): Promise<string> {
  const input = new TextEncoder().encode(`${op}:${stableStringify(inputValue)}`)
  const digest = await crypto.subtle.digest("SHA-256", input)
  return `ask-user-idem:${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("")}`
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(",")}}`
}

function normalizeQuestionStatus(status: unknown): AskUserQuestion["status"] {
  if (status === "pending" || status === "ready") return "ready"
  if (status === "answered" || status === "cancelled" || status === "abandoned" || status === "timed_out" || status === "ui_unavailable") return status
  return "abandoned"
}

function ensureNonce(question: AskUserQuestion): void {
  if (!question.nonce) throw new QuestionsClientError(ASK_USER_ERROR_CODES.QUESTION_NOT_READY, "Question nonce is missing")
}

function firstValidationMessage(validation: QuestionValidationResult): string {
  return Object.values(validation.errors)[0] ?? "Invalid answer"
}

function isAskUserFormSchema(value: unknown): value is AskUserFormSchema {
  return !!value && typeof value === "object" && (value as { wireVersion?: unknown }).wireVersion === 1 && Array.isArray((value as { fields?: unknown }).fields)
}
