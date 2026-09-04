"use client"

import { useEffect, useMemo, useState } from "react"
import { events, workspaceEvents } from "@hachej/boring-workspace"
import { ASK_USER_UI_STATE_SLOTS } from "../../shared/constants"
import type { AskUserPendingSummary } from "../../shared/bridge"
import { createQuestionsClient } from "../client"

/**
 * Every pending question in the workspace, across agent sessions.
 *
 * The Inbox is the owner's single decision queue: a question raised by a
 * background Orchestrator or Worker session is theirs to answer even though the
 * browser never opened that chat. Attention blockers alone cannot carry those,
 * because they are pruned for sessions the shell does not know about.
 */
export function useWorkspacePendingQuestions({
  apiBaseUrl,
  headers,
  enabled = true,
}: {
  apiBaseUrl: string
  headers?: Record<string, string>
  enabled?: boolean
}): readonly AskUserPendingSummary[] {
  const headersKey = useMemo(
    () => JSON.stringify(Object.entries(headers ?? {}).sort(([left], [right]) => left.localeCompare(right))),
    [headers],
  )
  const [pending, setPending] = useState<readonly AskUserPendingSummary[]>([])

  useEffect(() => {
    if (!enabled) {
      setPending([])
      return
    }
    let disposed = false
    const controllers = new Set<AbortController>()
    const stableHeaders = Object.fromEntries(JSON.parse(headersKey) as Array<[string, string]>)
    const client = createQuestionsClient({ apiBaseUrl, headers: stableHeaders })
    const refresh = () => {
      const controller = new AbortController()
      controllers.add(controller)
      void client.pendingAll(controller.signal)
        .then((next) => { if (!disposed) setPending(next) })
        .catch(() => undefined)
        .finally(() => controllers.delete(controller))
    }
    refresh()
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
  }, [apiBaseUrl, enabled, headersKey])

  return pending
}
