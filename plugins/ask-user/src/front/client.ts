import { HumanArtifactListSchema } from "@hachej/boring-workspace"
import { WorkspaceBridgeErrorCode } from "@hachej/boring-workspace/shared"
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

export type PendingQuestionHint = { questionId: string; sessionId: string; toolCallId?: string; status?: AskUserQuestion["status"] }

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
  const raw = value as { questionId?: unknown; sessionId?: unknown; toolCallId?: unknown; status?: unknown }
  if (typeof raw.questionId !== "string" || typeof raw.sessionId !== "string") return null
  const status = normalizeQuestionStatus(raw.status)
  return {
    questionId: raw.questionId,
    sessionId: raw.sessionId,
    ...(typeof raw.toolCallId === "string" ? { toolCallId: raw.toolCallId } : {}),
    ...(status === "abandoned" && raw.status === undefined ? {} : { status }),
  }
}

// Keyed by apiBaseUrl (a fresh client is created per call/poll site, so the
// per-call closure can't remember whether a host lacks the bridge list op).
// `true` = this host answered OpNotFound and must use the REST fallback;
// `false` = the bridge op is confirmed present. Absent = unknown, probe once.
const restOnlyBaseUrls = new Map<string, boolean>()

/** Test-only: clears the per-host bridge/REST transport memory between test cases. */
export function __resetQuestionsClientTransportCacheForTests(): void {
  restOnlyBaseUrls.clear()
}

function isBridgeOpNotFound(error: unknown): boolean {
  if (!(error instanceof QuestionsClientError)) return false
  if (error.code === WorkspaceBridgeErrorCode.OpNotFound) return true
  // The bridge maps OpNotFound to HTTP 404 (httpRoutes.ts), which is not
  // otherwise used by any other bridge error code — a reliable signal even
  // if a proxy or older server strips the JSON error body.
  return error.statusCode === 404
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
        // Core's browser bridge policy requires a non-empty non-simple header as
        // CSRF proof. Its stock policy checks presence, not a secret value; hosts
        // that validate signed values can override this default in options.headers.
        "x-csrf-token": "browser",
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
    async listReady(): Promise<AskUserQuestion[]> {
      const baseUrl = options.apiBaseUrl ?? ""
      // The bridge op is the canonical transport (askUserServerPlugin.ts no
      // longer registers the legacy REST route by default). Probe it first;
      // only fall back to REST when the bridge answers "op not found", and
      // remember that per base URL so we stop re-probing the bridge on every
      // poll once a host is known to be REST-only (legacy/manual wiring).
      const knownRestOnly = restOnlyBaseUrls.get(baseUrl)
      if (knownRestOnly !== true) {
        try {
          const output = await callBridge<{ questions: unknown }>(ASK_USER_BRIDGE_OPS.list, { status: "ready" })
          if (knownRestOnly === undefined) restOnlyBaseUrls.set(baseUrl, false)
          return normalizeReadyQuestions(output.questions, 200)
        } catch (error) {
          if (!isBridgeOpNotFound(error)) throw error
          restOnlyBaseUrls.set(baseUrl, true)
        }
      }
      const response = await fetch(`${baseUrl}/api/v1/questions?status=ready`, {
        headers: options.headers,
        credentials: "include",
        cache: "no-store",
      })
      const payload = await response.json().catch(() => null) as { questions?: unknown } | null
      if (!response.ok) {
        throw new QuestionsClientError(
          typeof payload === "object" && payload && "error" in payload && typeof payload.error === "string" ? payload.error : ASK_USER_ERROR_CODES.UI_UNAVAILABLE,
          "Unable to list pending questions",
          response.status,
        )
      }
      return normalizeReadyQuestions(payload?.questions, response.status)
    },
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

function normalizeReadyQuestions(value: unknown, statusCode: number): AskUserQuestion[] {
  if (!Array.isArray(value)) {
    throw new QuestionsClientError(ASK_USER_ERROR_CODES.UI_UNAVAILABLE, "Invalid pending questions response", statusCode)
  }
  const questions = value.map(normalizeQuestion)
  if (questions.some((question) => question === null)) {
    throw new QuestionsClientError(ASK_USER_ERROR_CODES.UI_UNAVAILABLE, "Invalid pending question payload", statusCode)
  }
  return questions.filter((question): question is AskUserQuestion => question?.status === "ready")
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
    toolCallId: typeof raw.toolCallId === "string" ? raw.toolCallId : undefined,
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
