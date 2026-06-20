import { HUMAN_INPUT_OPS } from "../shared/bridge"
import { ASK_USER_UI_STATE_SLOTS } from "../shared/constants"
import { ASK_USER_ERROR_CODES } from "../shared/error-codes"
import type { AskUserAnswerValue, AskUserFormSchema, AskUserQuestion } from "../shared/types"
import { validateQuestionValues, type QuestionFormValues, type QuestionValidationResult } from "./primitives"

export type QuestionsClientResult = { ok: true; status: string }
export class QuestionsClientError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 0) { super(message) }
}

export type QuestionsClientOptions = { apiBaseUrl?: string; headers?: Record<string, string> }

type BridgeResponse<T> =
  | { ok: true; output: T }
  | { ok: false; error?: { code?: string; message?: string } }

export type PendingQuestionHint = { questionId: string; sessionId: string }

export function readPendingQuestionHintFromState(state: Record<string, unknown> | null | undefined): PendingQuestionHint | null {
  const slot = state?.[ASK_USER_UI_STATE_SLOTS.PENDING]
  if (!slot || typeof slot !== "object") return null
  const hint = (slot as { hint?: unknown }).hint
  if (hint && typeof hint === "object") {
    const raw = hint as { questionId?: unknown; sessionId?: unknown }
    return typeof raw.questionId === "string" && typeof raw.sessionId === "string"
      ? { questionId: raw.questionId, sessionId: raw.sessionId }
      : null
  }
  // Legacy/manual hosts may still publish a full question. Treat it only as a
  // rehydration hint; never trust UI state as an answerable question payload.
  const question = (slot as { question?: unknown }).question
  if (question && typeof question === "object") {
    const raw = question as { questionId?: unknown; sessionId?: unknown }
    return typeof raw.questionId === "string" && typeof raw.sessionId === "string"
      ? { questionId: raw.questionId, sessionId: raw.sessionId }
      : null
  }
  return null
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
        ...(options.headers ?? {}),
        ...(sessionId ? { "x-boring-session-id": sessionId } : {}),
      },
      body: JSON.stringify({ op, input, ...(idempotencyKey ? { idempotencyKey } : {}) }),
    })
    const payload = await response.json().catch(() => ({})) as BridgeResponse<T>
    if (!response.ok) {
      const error = "error" in payload ? payload.error : undefined
      throw new QuestionsClientError(
        error?.code ?? ASK_USER_ERROR_CODES.UI_UNAVAILABLE,
        error?.message ?? "Question bridge call failed",
        response.status,
      )
    }
    if (!payload.ok) {
      throw new QuestionsClientError(
        payload.error?.code ?? ASK_USER_ERROR_CODES.UI_UNAVAILABLE,
        payload.error?.message ?? "Question bridge call failed",
        response.status,
      )
    }
    return payload.output
  }

  return {
    async pending(sessionId: string): Promise<AskUserQuestion | null> {
      const output = await callBridge<{ pending: AskUserQuestion | null }>(
        HUMAN_INPUT_OPS.pending,
        { sessionId },
        sessionId,
      )
      return normalizeQuestion(output.pending)
    },
    async cancel(question: AskUserQuestion) {
      ensureAnswerToken(question)
      return await callBridge<QuestionsClientResult>(
        HUMAN_INPUT_OPS.cancel,
        {
          questionId: question.questionId,
          sessionId: question.sessionId,
          answerToken: question.answerToken,
        },
        question.sessionId,
        await deriveIdempotencyKey(HUMAN_INPUT_OPS.cancel, {
          questionId: question.questionId,
          sessionId: question.sessionId,
          answerToken: question.answerToken,
        }),
      )
    },
    async submit(question: AskUserQuestion, values: Record<string, AskUserAnswerValue>) {
      ensureAnswerToken(question)
      if (!question.schema) throw new QuestionsClientError(ASK_USER_ERROR_CODES.QUESTION_NOT_READY, "Question is not ready")
      const validation = validateQuestionValues(question.schema, values as QuestionFormValues)
      if (!validation.valid) throw new QuestionsClientError(ASK_USER_ERROR_CODES.ANSWER_INVALID, firstValidationMessage(validation))
      return await callBridge<QuestionsClientResult>(
        HUMAN_INPUT_OPS.answer,
        {
          questionId: question.questionId,
          sessionId: question.sessionId,
          answerToken: question.answerToken,
          values,
        },
        question.sessionId,
        await deriveIdempotencyKey(HUMAN_INPUT_OPS.answer, {
          questionId: question.questionId,
          sessionId: question.sessionId,
          answerToken: question.answerToken,
          values,
        }),
      )
    },
  }
}

export function normalizeQuestion(value: unknown): AskUserQuestion | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  if (typeof raw.questionId !== "string" || typeof raw.sessionId !== "string") return null
  const schema = isAskUserFormSchema(raw.schema) ? raw.schema : undefined
  return {
    questionId: raw.questionId,
    sessionId: raw.sessionId,
    ownerPrincipalId: typeof raw.ownerPrincipalId === "string" ? raw.ownerPrincipalId : "anonymous",
    status: normalizeQuestionStatus(raw.status),
    title: typeof raw.title === "string" ? raw.title : undefined,
    context: typeof raw.context === "string" ? raw.context : undefined,
    schema,
    answerToken: typeof raw.answerToken === "string" ? raw.answerToken : "",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
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
  if (status === "answered" || status === "cancelled" || status === "abandoned") return status
  return "abandoned"
}

function ensureAnswerToken(question: AskUserQuestion): void {
  if (!question.answerToken) throw new QuestionsClientError(ASK_USER_ERROR_CODES.QUESTION_NOT_READY, "Question answer token is missing")
}

function firstValidationMessage(validation: QuestionValidationResult): string {
  return Object.values(validation.errors)[0] ?? "Invalid answer"
}

function isAskUserFormSchema(value: unknown): value is AskUserFormSchema {
  return !!value && typeof value === "object" && (value as { wireVersion?: unknown }).wireVersion === 1 && Array.isArray((value as { fields?: unknown }).fields)
}
