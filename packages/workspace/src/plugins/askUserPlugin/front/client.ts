import { ASK_USER_COMMAND_KINDS, ASK_USER_UI_STATE_SLOTS } from "../shared/constants"
import { ASK_USER_ERROR_CODES } from "../shared/error-codes"
import type { AskUserAnswerValue, AskUserQuestion, QuestionsCommand } from "../shared/types"
import { validateQuestionValues, type QuestionFormValues, type QuestionValidationResult } from "./primitives"

export type QuestionsClientResult = { ok: true; status: string }
export class QuestionsClientError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 0) { super(message) }
}

export type QuestionsClientOptions = { apiBaseUrl?: string; headers?: Record<string, string> }

export function readPendingQuestionFromState(state: Record<string, unknown> | null | undefined): AskUserQuestion | null {
  const slot = state?.[ASK_USER_UI_STATE_SLOTS.PENDING]
  if (!slot || typeof slot !== "object") return null
  const question = (slot as { question?: unknown }).question
  return question && typeof question === "object" ? question as AskUserQuestion : null
}

export function createQuestionsClient(options: QuestionsClientOptions = {}) {
  async function dispatch(command: QuestionsCommand): Promise<QuestionsClientResult> {
    const response = await fetch(`${options.apiBaseUrl ?? ""}/api/v1/questions/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
      body: JSON.stringify(command),
    })
    const payload = await response.json().catch(() => ({})) as { error?: string; message?: string; status?: string }
    if (!response.ok) throw new QuestionsClientError(payload.error ?? ASK_USER_ERROR_CODES.UI_UNAVAILABLE, payload.message ?? "Question command failed", response.status)
    return payload as QuestionsClientResult
  }

  return {
    dispatch,
    opened(question: AskUserQuestion) {
      return dispatch({ kind: ASK_USER_COMMAND_KINDS.OPENED, params: { questionId: question.questionId, sessionId: question.sessionId } })
    },
    cancel(question: AskUserQuestion) {
      return dispatch({ kind: ASK_USER_COMMAND_KINDS.CANCEL, params: { questionId: question.questionId, sessionId: question.sessionId, answerToken: question.answerToken } })
    },
    submit(question: AskUserQuestion, values: Record<string, AskUserAnswerValue>) {
      if (!question.schema) throw new QuestionsClientError(ASK_USER_ERROR_CODES.QUESTION_NOT_READY, "Question is not ready")
      const validation = validateQuestionValues(question.schema, values as QuestionFormValues)
      if (!validation.valid) throw new QuestionsClientError(ASK_USER_ERROR_CODES.ANSWER_INVALID, firstValidationMessage(validation))
      return dispatch({ kind: ASK_USER_COMMAND_KINDS.SUBMIT, params: { questionId: question.questionId, sessionId: question.sessionId, answerToken: question.answerToken, values } })
    },
  }
}

function firstValidationMessage(validation: QuestionValidationResult): string {
  return Object.values(validation.errors)[0] ?? "Invalid answer"
}
