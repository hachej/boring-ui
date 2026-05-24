import { useCallback, useEffect, useMemo, useState } from "react"
import type { AskUserAnswerValue, AskUserQuestion } from "../shared/types"
import { ASK_USER_ERROR_CODES } from "../shared/error-codes"
import { createQuestionsClient, QuestionsClientError, type QuestionsClientOptions } from "./client"

export interface PendingQuestionState {
  question: AskUserQuestion | null
  loading: boolean
  submitting: boolean
  error: QuestionsClientError | null
  refresh(): Promise<AskUserQuestion | null>
  submit(question: AskUserQuestion, values: Record<string, AskUserAnswerValue>): Promise<void>
  cancel(question: AskUserQuestion): Promise<void>
}

export function usePendingQuestion(
  sessionId: string | null | undefined,
  options: QuestionsClientOptions = {},
): PendingQuestionState {
  const headersKey = stableHeadersKey(options.headers)
  const client = useMemo(
    () => createQuestionsClient({ apiBaseUrl: options.apiBaseUrl, headers: options.headers }),
    [options.apiBaseUrl, headersKey],
  )
  const [question, setQuestion] = useState<AskUserQuestion | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<QuestionsClientError | null>(null)

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setQuestion(null)
      return null
    }
    setLoading(true)
    setError(null)
    try {
      const next = await client.pending(sessionId)
      setQuestion(next)
      return next
    } catch (err) {
      const normalized = normalizeClientError(err)
      setError(normalized)
      return null
    } finally {
      setLoading(false)
    }
  }, [client, sessionId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const submit = useCallback(async (target: AskUserQuestion, values: Record<string, AskUserAnswerValue>) => {
    setSubmitting(true)
    setError(null)
    try {
      await client.submit(target, values)
      setQuestion(null)
    } catch (err) {
      setError(normalizeClientError(err))
      throw err
    } finally {
      setSubmitting(false)
    }
  }, [client])

  const cancel = useCallback(async (target: AskUserQuestion) => {
    setSubmitting(true)
    setError(null)
    try {
      await client.cancel(target)
      setQuestion(null)
    } catch (err) {
      setError(normalizeClientError(err))
      throw err
    } finally {
      setSubmitting(false)
    }
  }, [client])

  return { question, loading, submitting, error, refresh, submit, cancel }
}

function normalizeClientError(error: unknown): QuestionsClientError {
  return error instanceof QuestionsClientError
    ? error
    : new QuestionsClientError(ASK_USER_ERROR_CODES.BRIDGE_ERROR, error instanceof Error ? error.message : String(error))
}

function stableHeadersKey(headers: QuestionsClientOptions["headers"]): string {
  if (!headers) return ""
  return JSON.stringify(Object.entries(headers).sort(([left], [right]) => left.localeCompare(right)))
}
