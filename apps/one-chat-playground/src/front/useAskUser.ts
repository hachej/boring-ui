import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { PendingQuestionView } from '../server/askUser'
import type { AskUserAnswerValue } from '../../../../plugins/ask-user/src/shared/types'

const PENDING_URL = '/api/v1/questions/pending'
const COMMANDS_URL = '/api/v1/questions/commands'
const POLL_MS = 700

export interface AskUserState {
  readonly pending: readonly PendingQuestionView[]
  readonly justAnswered: Readonly<Record<string, Record<string, AskUserAnswerValue>>>
  readonly submitting: string | null
  submit(question: PendingQuestionView, values: Record<string, AskUserAnswerValue>): Promise<void>
}

/**
 * The agent's turn is blocked on the answer, so the browser has to notice a new
 * question without a page event. Polling is honest here: one small GET a
 * second against a local server, and no socket to keep alive for an app that
 * has exactly one user and one conversation.
 */
export function useAskUser(): AskUserState {
  const [pending, setPending] = useState<readonly PendingQuestionView[]>([])
  const [justAnswered, setJustAnswered] = useState<Record<string, Record<string, AskUserAnswerValue>>>({})
  const [submitting, setSubmitting] = useState<string | null>(null)
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(PENDING_URL, { headers: { accept: 'application/json' } })
      if (!response.ok) return
      const body = (await response.json()) as { questions?: PendingQuestionView[] }
      if (alive.current) setPending(body.questions ?? [])
    } catch {
      // The API restarting is not the user's problem; the next tick retries.
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void refresh()
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => {
      alive.current = false
      clearInterval(timer)
    }
  }, [refresh])

  const submit = useCallback<AskUserState['submit']>(async (question, values) => {
    setSubmitting(question.questionId)
    try {
      const response = await fetch(COMMANDS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'questions.submit',
          params: {
            questionId: question.questionId,
            sessionId: question.sessionId,
            answerToken: question.answerToken,
            values,
          },
        }),
      })
      if (!response.ok) throw new Error(`answer rejected (${response.status})`)
      if (question.toolCallId) {
        setJustAnswered((current) => ({ ...current, [question.toolCallId as string]: values }))
      }
      setPending((current) => current.filter((candidate) => candidate.questionId !== question.questionId))
    } finally {
      setSubmitting(null)
      void refresh()
    }
  }, [refresh])

  return useMemo(
    () => ({ pending, justAnswered, submitting, submit }),
    [pending, justAnswered, submitting, submit],
  )
}
