"use client"

import { Button, EmptyState, Notice, Pane, PaneBody, PaneFooter, PaneHeader, PaneTitle } from "@hachej/boring-ui-kit"
import {
  UI_COMMAND_EVENT,
  useWorkspaceAttention,
  type PaneProps,
  type PluginProviderProps,
} from "@hachej/boring-workspace"
import {
  definePlugin,
  type BoringFrontFactoryWithId,
} from "@hachej/boring-workspace/plugin"
import { HelpCircle, XCircle } from "lucide-react"
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, useState } from "react"
import { ASK_USER_PANEL_ID, ASK_USER_PANEL_TITLE, ASK_USER_PLUGIN_ID, ASK_USER_SURFACE_KIND } from "../shared/constants"
import type { AskUserQuestion } from "../shared/types"
import { createQuestionsClient, normalizeQuestion, QuestionsClientError } from "./client"
import { QuestionCancelButton, QuestionFields, QuestionForm, QuestionFormProvider, QuestionSubmitButton, type QuestionFormValues } from "./primitives"

type QuestionsStore = {
  getPending(): AskUserQuestion | null
  setPending(question: AskUserQuestion | null): void
  getDraft(question: AskUserQuestion): QuestionFormValues | undefined
  setDraft(question: AskUserQuestion, values: QuestionFormValues): void
  clearDraft(question: AskUserQuestion): void
  subscribe(listener: () => void): () => void
}

type QuestionsRuntime = QuestionsStore & {
  apiBaseUrl: string
  authHeaders?: Record<string, string>
  activeSessionId?: string | null
}

function createQuestionsStore(): QuestionsStore {
  const listeners = new Set<() => void>()
  let pending: AskUserQuestion | null = null
  return {
    getPending: () => pending,
    setPending(question) {
      pending = question
      for (const listener of [...listeners]) listener()
    },
    getDraft(question) {
      return readQuestionDraft(question)
    },
    setDraft(question, values) {
      writeQuestionDraft(question, values)
    },
    clearDraft(question) {
      clearQuestionDraft(question)
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

function draftKey(question: AskUserQuestion): string {
  return `ask-user:draft:${question.sessionId}:${question.questionId}`
}

function readQuestionDraft(question: AskUserQuestion): QuestionFormValues | undefined {
  try {
    const raw = window.localStorage.getItem(draftKey(question))
    return raw ? JSON.parse(raw) as QuestionFormValues : undefined
  } catch { return undefined }
}

function writeQuestionDraft(question: AskUserQuestion, values: QuestionFormValues): void {
  try { window.localStorage.setItem(draftKey(question), JSON.stringify(values)) } catch { /* best effort */ }
}

function clearQuestionDraft(question: AskUserQuestion): void {
  try { window.localStorage.removeItem(draftKey(question)) } catch { /* best effort */ }
}

const QuestionsRuntimeContext = createContext<QuestionsRuntime | null>(null)

function sessionScopedBlockerId(sessionId: string): string | undefined {
  return sessionId === "default" || sessionId === "anonymous" ? undefined : sessionId
}

function pendingQuestionSnapshot(store: QuestionsStore): string {
  const pending = store.getPending()
  return pending ? `${pending.sessionId}:${pending.questionId}:${pending.status}` : "none"
}

function useQuestionsRuntime(): QuestionsRuntime {
  const ctx = useContext(QuestionsRuntimeContext)
  if (!ctx) throw new Error("askUserPlugin QuestionsPane must be rendered under AskUserProvider")
  return ctx
}

function AskUserProvider({ apiBaseUrl, authHeaders, activeSessionId, children }: PluginProviderProps) {
  const { addBlocker, removeBlocker } = useWorkspaceAttention()
  const runtime = useMemo<QuestionsRuntime>(() => ({ ...sharedQuestionsStore, apiBaseUrl, authHeaders, activeSessionId }), [apiBaseUrl, authHeaders, activeSessionId])
  const pendingSnapshot = useSyncExternalStore(runtime.subscribe, () => pendingQuestionSnapshot(runtime), () => "none")
  useEffect(() => {
    const pending = runtime.getPending()
    const blockerId = pending ? `${ASK_USER_PLUGIN_ID}:${pending.sessionId}:${pending.questionId}` : null
    if (pending?.status === "ready" && blockerId) {
      addBlocker({
        id: blockerId,
        reason: "waiting_for_user_input",
        surfaceKind: ASK_USER_SURFACE_KIND,
        target: pending.questionId,
        label: "Answer the question in Questions to continue",
        sessionId: sessionScopedBlockerId(pending.sessionId),
        actions: [{ id: "open", label: "Open Questions" }],
      })
    }
    return () => { if (blockerId) removeBlocker(blockerId) }
  }, [addBlocker, removeBlocker, runtime, pendingSnapshot])

  useEffect(() => {
    const onStop = (event: Event) => {
      const sessionId = (event as CustomEvent<{ sessionId?: string }>).detail?.sessionId
      const pending = runtime.getPending()
      if (!pending || (sessionId && sessionScopedBlockerId(pending.sessionId) && sessionId !== pending.sessionId)) return
      runtime.setPending(null)
      void createQuestionsClient({ apiBaseUrl: runtime.apiBaseUrl, headers: runtime.authHeaders }).cancel(pending).catch(() => undefined)
    }
    window.addEventListener("boring:workspace-composer-stop", onStop)
    return () => window.removeEventListener("boring:workspace-composer-stop", onStop)
  }, [runtime])

  useEffect(() => {
    let stopped = false
    async function refreshPending() {
      try {
        const sessionId = runtime.activeSessionId ?? runtime.getPending()?.sessionId ?? "default"
        const pending = await createQuestionsClient({ apiBaseUrl: runtime.apiBaseUrl, headers: runtime.authHeaders }).pending(sessionId)
        if (!stopped) runtime.setPending(pending)
      } catch { /* best effort */ }
    }
    const onVisibility = () => { if (document.visibilityState === "visible") void refreshPending() }
    const onUiCommand = () => { void refreshPending() }
    void refreshPending()
    window.addEventListener("focus", refreshPending)
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener(UI_COMMAND_EVENT, onUiCommand)
    return () => {
      stopped = true
      window.removeEventListener("focus", refreshPending)
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener(UI_COMMAND_EVENT, onUiCommand)
    }
  }, [runtime])
  return <QuestionsRuntimeContext.Provider value={runtime}>{children}</QuestionsRuntimeContext.Provider>
}

type QuestionsPaneParams = { questionId?: string; question?: AskUserQuestion; __closeWorkbenchOnDone?: () => void }

function QuestionsPane({ api, params, className }: PaneProps<QuestionsPaneParams>) {
  const runtime = useQuestionsRuntime()
  const pending = useSyncExternalStore(runtime.subscribe, runtime.getPending, runtime.getPending)
  const [closedQuestionId, setClosedQuestionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const paramQuestion = params?.question
  const question = pending ?? (paramQuestion?.questionId === closedQuestionId ? null : paramQuestion) ?? null
  const initialDraft = useMemo(
    () => question ? runtime.getDraft(question) : undefined,
    [runtime, question?.questionId, question?.sessionId],
  )
  const client = useMemo(() => createQuestionsClient({ apiBaseUrl: runtime.apiBaseUrl, headers: runtime.authHeaders }), [runtime.apiBaseUrl, runtime.authHeaders])
  useEffect(() => {
    const onStop = (event: Event) => {
      const sessionId = (event as CustomEvent<{ sessionId?: string }>).detail?.sessionId
      if (!question || (sessionId && sessionScopedBlockerId(question.sessionId) && sessionId !== question.sessionId)) return
      setClosedQuestionId(question.questionId)
      runtime.setPending(null)
      api.close()
    }
    window.addEventListener("boring:workspace-composer-stop", onStop)
    return () => window.removeEventListener("boring:workspace-composer-stop", onStop)
  }, [api, question, runtime])
  useEffect(() => {
    if (question && pending === null && !paramQuestion) api.close()
  }, [api, pending, paramQuestion, question])

  return <div className={className ?? "h-full"}>
    <Pane className="h-full border-0 bg-background text-sm">
      <PaneHeader className="border-b bg-background/95">
        <div>
          <PaneTitle className="flex items-center gap-2"><HelpCircle className="h-4 w-4 text-muted-foreground" /> Questions</PaneTitle>
        </div>
      </PaneHeader>
      {!question ? <PaneBody className="overflow-auto p-4"><EmptyState icon={<HelpCircle className="h-5 w-5" />} title="No pending questions" description="When the agent needs a decision, the form will appear here." className="border border-dashed bg-muted/20" /></PaneBody> : null}
      {question?.status === "ready" && question.schema ? (
        <QuestionFormProvider schema={question.schema} submitting={submitting} initialValues={initialDraft} onValuesChange={(values) => runtime.setDraft(question, values)} onSubmit={async (values) => {
          setSubmitting(true); setError(null)
          try { await client.submit(question, values); runtime.clearDraft(question); setClosedQuestionId(question.questionId); runtime.setPending(null); api.close(); params?.__closeWorkbenchOnDone?.() }
          catch (err) { setError(err instanceof QuestionsClientError ? err.message : String(err)) }
          finally { setSubmitting(false) }
        }} onCancel={async () => {
          setSubmitting(true); setError(null)
          try { await client.cancel(question); runtime.clearDraft(question); setClosedQuestionId(question.questionId); runtime.setPending(null); api.close(); params?.__closeWorkbenchOnDone?.() }
          catch (err) { setError(err instanceof QuestionsClientError ? err.message : String(err)) }
          finally { setSubmitting(false) }
        }}>
          <QuestionForm>
            <PaneBody className="overflow-auto p-4">
              <div className="space-y-4">
                <section className="rounded-md border border-border/60 bg-muted/30 p-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Agent needs input</div>
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
      {question && question.status !== "ready" ? <TerminalQuestionCard status={question.status} /> : null}
    </Pane>
  </div>
}

function TerminalQuestionCard({ status }: { status: AskUserQuestion["status"] }) {
  const label = terminalQuestionLabel(status)
  return <PaneBody className="p-5">
    <Notice>
      <span className="flex items-center gap-2"><XCircle className="h-4 w-4 text-muted-foreground" />{label}</span>
    </Notice>
  </PaneBody>
}

function terminalQuestionLabel(status: AskUserQuestion["status"]): string {
  switch (status) {
    case "answered": return "Question answered"
    case "cancelled": return "Question cancelled"
    case "timed_out": return "Question timed out"
    case "ui_unavailable": return "Question unavailable"
    case "abandoned": return "Question abandoned"
    case "ready": return "Question ready"
  }
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
export { usePendingQuestion } from "./hooks"
export type { PendingQuestionState } from "./hooks"

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
        const metaQuestion =
          typeof request.meta === "object" && request.meta && "question" in request.meta
            ? normalizeQuestion((request.meta as { question?: unknown }).question)
            : undefined
        return {
          component: ASK_USER_PANEL_ID,
          id: ASK_USER_PANEL_ID,
          title: ASK_USER_PANEL_TITLE,
          params: { questionId: request.target, question: metaQuestion },
        }
      },
    },
    {
      id: `${ASK_USER_PLUGIN_ID}.human-input-surface`,
      kind: "human-input",
      source: "builtin",
      resolve(request) {
        const metaQuestion =
          typeof request.meta === "object" && request.meta && "question" in request.meta
            ? normalizeQuestion((request.meta as { question?: unknown }).question)
            : undefined
        return {
          component: ASK_USER_PANEL_ID,
          id: ASK_USER_PANEL_ID,
          title: ASK_USER_PANEL_TITLE,
          params: { questionId: request.target, question: metaQuestion },
        }
      },
    },
  ],
})

export default askUserPlugin
