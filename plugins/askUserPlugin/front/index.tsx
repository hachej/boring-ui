"use client"

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@hachej/boring-ui-kit"
import {
  defineFrontPlugin,
  definePanel,
  UI_COMMAND_EVENT,
  useWorkspaceAttention,
  type PaneProps,
  type PluginOutput,
  type PluginProviderProps,
  type SurfaceResolverConfig,
  type WorkspaceFrontPlugin,
} from "@hachej/boring-workspace"
import { CheckCircle2, HelpCircle, Sparkles, XCircle } from "lucide-react"
import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, useState } from "react"
import { ASK_USER_PANEL_ID, ASK_USER_PANEL_TITLE, ASK_USER_PLUGIN_ID, ASK_USER_SURFACE_KIND } from "../shared/constants"
import type { AskUserQuestion } from "../shared/types"
import { createQuestionsClient, readPendingQuestionFromState, QuestionsClientError } from "./client"
import { QuestionCancelButton, QuestionFields, QuestionForm, QuestionFormProvider, QuestionSubmitButton } from "./primitives"

type QuestionsStore = {
  getPending(): AskUserQuestion | null
  setPending(question: AskUserQuestion | null): void
  subscribe(listener: () => void): () => void
}

type QuestionsRuntime = QuestionsStore & {
  apiBaseUrl: string
  authHeaders?: Record<string, string>
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
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
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

function AskUserProvider({ apiBaseUrl, authHeaders, children }: PluginProviderProps) {
  const attention = useWorkspaceAttention()
  const storeRef = useRef<QuestionsStore | null>(null)
  if (!storeRef.current) storeRef.current = createQuestionsStore()
  const runtime = useMemo<QuestionsRuntime>(() => ({ ...storeRef.current!, apiBaseUrl, authHeaders }), [apiBaseUrl, authHeaders])
  const pendingSnapshot = useSyncExternalStore(runtime.subscribe, () => pendingQuestionSnapshot(runtime), () => "none")
  useEffect(() => {
    const pending = runtime.getPending()
    const blockerId = pending ? `${ASK_USER_PLUGIN_ID}:${pending.sessionId}:${pending.questionId}` : null
    if (pending?.status === "ready" && blockerId) {
      attention.addBlocker({
        id: blockerId,
        reason: "waiting_for_user_input",
        surfaceKind: ASK_USER_SURFACE_KIND,
        target: pending.questionId,
        label: "Answer the question in Questions to continue",
        sessionId: sessionScopedBlockerId(pending.sessionId),
        actions: [{ id: "open", label: "Open Questions" }],
      })
    }
    return () => { if (blockerId) attention.removeBlocker(blockerId) }
  }, [attention, runtime, pendingSnapshot])

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
        const response = await fetch(`${apiBaseUrl}/api/v1/ui/state`, { headers: authHeaders })
        const state = await response.json().catch(() => null) as Record<string, unknown> | null
        if (!stopped) runtime.setPending(readPendingQuestionFromState(state))
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
  }, [apiBaseUrl, authHeaders, runtime])
  return <QuestionsRuntimeContext.Provider value={runtime}>{children}</QuestionsRuntimeContext.Provider>
}

type QuestionsPaneParams = { questionId?: string; question?: AskUserQuestion; __closeWorkbenchOnDone?: () => void }

function QuestionsPane({ api, params, className }: PaneProps<QuestionsPaneParams>) {
  const runtime = useQuestionsRuntime()
  const pending = useSyncExternalStore(runtime.subscribe, runtime.getPending, runtime.getPending)
  const [question, setQuestion] = useState(params?.question ?? pending)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => {
    setQuestion(pending ?? params?.question ?? null)
  }, [pending, params?.question])
  const client = useMemo(() => createQuestionsClient({ apiBaseUrl: runtime.apiBaseUrl, headers: runtime.authHeaders }), [runtime.apiBaseUrl, runtime.authHeaders])
  useEffect(() => {
    const onStop = (event: Event) => {
      const sessionId = (event as CustomEvent<{ sessionId?: string }>).detail?.sessionId
      if (!question || (sessionId && sessionScopedBlockerId(question.sessionId) && sessionId !== question.sessionId)) return
      setQuestion(null)
      runtime.setPending(null)
      api.close()
    }
    window.addEventListener("boring:workspace-composer-stop", onStop)
    return () => window.removeEventListener("boring:workspace-composer-stop", onStop)
  }, [api, question, runtime])
  useEffect(() => {
    if (question && pending === null && !params?.question) {
      setQuestion(null)
      api.close()
    }
  }, [api, pending, params?.question, question])

  return <div className={className ?? "h-full"}>
    <div className="h-full overflow-auto bg-muted/20 p-5 text-sm">
      {!question ? <Card className="border-dashed bg-background shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4 text-muted-foreground" /> No pending questions</CardTitle><CardDescription>When the agent needs a decision, the form will appear here.</CardDescription></CardHeader></Card> : null}
      {question?.status === "ready" && question.schema ? (
        <QuestionFormProvider schema={question.schema} submitting={submitting} onSubmit={async (values) => {
          setSubmitting(true); setError(null)
          try { await client.submit(question, values); setQuestion(null); runtime.setPending(null); api.close(); params?.__closeWorkbenchOnDone?.() }
          catch (err) { setError(err instanceof QuestionsClientError ? err.message : String(err)) }
          finally { setSubmitting(false) }
        }} onCancel={async () => {
          setSubmitting(true); setError(null)
          try { await client.cancel(question); setQuestion(null); runtime.setPending(null); api.close(); params?.__closeWorkbenchOnDone?.() }
          catch (err) { setError(err instanceof QuestionsClientError ? err.message : String(err)) }
          finally { setSubmitting(false) }
        }}>
          <Card className="overflow-hidden bg-background shadow-sm">
            <CardHeader className="gap-3 pb-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <Badge variant="secondary" className="w-fit gap-1 px-2.5 py-1 font-medium"><Sparkles className="h-3 w-3" /> Needs your input</Badge>
                  <CardTitle className="text-balance text-xl leading-tight tracking-tight">{question.title ?? "Question"}</CardTitle>
                </div>
                <div className="rounded-full border bg-primary/10 p-2 text-primary"><HelpCircle className="h-5 w-5" /></div>
              </div>
              {question.context ? <CardDescription className="max-w-prose text-sm leading-6">{question.context}</CardDescription> : null}
            </CardHeader>
            <CardContent>
              <QuestionForm>
                <div className="space-y-4 rounded-xl border bg-muted/20 p-4"><QuestionFields /></div>
                {error ? <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive" role="alert">{error}</p> : null}
                <div className="mt-5 flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Submit closes this temporary question pane.</p><div className="flex gap-2"><Button asChild variant="outline"><QuestionCancelButton>Cancel</QuestionCancelButton></Button><Button asChild><QuestionSubmitButton>{question.schema.submitLabel ?? "Submit"}</QuestionSubmitButton></Button></div></div>
              </QuestionForm>
            </CardContent>
          </Card>
        </QuestionFormProvider>
      ) : null}
      {question && question.status !== "ready" ? <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><XCircle className="h-4 w-4 text-muted-foreground" />Question {question.status}</CardTitle></CardHeader></Card> : null}
    </div>
  </div>
}

export function createAskUserOutputs(): PluginOutput[] {
  const panel = definePanel({ id: ASK_USER_PANEL_ID, title: ASK_USER_PANEL_TITLE, icon: HelpCircle, component: QuestionsPane, placement: "center", source: "builtin", chromeless: true })
  const resolver: SurfaceResolverConfig = { id: `${ASK_USER_PLUGIN_ID}.surface`, source: "builtin", resolve(request) { if (request.kind !== ASK_USER_SURFACE_KIND) return undefined; const metaQuestion = typeof request.meta === "object" && request.meta && "question" in request.meta ? (request.meta as { question?: AskUserQuestion }).question : undefined; return { component: ASK_USER_PANEL_ID, id: ASK_USER_PANEL_ID, title: ASK_USER_PANEL_TITLE, params: { questionId: request.target, question: metaQuestion } } } }
  return [
    { type: "provider", id: `${ASK_USER_PLUGIN_ID}.provider`, component: AskUserProvider },
    { type: "panel", panel },
    { type: "surface-resolver", resolver },
    { type: "command", command: { id: `${ASK_USER_PLUGIN_ID}.open`, title: "Open Questions", run: () => window.dispatchEvent(new CustomEvent("boring:ask-user-open")) } },
  ]
}

export const askUserPlugin: WorkspaceFrontPlugin = defineFrontPlugin({ id: ASK_USER_PLUGIN_ID, label: ASK_USER_PANEL_TITLE, outputs: createAskUserOutputs() })
