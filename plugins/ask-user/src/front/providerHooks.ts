import { useEffect, useMemo } from "react"
import {
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
import { createQuestionsClient } from "./client"
import { createPendingRefreshCoordinator } from "./pendingRefresh"
import { isSessionOpen, type QuestionsRuntime, type QuestionsStore } from "./runtime"

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
        agentTypeId: runtime.agentTypeId,
        sessionBadge: { kind: "question", label: "question", tone: "attention", priority: 10 },
        pruneWhenSessionMissing: true,
        focus: { closeWorkbenchLeftPane: true },
        composer: { visible: false },
        inbox: {
          kind: "question",
          sourceLabel: "question",
          createdAt: hydrated?.createdAt,
          updatedAt: hydrated?.updatedAt ?? hydrated?.createdAt,
          priority: 10,
          artifacts: hydrated?.artifacts ?? [],
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
      const sessionId = detail.blocker.sessionId ?? detail.sessionId
      if (!sessionId) return
      const pending = runtime.getPending(sessionId)
      if (!pending || (detail.blocker.target && pending.questionId !== detail.blocker.target)) return
      if (!runtime.beginQuestionAction(pending)) return
      runtime.setPending(null, pending.sessionId)
      void createQuestionsClient({ apiBaseUrl: runtime.apiBaseUrl, headers: runtime.authHeaders }).cancel(pending)
        .catch(() => undefined)
        .finally(() => runtime.finishQuestionAction(pending))
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
      if (!runtime.beginQuestionAction(pending)) return
      runtime.setPending(null, pending.sessionId)
      void createQuestionsClient({ apiBaseUrl: runtime.apiBaseUrl, headers: runtime.authHeaders }).cancel(pending)
        .catch(() => undefined)
        .finally(() => runtime.finishQuestionAction(pending))
    }
    window.addEventListener(WORKSPACE_COMPOSER_STOP_EVENT, onStop)
    return () => window.removeEventListener(WORKSPACE_COMPOSER_STOP_EVENT, onStop)
  }, [runtime])
}

export function useAskUserPendingRefresh(
  store: QuestionsStore,
  options: {
    apiBaseUrl: string
    authHeaders?: Record<string, string>
    activeSessionId?: string | null
  },
): (sessionId?: string) => void {
  const { activeSessionId, apiBaseUrl, authHeaders } = options
  const coordinator = useMemo(
    () => createPendingRefreshCoordinator({ apiBaseUrl, authHeaders, store }),
    [apiBaseUrl, authHeaders, store],
  )
  useEffect(() => {
    const deactivate = coordinator.activate(activeSessionId)
    const onRefreshRequested = () => coordinator.request()
    const onVisibility = () => { if (document.visibilityState === "visible") coordinator.request() }
    const onUiStateInvalidated = ({ keys }: { keys: string[] }) => {
      if (keys.includes(ASK_USER_UI_STATE_SLOTS.PENDING)) coordinator.request()
    }
    const onUiCommandConnection = ({ connected }: { connected: boolean }) => {
      if (connected) coordinator.request()
    }
    const onSurfaceOpenSkipped = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: unknown }>).detail
      if (detail?.kind === ASK_USER_SURFACE_KIND) coordinator.request()
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
        coordinator.request()
      }, 1200)
    }
    const offAgentData = events.on(workspaceEvents.agentData, onAgentData)
    // Local `postUiCommand` emits on both the bus and the DOM channel, so the
    // bus alone avoids duplicate local refreshes. Remote stream commands bypass
    // that bus; invalidation and connection recovery cover their state changes.
    const offUiCommand = events.on(workspaceEvents.uiCommand, onRefreshRequested)
    const offUiStateInvalidated = events.on(workspaceEvents.uiStateInvalidated, onUiStateInvalidated)
    const offUiCommandConnection = events.on(workspaceEvents.uiCommandConnection, onUiCommandConnection)
    window.addEventListener("focus", onRefreshRequested)
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener(WORKSPACE_SURFACE_OPEN_SKIPPED_EVENT, onSurfaceOpenSkipped)
    return () => {
      if (agentDataTimer) clearTimeout(agentDataTimer)
      offAgentData()
      offUiCommand()
      offUiStateInvalidated()
      offUiCommandConnection()
      window.removeEventListener("focus", onRefreshRequested)
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener(WORKSPACE_SURFACE_OPEN_SKIPPED_EVENT, onSurfaceOpenSkipped)
      deactivate()
    }
  }, [activeSessionId, coordinator])
  return coordinator.request
}
