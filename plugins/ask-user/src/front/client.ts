import { HumanArtifactListSchema } from "@hachej/boring-workspace/shared"
import { ASK_USER_BRIDGE_OPS } from "../shared/bridge"
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

export type PendingQuestionHint = { questionId: string; sessionId: string; status?: AskUserQuestion["status"] }

export function readPendingQuestionHintsFromState(state: Record<string, unknown> | null | undefined): PendingQuestionHint[] {
  const slot = state?.[ASK_USER_UI_STATE_SLOTS.PENDING]
  if (!slot || typeof slot !== "object") return []
  const hints = new Map<string, PendingQuestionHint>()
  const rawSlot = slot as { hint?: unknown; question?: unknown; hintsBySession?: unknown }
  const current = readHint(rawSlot.hint) ?? readHint(rawSlot.question)
  if (current) hints.set(current.sessionId, current)
  if (rawSlot.hintsBySession && typeof rawSlot.hintsBySession === "object" && !Array.isArray(rawSlot.hintsBySession)) {
    for (const [sessionId, candidate] of Object.entries(rawSlot.hintsBySession as Record<string, unknown>)) {
      const hint = readHint(candidate)
      if (hint && hint.sessionId === sessionId) hints.set(sessionId, hint)
    }
  }
  return [...hints.values()]
}

export function readPendingQuestionHintFromState(state: Record<string, unknown> | null | undefined): PendingQuestionHint | null {
  return readPendingQuestionHintsFromState(state)[0] ?? null
}

function readHint(value: unknown): PendingQuestionHint | null {
  if (!value || typeof value !== "object") return null
  const raw = value as { questionId?: unknown; sessionId?: unknown; status?: unknown }
  if (typeof raw.questionId !== "string" || typeof raw.sessionId !== "string") return null
  const status = normalizeQuestionStatus(raw.status)
  return { questionId: raw.questionId, sessionId: raw.sessionId, ...(status === "abandoned" && raw.status === undefined ? {} : { status }) }
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
        ASK_USER_BRIDGE_OPS.pending,
        { sessionId },
        sessionId,
      )
      return normalizeQuestion(output.pending)
    },
    async cancel(question: AskUserQuestion) {
      ensureAnswerToken(question)
      return await callBridge<QuestionsClientResult>(
        ASK_USER_BRIDGE_OPS.cancel,
        {
          questionId: question.questionId,
          sessionId: question.sessionId,
          answerToken: question.answerToken,
        },
        question.sessionId,
        await deriveIdempotencyKey(ASK_USER_BRIDGE_OPS.cancel, {
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
        ASK_USER_BRIDGE_OPS.answer,
        {
          questionId: question.questionId,
          sessionId: question.sessionId,
          answerToken: question.answerToken,
          values,
        },
        question.sessionId,
        await deriveIdempotencyKey(ASK_USER_BRIDGE_OPS.answer, {
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
  const artifactsResult = HumanArtifactListSchema.safeParse(raw.artifacts ?? [])
  return {
    questionId: raw.questionId,
    sessionId: raw.sessionId,
    ownerPrincipalId: typeof raw.ownerPrincipalId === "string" ? raw.ownerPrincipalId : "anonymous",
    status: normalizeQuestionStatus(raw.status),
    title: typeof raw.title === "string" ? raw.title : undefined,
    context: typeof raw.context === "string" ? raw.context : undefined,
    schema,
    artifacts: artifactsResult.success ? artifactsResult.data : [],
    answerToken: typeof raw.answerToken === "string" ? raw.answerToken : "",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
  }
}

export async function deriveIdempotencyKey(op: string, inputValue: Record<string, unknown>): Promise<string> {
  const canonical = `${op}:${stableStringify(inputValue)}`
  const subtle = globalThis.crypto?.subtle
  if (subtle && typeof subtle.digest === "function") {
    const input = new TextEncoder().encode(canonical)
    const digest = await subtle.digest("SHA-256", input)
    return `ask-user-idem:${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("")}`
  }
  // `crypto.subtle` is unavailable in non-secure browser contexts (for example
  // Firefox over http://<tailnet-ip>). This key is only for client-side
  // idempotency, not for security, so a deterministic non-crypto hash is enough.
  return `ask-user-idem:${deterministicHashHex(canonical)}`
}

function deterministicHashHex(value: string): string {
  let h1 = 0xdeadbeef ^ value.length
  let h2 = 0x41c6ce57 ^ value.length
  let h3 = 0xc0decafe ^ value.length
  let h4 = 0x9e3779b9 ^ value.length
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
    h3 = Math.imul(h3 ^ code, 2246822507)
    h4 = Math.imul(h4 ^ code, 3266489909)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h3 ^ (h3 >>> 13), 3266489909)
  h3 = Math.imul(h3 ^ (h3 >>> 16), 2246822507) ^ Math.imul(h4 ^ (h4 >>> 13), 3266489909)
  h4 = Math.imul(h4 ^ (h4 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return [h1, h2, h3, h4].map((part) => (part >>> 0).toString(16).padStart(8, "0")).join("")
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
