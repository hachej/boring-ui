import { timingSafeEqual } from "node:crypto"
import { ASK_USER_ERROR_CODES } from "../shared/error-codes"
import type { AskUserAnswerValue, AskUserField, AskUserQuestion, QuestionsCommand } from "../shared/types"
import type { AskUserRuntime } from "./askUserRuntime"
import type { AskUserStore } from "./askUserStore"

export class QuestionsBridgeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message)
  }
}

export type QuestionsAuthContext = {
  sessionId: string
  principalId: string
}

export type QuestionsBridgeOptions = {
  store: AskUserStore
  runtime: AskUserRuntime
  getAuthContext?: () => QuestionsAuthContext | Promise<QuestionsAuthContext>
}

export class QuestionsBridge {
  constructor(private readonly options: QuestionsBridgeOptions) {}

  async restoreAbandoned(questionId: string, sessionId: string, answerToken: string): Promise<{ ok: true; status: string }> {
    const auth = await this.resolveAuth()
    const question = await this.requireQuestion(questionId)
    this.assertSession(question, sessionId, auth)
    this.assertToken(question.answerToken, answerToken)
    await this.options.runtime.restoreAbandoned(questionId)
    return { ok: true, status: "ready" }
  }

  async handle(command: QuestionsCommand): Promise<{ ok: true; status: string }> {
    const auth = await this.resolveAuth()
    const question = await this.requireQuestion(command.params.questionId)
    this.assertSession(question, command.params.sessionId, auth)

    this.assertToken(question.answerToken, command.params.answerToken)

    if (command.kind === "questions.cancel") {
      if (question.status === "answered") throw new QuestionsBridgeError(ASK_USER_ERROR_CODES.ALREADY_ANSWERED, "question already answered", 409)
      if (question.status === "cancelled") return { ok: true, status: "cancelled" }
      if (question.status !== "ready") throw new QuestionsBridgeError(ASK_USER_ERROR_CODES.QUESTION_NOT_READY, "question is not ready", 409)
      await this.options.runtime.cancelQuestion(question.questionId, question.sessionId, "user_cancelled")
      return { ok: true, status: "cancelled" }
    }

    if (question.status === "answered") {
      const existing = await this.options.store.getAnswer(question.questionId)
      if (existing && stableJson(existing.values) === stableJson(command.params.values)
        && (!existing.resolvedBy || existing.resolvedBy === auth.principalId)) return { ok: true, status: "answered" }
      throw new QuestionsBridgeError(ASK_USER_ERROR_CODES.ALREADY_ANSWERED, "question already answered with a different decision", 409)
    }
    if (question.status === "cancelled") throw new QuestionsBridgeError(ASK_USER_ERROR_CODES.ALREADY_CANCELLED, "question already cancelled", 409)
    if (question.status !== "ready" || !question.schema) throw new QuestionsBridgeError(ASK_USER_ERROR_CODES.ANSWER_INVALID, "question is not ready", 409)
    validateAnswerValues(question.schema.fields, command.params.values)
    try {
      await this.options.runtime.submitAnswer(question.questionId, question.sessionId, command.params.values, auth.principalId)
    } catch (error) {
      if (isCode(error, ASK_USER_ERROR_CODES.ALREADY_ANSWERED)) {
        const existing = await this.options.store.getAnswer(question.questionId)
        if (existing && stableJson(existing.values) === stableJson(command.params.values)
          && (!existing.resolvedBy || existing.resolvedBy === auth.principalId)) return { ok: true, status: "answered" }
      }
      throw error
    }
    return { ok: true, status: "answered" }
  }

  private async resolveAuth(): Promise<QuestionsAuthContext> {
    return (await this.options.getAuthContext?.()) ?? { sessionId: "anonymous", principalId: "anonymous" }
  }

  private async requireQuestion(questionId: string): Promise<AskUserQuestion> {
    const question = await this.options.store.getByQuestionId(questionId)
    if (!question) throw new QuestionsBridgeError(ASK_USER_ERROR_CODES.QUESTION_NOT_FOUND, "question not found", 404)
    return question
  }

  private assertSession(question: AskUserQuestion, browserSessionId: string, auth: QuestionsAuthContext): void {
    if (question.sessionId !== browserSessionId || auth.sessionId !== browserSessionId) {
      throw new QuestionsBridgeError(ASK_USER_ERROR_CODES.SESSION_MISMATCH, "session mismatch", 403)
    }
    if (question.ownerPrincipalId !== "anonymous" && question.ownerPrincipalId !== auth.principalId) {
      throw new QuestionsBridgeError(ASK_USER_ERROR_CODES.UNAUTHORIZED, "principal mismatch", 403)
    }
  }

  private assertToken(expected: string, actual: string): void {
    if (!constantTimeEqual(expected, actual)) {
      throw new QuestionsBridgeError(ASK_USER_ERROR_CODES.UNAUTHORIZED, "invalid answer token", 403)
    }
  }
}

export function constantTimeEqual(expected: string, actual: string): boolean {
  const expectedBytes = new TextEncoder().encode(expected)
  const actualBytes = new TextEncoder().encode(actual)
  const length = Math.max(expectedBytes.length, actualBytes.length)
  const left = new Uint8Array(length)
  const right = new Uint8Array(length)
  left.set(expectedBytes)
  right.set(actualBytes)
  return timingSafeEqual(left, right) && expectedBytes.length === actualBytes.length
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`
  return JSON.stringify(value)
}

export function validateAnswerValues(fields: AskUserField[], values: Record<string, AskUserAnswerValue>): void {
  const fieldByName = new Map(fields.map((field) => [field.name, field]))
  for (const name of Object.keys(values)) {
    if (!fieldByName.has(name)) throw new QuestionsBridgeError(ASK_USER_ERROR_CODES.ANSWER_INVALID, `unknown answer field ${name}`)
  }
  for (const field of fields) {
    const value = values[field.name]
    if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
      if ("required" in field && field.required) throw new QuestionsBridgeError(ASK_USER_ERROR_CODES.ANSWER_INVALID, `${field.name} is required`)
      continue
    }
    switch (field.type) {
      case "text":
      case "textarea":
        if (typeof value !== "string") throw invalid(field.name)
        if (field.minLength !== undefined && value.length < field.minLength) throw invalid(field.name)
        if (field.maxLength !== undefined && value.length > field.maxLength) throw invalid(field.name)
        if (field.type === "text" && field.pattern && !new RegExp(field.pattern).test(value)) throw invalid(field.name)
        break
      case "select":
      case "radio":
        if (typeof value !== "string" || !field.options.some((option) => option.value === value)) throw invalid(field.name)
        break
      case "multiselect":
        if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !field.options.some((option) => option.value === item))) throw invalid(field.name)
        if (field.minSelections !== undefined && value.length < field.minSelections) throw invalid(field.name)
        if (field.maxSelections !== undefined && value.length > field.maxSelections) throw invalid(field.name)
        break
      case "checkbox":
        if (typeof value !== "boolean") throw invalid(field.name)
        break
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) throw invalid(field.name)
        if (field.integer && !Number.isInteger(value)) throw invalid(field.name)
        if (field.min !== undefined && value < field.min) throw invalid(field.name)
        if (field.max !== undefined && value > field.max) throw invalid(field.name)
        break
    }
  }
}

function invalid(name: string): QuestionsBridgeError {
  return new QuestionsBridgeError(ASK_USER_ERROR_CODES.ANSWER_INVALID, `invalid answer for ${name}`)
}

function isCode(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === code
}
