"use client"

import { Button, EmptyState, Notice, Pane, PaneBody, PaneFooter, PaneHeader, PaneTitle } from "@hachej/boring-ui-kit"
import {
  UI_COMMAND_EVENT,
  events,
  postUiCommand,
  useWorkspaceAttention,
  workspaceEvents,
  type PaneProps,
  type PluginProviderProps,
} from "@hachej/boring-workspace"
import {
  definePlugin,
  type BoringFrontFactoryWithId,
} from "@hachej/boring-workspace/plugin"
import { HelpCircle, XCircle } from "lucide-react"
import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, useState } from "react"
import { ASK_USER_PANEL_ID, ASK_USER_PANEL_TITLE, ASK_USER_PLUGIN_ID, ASK_USER_SURFACE_KIND, ASK_USER_UI_STATE_SLOTS } from "../shared/constants"
import type { AskUserQuestion } from "../shared/types"
import { createQuestionsClient, readPendingQuestionHintsFromState, QuestionsClientError, type PendingQuestionHint } from "./client"
import { QuestionCancelButton, QuestionFields, QuestionForm, QuestionFormProvider, QuestionSubmitButton } from "./primitives"

type QuestionsStore = {
  getPending(sessionId?: string | null): AskUserQuestion | null
  setPending(question: AskUserQuestion | null, sessionId?: string | null): void
  getPendingHints(): PendingQuestionHint[]
  getHydratedPendingKeys(): string[]
  setPendingHints(hints: PendingQuestionHint[]): void
  subscribe(listener: () => void): () => void
}

type QuestionsRuntime = QuestionsStore & {
  apiBaseUrl: string
  authHeaders?: Record<string, string>
  activeSessionId?: string | null
  refreshPending(sessionId: string): Promise<AskUserQuestion | null>
}

function createQuestionsStore(): QuestionsStore {
  const listeners = new Set<() => void>()
  const pendingBySession = new Map<string, AskUserQuestion>()
  const hintsBySession = new Map<string, PendingQuestionHint>()
  let lastSessionId: string | null = null
  const emit = () => { for (const listener of [...listeners]) listener() }
  return {
    getPending(sessionId) {
      const id = sessionId ?? lastSessionId
      return id ? pendingBySession.get(id) ?? null : null
    },
    setPending(question, sessionId) {
      if (question) {
        pendingBySession.set(question.sessionId, question)
        hintsBySession.set(question.sessionId, { questionId: question.questionId, sessionId: question.sessionId, status: question.status })
        lastSessionId = question.sessionId
      } else if (sessionId) {
        pendingBySession.delete(sessionId)
        hintsBySession.delete(sessionId)
        if (lastSessionId === sessionId) lastSessionId = null
      } else {
        pendingBySession.clear()
        hintsBySession.clear()
        lastSessionId = null
      }
      emit()
    },
    getPendingHints() {
      return [...hintsBySession.values()]
    },
    getHydratedPendingKeys() {
      return [...pendingBySession.values()].map((question) => `${question.sessionId}:${question.questionId}:${question.status}`)
    },
    setPendingHints(hints) {
      hintsBySession.clear()
      const authoritativeHints = new Map<string, PendingQuestionHint>()
      for (const hint of hints) {
        hintsBySession.set(hint.sessionId, hint)
        authoritativeHints.set(hint.sessionId, hint)
      }
      for (const [sessionId, question] of [...pendingBySession.entries()]) {
        const hint = authoritativeHints.get(sessionId)
        if (!hint || hint.questionId !== question.questionId || (hint.status && hint.status !== question.status)) {
          pendingBySession.delete(sessionId)
        }
      }
      if (lastSessionId && !pendingBySession.has(lastSessionId)) lastSessionId = null
      emit()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

// Singleton store at module scope so the "Open Questions" command's `when()`
// predicate can check the pending state without React. The provider mounts
// this same instance into its runtime context.
const sharedQuestionsStore: QuestionsStore = createQuestionsStore()

const QuestionsRuntimeContext = createContext<QuestionsRuntime | null>(null)

function sessionScopedBlockerId(sessionId: string): string | undefined {
  return sessionId === "default" || sessionId === "anonymous" ? undefined : sessionId
}

function pendingQuestionSnapshot(store: QuestionsStore): string {
  const hints = store.getPendingHints()
    .map((hint) => `${hint.sessionId}:${hint.questionId}:${hint.status ?? "ready"}`)
    .sort()
  const hydrated = store.getHydratedPendingKeys().sort()
  return `${hints.length ? hints.join("|") : "none"}#hydrated=${hydrated.join("|")}`
}

function hasPendingStateSlot(state: Record<string, unknown> | null): boolean {
  return !!state && Object.prototype.hasOwnProperty.call(state, ASK_USER_UI_STATE_SLOTS.PENDING)
}

function useQuestionsRuntime(): QuestionsRuntime {
  const ctx = useContext(QuestionsRuntimeContext)
  if (!ctx) throw new Error("askUserPlugin QuestionsPane must be rendered under AskUserProvider")
  return ctx
}

function AskUserProvider({ apiBaseUrl, authHeaders, activeSessionId, children }: PluginProviderProps) {
  const { addBlocker, removeBlocker } = useWorkspaceAttention()
  const runtime = useMemo<QuestionsRuntime>(() => ({
    ...sharedQuestionsStore,
    apiBaseUrl,
    authHeaders,
    activeSessionId,
    async refreshPending(sessionId) {
      const pending = await createQuestionsClient({ apiBaseUrl, headers: authHeaders }).pending(sessionId)
      sharedQuestionsStore.setPending(pending, sessionId)
      return pending
    },
  }), [activeSessionId, apiBaseUrl, authHeaders])
  const pendingSnapshot = useSyncExternalStore(runtime.subscribe, () => pendingQuestionSnapshot(runtime), () => "none")
  const autoOpenedQuestionsRef = useRef(new Set<string>())
  useEffect(() => {
    const blockerIds: string[] = []
    for (const hint of runtime.getPendingHints()) {
      if (hint.status && hint.status !== "ready") continue
      const blockerId = `${ASK_USER_PLUGIN_ID}:${hint.sessionId}:${hint.questionId}`
      blockerIds.push(blockerId)
      const hydrated = runtime.getPending(hint.sessionId)
      addBlocker({
        id: blockerId,
        reason: "waiting_for_user_input",
        surfaceKind: ASK_USER_SURFACE_KIND,
        target: hint.questionId,
        label: "Answer the question in Questions to continue",
        sessionId: sessionScopedBlockerId(hint.sessionId),
        actions: hydrated ? [{ id: "open", label: "Open Questions" }, { id: "cancel", label: "Cancel question" }] : undefined,
      })
    }
    return () => { for (const blockerId of blockerIds) removeBlocker(blockerId) }
  }, [addBlocker, removeBlocker, runtime, pendingSnapshot])

  useEffect(() => {
    if (!activeSessionId) return
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

  useEffect(() => {
    const onStop = (event: Event) => {
      const sessionId = (event as CustomEvent<{ sessionId?: string }>).detail?.sessionId ?? runtime.activeSessionId
      const pending = runtime.getPending(sessionId)
      if (!pending || (sessionId && sessionScopedBlockerId(pending.sessionId) && sessionId !== pending.sessionId)) return
      runtime.setPending(null, pending.sessionId)
      void createQuestionsClient({ apiBaseUrl: runtime.apiBaseUrl, headers: runtime.authHeaders }).cancel(pending).catch(() => undefined)
    }
    window.addEventListener("boring:workspace-composer-stop", onStop)
    return () => window.removeEventListener("boring:workspace-composer-stop", onStop)
  }, [runtime])

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
      if (activeSessionId) {
        try {
          await runtime.refreshPending(activeSessionId)
        } catch {
          if (!stopped) runtime.setPending(null, activeSessionId)
        }
      } else {
        const hint = hints[0]
        if (hint) await runtime.refreshPending(hint.sessionId).catch(() => undefined)
      }
    }
    const onVisibility = () => { if (document.visibilityState === "visible") void refreshPending() }
    const onUiCommand = () => { void refreshPending() }
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
    return () => {
      stopped = true
      if (agentDataTimer) clearTimeout(agentDataTimer)
      offAgentData()
      offUiCommand()
      window.removeEventListener("focus", refreshPending)
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener(UI_COMMAND_EVENT, onUiCommand)
    }
  }, [activeSessionId, apiBaseUrl, authHeaders, runtime])
  return <QuestionsRuntimeContext.Provider value={runtime}>{children}</QuestionsRuntimeContext.Provider>
}

type QuestionsPaneParams = { questionId?: string; sessionId?: string; __closeWorkbenchOnDone?: () => void }

function QuestionsPane({ api, params, className }: PaneProps<QuestionsPaneParams>) {
  const runtime = useQuestionsRuntime()
  const paneSessionId = params?.sessionId ?? runtime.activeSessionId ?? null
  const pending = useSyncExternalStore(runtime.subscribe, () => runtime.getPending(paneSessionId), () => runtime.getPending(paneSessionId))
  const [closedQuestionId, setClosedQuestionId] = useState<string | null>(null)
  const retargetRefreshRef = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const question = pending?.questionId === closedQuestionId ? null : pending
  const client = useMemo(() => createQuestionsClient({ apiBaseUrl: runtime.apiBaseUrl, headers: runtime.authHeaders }), [runtime.apiBaseUrl, runtime.authHeaders])
  useEffect(() => {
    const onStop = (event: Event) => {
      const sessionId = (event as CustomEvent<{ sessionId?: string }>).detail?.sessionId
      if (!question || (sessionId && sessionScopedBlockerId(question.sessionId) && sessionId !== question.sessionId)) return
      setClosedQuestionId(question.questionId)
      runtime.setPending(null, question.sessionId)
      api.close()
    }
    window.addEventListener("boring:workspace-composer-stop", onStop)
    return () => window.removeEventListener("boring:workspace-composer-stop", onStop)
  }, [api, question, runtime])
  useEffect(() => {
    if (!paneSessionId) return
    const targetQuestionId = params?.questionId
    if (!pending) {
      retargetRefreshRef.current = null
      void runtime.refreshPending(paneSessionId).catch(() => undefined)
      return
    }
    if (!targetQuestionId || pending.questionId === targetQuestionId) {
      retargetRefreshRef.current = null
      return
    }
    const refreshKey = `${paneSessionId}:${targetQuestionId}`
    if (retargetRefreshRef.current === refreshKey) return
    retargetRefreshRef.current = refreshKey
    void runtime.refreshPending(paneSessionId).catch(() => undefined)
  }, [paneSessionId, params?.questionId, pending, runtime])

  return <div className={className ? `${className} min-h-0 overflow-hidden` : "h-full min-h-0 overflow-hidden"}>
    <Pane className="h-full min-h-0 overflow-hidden border-0 bg-background text-sm">
      <PaneHeader className="border-b bg-background/95">
        <div>
          <PaneTitle className="flex items-center gap-2"><HelpCircle className="h-4 w-4 text-muted-foreground" /> Agent needs input</PaneTitle>
        </div>
      </PaneHeader>
      {!question ? <PaneBody className="overflow-auto p-4"><EmptyState icon={<HelpCircle className="h-5 w-5" />} title="No pending questions" description="When the agent needs a decision, the form will appear here." className="border border-dashed bg-muted/20" /></PaneBody> : null}
      {question?.status === "ready" && question.schema ? (
        <QuestionFormProvider key={question.questionId} schema={question.schema} submitting={submitting} onSubmit={async (values) => {
          setSubmitting(true); setError(null)
          try { await client.submit(question, values); setClosedQuestionId(question.questionId); runtime.setPending(null, question.sessionId); api.close(); params?.__closeWorkbenchOnDone?.() }
          catch (err) { setError(err instanceof QuestionsClientError ? err.message : String(err)) }
          finally { setSubmitting(false) }
        }} onCancel={async () => {
          setSubmitting(true); setError(null)
          try { await client.cancel(question); setClosedQuestionId(question.questionId); runtime.setPending(null, question.sessionId); api.close(); params?.__closeWorkbenchOnDone?.() }
          catch (err) { setError(err instanceof QuestionsClientError ? err.message : String(err)) }
          finally { setSubmitting(false) }
        }}>
          <QuestionForm className="flex min-h-0 flex-1 flex-col">
            <PaneBody className="overflow-auto p-4">
              <div className="space-y-4">
                <section className="rounded-md border border-border/60 bg-muted/30 p-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Waiting for answer</div>
                  <h2 className="mt-2 text-balance text-sm font-semibold leading-5 text-foreground">{question.title ?? "Question"}</h2>
                  {question.context ? <p className="mt-2 max-w-prose text-sm leading-6 text-muted-foreground">{question.context}</p> : null}
                </section>
                <div className="space-y-4"><QuestionFields /></div>
                {error ? <Notice tone="destructive" role="alert">{error}</Notice> : null}
              </div>
            </PaneBody>
            <PaneFooter className="justify-between border-t bg-background px-4 py-3"><p className="min-w-0 text-xs text-muted-foreground">Sends answers and closes the pane.</p><div className="flex gap-2"><Button asChild variant="outline" size="sm"><QuestionCancelButton>Cancel</QuestionCancelButton></Button><Button asChild size="sm"><QuestionSubmitButton>{question.schema.submitLabel ?? "Send answers"}</QuestionSubmitButton></Button></div></PaneFooter>
          </QuestionForm>
        </QuestionFormProvider>
      ) : null}
      {question && question.status !== "ready" ? <PaneBody className="p-5"><Notice><span className="flex items-center gap-2"><XCircle className="h-4 w-4 text-muted-foreground" />Question {question.status}</span></Notice></PaneBody> : null}
    </Pane>
  </div>
}

/**
 * `BoringFrontFactoryWithId` for the ask-user plugin. Registers
 * (1) a provider that owns the per-app questions runtime (apiBaseUrl,
 * auth headers, in-memory pending-question store), (2) a "Questions"
 * panel rendering the pending question form, and (3) a surface
 * resolver mapping ASK_USER_SURFACE_KIND requests into the panel.
 *
 * Pass directly to `WorkspaceProvider.plugins`.
 *
 * The panel is opened via the surface resolver (kind: ASK_USER_SURFACE_KIND),
 * which is how the server-side agent tool triggers it.
 */
export const askUserPlugin: BoringFrontFactoryWithId = definePlugin({
  id: ASK_USER_PLUGIN_ID,
  label: ASK_USER_PANEL_TITLE,
  providers: [
    {
      id: `${ASK_USER_PLUGIN_ID}.provider`,
      component: AskUserProvider,
    },
  ],
  panels: [
    {
      id: ASK_USER_PANEL_ID,
      label: ASK_USER_PANEL_TITLE,
      icon: HelpCircle,
      component: QuestionsPane,
      placement: "center",
      source: "builtin",
      chromeless: true,
    },
  ],
  surfaceResolvers: [
    {
      id: `${ASK_USER_PLUGIN_ID}.surface`,
      kind: ASK_USER_SURFACE_KIND,
      source: "builtin",
      // No inner kind guard — the workspace's surface registry already
      // pre-filters by the top-level `kind` field before calling resolve.
      resolve(request) {
        const sessionId =
          typeof request.meta === "object" && request.meta && typeof (request.meta as { sessionId?: unknown }).sessionId === "string"
            ? (request.meta as { sessionId: string }).sessionId
            : undefined
        return {
          component: ASK_USER_PANEL_ID,
          id: ASK_USER_PANEL_ID,
          title: ASK_USER_PANEL_TITLE,
          params: { questionId: request.target, sessionId },
        }
      },
    },
  ],
})

export default askUserPlugin
