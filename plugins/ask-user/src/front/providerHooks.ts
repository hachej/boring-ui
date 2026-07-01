import { useEffect, useRef } from "react"
import {
  UI_COMMAND_EVENT,
  WORKSPACE_ATTENTION_ACTION_EVENT,
  WORKSPACE_COMPOSER_STOP_EVENT,
  WORKSPACE_SURFACE_OPEN_SKIPPED_EVENT,
  events,
  postUiCommand,
  useWorkspaceAttention,
  useWorkspaceHumanActionTargets,
  workspaceComposerStopAppliesToSession,
  workspaceComposerStopTargetSessionId,
  workspaceEvents,
  type WorkspaceAttentionActionDetail,
  type WorkspaceHumanActionButton,
  type WorkspaceHumanActionTargetRef,
} from "@hachej/boring-workspace"
import { ASK_USER_SURFACE_KIND, ASK_USER_UI_STATE_SLOTS } from "../shared/constants"
import { askUserHumanActionToBlockerProjection } from "../shared/humanAction"
import { formatHumanActionReviewForLlm, type HumanActionReviewResult } from "../shared/humanActionAnnotations"
import type { AskUserFormSchema, AskUserQuestion, AskUserTargetHumanAction } from "../shared/types"
import { createQuestionsClient, readPendingQuestionHintsFromState, type PendingQuestionHint } from "./client"
import { isSessionOpen, type QuestionsRuntime } from "./runtime"

export function useAskUserAttentionBlockers(runtime: QuestionsRuntime, pendingSnapshot: string): void {
  const { addBlocker, removeBlocker } = useWorkspaceAttention()
  useEffect(() => {
    const blockerIds: string[] = []
    for (const hint of runtime.getPendingHints()) {
      if (hint.status && hint.status !== "ready") continue
      const hydrated = runtime.getPending(hint.sessionId)
      const blocker = askUserHumanActionToBlockerProjection({
        hint,
        question: hydrated,
        isActiveHint: runtime.activeSessionId === hint.sessionId && isSessionOpen(runtime, hint.sessionId),
      })
      if (!blocker) continue
      blockerIds.push(blocker.id)
      addBlocker(blocker)
    }
    return () => { for (const blockerId of blockerIds) removeBlocker(blockerId) }
  }, [addBlocker, removeBlocker, runtime, pendingSnapshot])
}

function workspaceTargetFromAskUserTarget(target: AskUserTargetHumanAction["target"]): WorkspaceHumanActionTargetRef {
  if (target.type === "file") return { type: "file", path: target.path, ...(target.workspaceId ? { workspaceId: target.workspaceId } : {}), ...(target.label ? { label: target.label } : {}) }
  if (target.type === "surface") return { type: "surface", surfaceKind: target.surfaceKind, target: target.target, ...(target.label ? { label: target.label } : {}) }
  if (target.type === "panel") return { type: "panel", component: target.component, ...(target.instanceId ? { instanceId: target.instanceId } : {}), ...(target.label ? { label: target.label } : {}) }
  const _exhaustive: never = target
  return _exhaustive
}

function schemaHasField(schema: AskUserFormSchema | undefined, name: string): boolean {
  return !!schema?.fields.some((field) => field.name === name)
}

function annotationSeverityForButton(button: WorkspaceHumanActionButton): NonNullable<HumanActionReviewResult["annotations"]>[number]["severity"] {
  if (button.tone === "danger") return "blocker"
  if (button.tone === "warning") return "issue"
  if (button.tone === "positive") return "note"
  return "suggestion"
}

function buildTargetReviewValues(args: {
  pending: AskUserQuestion
  action: AskUserTargetHumanAction
  button: WorkspaceHumanActionButton
  comment?: string
}): Record<string, string> {
  const { pending, action, button, comment } = args
  const values: Record<string, string> = {
    [action.actionFieldName ?? "action"]: button.id,
  }
  const commentFieldName = action.commentFieldName ?? "comment"
  const reviewFieldName = action.reviewFieldName ?? "review"
  const annotationsFieldName = action.annotationsFieldName ?? "annotations"
  if (comment && schemaHasField(pending.schema, commentFieldName)) values[commentFieldName] = comment

  if (schemaHasField(pending.schema, reviewFieldName) || schemaHasField(pending.schema, annotationsFieldName)) {
    const review: HumanActionReviewResult = {
      humanActionId: action.id ?? pending.questionId,
      decisionId: button.id,
      ...(comment ? { comment } : {}),
      ...(comment ? {
        annotations: [{
          id: `${pending.questionId}:${button.id}:global`,
          target: action.target,
          anchor: { type: "global" },
          body: comment,
          severity: annotationSeverityForButton(button),
          createdAt: new Date().toISOString(),
        }],
      } : {}),
    }
    if (schemaHasField(pending.schema, reviewFieldName)) values[reviewFieldName] = formatHumanActionReviewForLlm(review)
    if (schemaHasField(pending.schema, annotationsFieldName)) values[annotationsFieldName] = JSON.stringify(review)
  }
  return values
}

export function useAskUserTargetActions(runtime: QuestionsRuntime, pendingSnapshot: string): void {
  const { registerTargetAction } = useWorkspaceHumanActionTargets()
  useEffect(() => {
    const cleanups: Array<() => void> = []
    const client = createQuestionsClient({ apiBaseUrl: runtime.apiBaseUrl, headers: runtime.authHeaders })
    for (const hint of runtime.getPendingHints()) {
      const pending = runtime.getPending(hint.sessionId)
      const action = pending?.humanAction
      if (!pending || pending.status !== "ready" || !action) continue
      const target = workspaceTargetFromAskUserTarget(action.target)
      cleanups.push(registerTargetAction({
        id: `${pending.questionId}:${action.id ?? action.kind}`,
        title: action.title,
        ...(action.body ? { body: action.body } : {}),
        target,
        pluginId: "ask-user",
        createdAt: pending.createdAt,
        actions: action.actions.map((button): WorkspaceHumanActionButton => ({
          id: button.id,
          label: button.label,
          ...(button.tone ? { tone: button.tone } : {}),
          ...(button.comment ? { comment: button.comment } : {}),
        })),
        async onAction({ action: button, comment }) {
          await client.submit(pending, buildTargetReviewValues({ pending, action, button, comment }))
          runtime.setPending(null, pending.sessionId)
        },
      }))
    }
    return () => { for (const cleanup of cleanups) cleanup() }
  }, [pendingSnapshot, registerTargetAction, runtime])
}

export function useAskUserAutoOpen(runtime: QuestionsRuntime, activeSessionId: string | null | undefined, pendingSnapshot: string): void {
  const autoOpenedQuestionsRef = useRef(new Set<string>())
  useEffect(() => {
    for (const hint of runtime.getPendingHints()) {
      if (!isSessionOpen(runtime, hint.sessionId)) autoOpenedQuestionsRef.current.delete(`${hint.sessionId}:${hint.questionId}`)
    }
    if (!activeSessionId || !isSessionOpen(runtime, activeSessionId)) return
    const hint = runtime.getPendingHints().find((candidate) => candidate.sessionId === activeSessionId)
    if (!hint || (hint.status && hint.status !== "ready")) return
    const hydrated = runtime.getPending(activeSessionId)
    if (!hydrated || hydrated.questionId !== hint.questionId || hydrated.status !== "ready") return
    const key = `${hint.sessionId}:${hint.questionId}`
    if (autoOpenedQuestionsRef.current.has(key)) return
    autoOpenedQuestionsRef.current.add(key)
    postUiCommand({
      kind: "openSurface",
      params: {
        kind: ASK_USER_SURFACE_KIND,
        target: hint.questionId,
        meta: { sessionId: hint.sessionId, openOnlyWhenSessionOpen: true },
      },
    })
  }, [activeSessionId, runtime, pendingSnapshot])
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
        if (isSessionOpen(runtime, hint.sessionId)) sessionsToHydrate.add(hint.sessionId)
      }
      if (sessionsToHydrate.size === 0 && hints[0]) sessionsToHydrate.add(hints[0].sessionId)
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
