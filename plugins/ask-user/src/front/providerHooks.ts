import { useEffect } from "react"
import {
  UI_COMMAND_EVENT,
  WORKSPACE_ATTENTION_ACTION_EVENT,
  WORKSPACE_COMPOSER_STOP_EVENT,
  WORKSPACE_SURFACE_OPEN_SKIPPED_EVENT,
  events,
  useWorkspaceAttention,
  workspaceComposerStopAppliesToSession,
  workspaceComposerStopTargetSessionId,
  workspaceEvents,
  type WorkspaceAttentionActionDetail,
} from "@hachej/boring-workspace"
import { ASK_USER_PLUGIN_ID, ASK_USER_SURFACE_KIND, ASK_USER_UI_STATE_SLOTS } from "../shared/constants"
import { createQuestionsClient, readPendingQuestionHintsFromState, type PendingQuestionHint } from "./client"
import { isSessionOpen, type QuestionsRuntime } from "./runtime"

export function useAskUserAttentionBlockers(runtime: QuestionsRuntime, pendingSnapshot: string): void {
  const { addBlocker, removeBlocker } = useWorkspaceAttention()
  useEffect(() => {
    const blockerIds: string[] = []
    for (const hint of runtime.getPendingHints()) {
      if (hint.status && hint.status !== "ready") continue
      const blockerId = `${ASK_USER_PLUGIN_ID}:${hint.sessionId}:${hint.questionId}`
      blockerIds.push(blockerId)
      const hydrated = runtime.getPending(hint.sessionId)
      const isActiveHint = runtime.activeSessionId === hint.sessionId && isSessionOpen(runtime, hint.sessionId)
      const actions = hydrated
        ? [{ id: "open", label: "Open Questions" }, { id: "cancel", label: "Cancel question" }]
        : isActiveHint
          ? [{ id: "open", label: "Open Questions" }]
          : undefined
      addBlocker({
        id: blockerId,
        reason: "ask-user.question",
        surfaceKind: ASK_USER_SURFACE_KIND,
        target: hint.questionId,
        label: hydrated?.title ?? "Answer the question in Questions to continue",
        sessionId: hint.sessionId,
        sessionBadge: { kind: "question", label: "question", tone: "attention", priority: 10 },
        pruneWhenSessionMissing: true,
        focus: { closeWorkbenchLeftPane: true },
        inbox: {
          kind: "question",
          sourceLabel: "question",
          createdAt: hydrated?.createdAt,
          updatedAt: hydrated?.updatedAt ?? hydrated?.createdAt,
          priority: 10,
          artifact: hydrated?.artifact,
        },
        actions,
      })
    }
    return () => { for (const blockerId of blockerIds) removeBlocker(blockerId) }
  }, [addBlocker, removeBlocker, runtime, pendingSnapshot])
}

export function useAskUserAttentionActions(runtime: QuestionsRuntime): void {
  useEffect(() => {
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceAttentionActionDetail>).detail
      if (!detail || detail.actionId !== "cancel" || detail.blocker.reason !== "ask-user.question") return
      const sessionId = detail.blocker.sessionId ?? detail.sessionId ?? runtime.activeSessionId
      const pending = runtime.getPending(sessionId)
      if (!pending || (detail.blocker.target && pending.questionId !== detail.blocker.target)) return
      runtime.setPending(null, pending.sessionId)
      void createQuestionsClient({ apiBaseUrl: runtime.apiBaseUrl, headers: runtime.authHeaders }).cancel(pending).catch(() => undefined)
    }
    window.addEventListener(WORKSPACE_ATTENTION_ACTION_EVENT, onAction)
    return () => window.removeEventListener(WORKSPACE_ATTENTION_ACTION_EVENT, onAction)
  }, [runtime])
}

export function useAskUserComposerStopCancel(runtime: QuestionsRuntime): void {
  useEffect(() => {
    const onStop = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail
      const sessionId = workspaceComposerStopTargetSessionId(detail, runtime.activeSessionId)
      const pending = runtime.getPending(sessionId)
      if (!pending || !workspaceComposerStopAppliesToSession(detail, pending.sessionId, {
        fallbackSessionId: runtime.activeSessionId,
      })) return
      runtime.setPending(null, pending.sessionId)
      void createQuestionsClient({ apiBaseUrl: runtime.apiBaseUrl, headers: runtime.authHeaders }).cancel(pending).catch(() => undefined)
    }
    window.addEventListener(WORKSPACE_COMPOSER_STOP_EVENT, onStop)
    return () => window.removeEventListener(WORKSPACE_COMPOSER_STOP_EVENT, onStop)
  }, [runtime])
}

export function useAskUserPendingRefresh(
  runtime: QuestionsRuntime,
  options: {
    apiBaseUrl: string
    authHeaders?: Record<string, string>
    activeSessionId?: string | null
  },
): void {
  const { activeSessionId, apiBaseUrl, authHeaders } = options
  useEffect(() => {
    let stopped = false
    async function refreshPending() {
      let hints: PendingQuestionHint[] = []
      try {
        const response = await fetch(`${apiBaseUrl}/api/v1/ui/state`, { headers: authHeaders })
        const state = await response.json().catch(() => null) as Record<string, unknown> | null
        hints = readPendingQuestionHintsFromState(state)
        if (!stopped && hasPendingStateSlot(state)) runtime.setPendingHints(hints)
      } catch {
        // UI state is a hint channel only; keep already-hydrated pending payloads.
      }
      const sessionsToHydrate = new Set<string>()
      if (activeSessionId) sessionsToHydrate.add(activeSessionId)
      for (const hint of hints) {
        // A pending question can belong to a session that is no longer mounted
        // in the current chat layout (for example a fresh/demo URL opened while
        // an ask_user form is still blocking an older session). Hydrate every
        // server-published hint so the Questions pane can still render the
        // blocking form instead of an empty state.
        sessionsToHydrate.add(hint.sessionId)
      }
      await Promise.all([...sessionsToHydrate].map(async (sessionId) => {
        try {
          await runtime.refreshPending(sessionId)
        } catch {
          if (!stopped) runtime.setPending(null, sessionId)
        }
      }))
    }
    const onVisibility = () => { if (document.visibilityState === "visible") void refreshPending() }
    const onUiCommand = () => { void refreshPending() }
    const onSurfaceOpenSkipped = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: unknown }>).detail
      if (detail?.kind === ASK_USER_SURFACE_KIND) void refreshPending()
    }
    // Questions are created mid-run by the ask_user tool, with no focus or
    // UI-command transition to piggyback on. Throttle-refresh while agent
    // stream parts flow so the pending question (and its blocker/badge)
    // appears without requiring a tab switch or reload.
    let agentDataTimer: ReturnType<typeof setTimeout> | null = null
    const onAgentData = () => {
      if (agentDataTimer) return
      agentDataTimer = setTimeout(() => {
        agentDataTimer = null
        void refreshPending()
      }, 1200)
    }
    const offAgentData = events.on(workspaceEvents.agentData, onAgentData)
    const offUiCommand = events.on(workspaceEvents.uiCommand, onUiCommand)
    void refreshPending()
    window.addEventListener("focus", refreshPending)
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener(UI_COMMAND_EVENT, onUiCommand)
    window.addEventListener(WORKSPACE_SURFACE_OPEN_SKIPPED_EVENT, onSurfaceOpenSkipped)
    return () => {
      stopped = true
      if (agentDataTimer) clearTimeout(agentDataTimer)
      offAgentData()
      offUiCommand()
      window.removeEventListener("focus", refreshPending)
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener(UI_COMMAND_EVENT, onUiCommand)
      window.removeEventListener(WORKSPACE_SURFACE_OPEN_SKIPPED_EVENT, onSurfaceOpenSkipped)
    }
  }, [activeSessionId, apiBaseUrl, authHeaders, runtime])
}

function hasPendingStateSlot(state: Record<string, unknown> | null): boolean {
  return !!state && Object.prototype.hasOwnProperty.call(state, ASK_USER_UI_STATE_SLOTS.PENDING)
}
