"use client"

import { useEffect, useMemo, useState } from "react"
import { events, workspaceEvents } from "@hachej/boring-workspace"
import { ASK_USER_UI_STATE_SLOTS } from "../../shared/constants"
import type { AskUserAnsweredSummary } from "../../shared/bridge"
import { createQuestionsClient } from "../client"

/**
 * One page of the owner's answered questions, newest first, across every agent
 * session in the workspace. This is the decision log behind the Inbox's
 * Answered tab: what was asked, what the owner decided, and where.
 */
export function useWorkspaceAnsweredQuestions({
  apiBaseUrl,
  headers,
  limit,
  enabled = true,
}: {
  apiBaseUrl: string
  headers?: Record<string, string>
  limit?: number
  enabled?: boolean
}): readonly AskUserAnsweredSummary[] {
  const headersKey = useMemo(
    () => JSON.stringify(Object.entries(headers ?? {}).sort(([left], [right]) => left.localeCompare(right))),
    [headers],
  )
  const [answered, setAnswered] = useState<readonly AskUserAnsweredSummary[]>([])

  useEffect(() => {
    if (!enabled) {
      setAnswered([])
      return
    }
    let disposed = false
    const controllers = new Set<AbortController>()
    const stableHeaders = Object.fromEntries(JSON.parse(headersKey) as Array<[string, string]>)
    const client = createQuestionsClient({ apiBaseUrl, headers: stableHeaders })
    const refresh = () => {
      const controller = new AbortController()
      controllers.add(controller)
      void client.answeredAll(limit ? { limit } : {}, controller.signal)
        .then((page) => { if (!disposed) setAnswered(page.answered) })
        .catch(() => undefined)
        .finally(() => controllers.delete(controller))
    }
    refresh()
    // A newly answered question leaves the pending slot, so the same
    // invalidation that shrinks the pending list grows the answered one.
    const onUiStateInvalidated = ({ keys }: { keys: string[] }) => {
      if (keys.includes(ASK_USER_UI_STATE_SLOTS.PENDING)) refresh()
    }
    const offUiStateInvalidated = events.on(workspaceEvents.uiStateInvalidated, onUiStateInvalidated)
    const offUiCommand = events.on(workspaceEvents.uiCommand, refresh)
    window.addEventListener("focus", refresh)
    return () => {
      disposed = true
      offUiStateInvalidated()
      offUiCommand()
      window.removeEventListener("focus", refresh)
      for (const controller of controllers) controller.abort()
    }
  }, [apiBaseUrl, enabled, headersKey, limit])

  return answered
}
