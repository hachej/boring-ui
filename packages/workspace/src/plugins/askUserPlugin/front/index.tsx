"use client"

import { CheckCircle2, HelpCircle, Loader2, Sparkles, XCircle } from "lucide-react"
import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, useState } from "react"
import { useWorkspaceAttention } from "../../../front/provider"
import { definePanel } from "../../../front/registry/types"
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../front/components/ui"
import { defineFrontPlugin, type WorkspaceFrontPlugin } from "../../../shared/plugins/defineFrontPlugin"
import type { PluginOutput, PluginProviderProps } from "../../../shared/plugins/types"
import type { PaneProps } from "../../../shared/types/panel"
import type { SurfaceResolverConfig } from "../../../shared/types/surface"
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
      attention.addBlocker({ id: blockerId, reason: "waiting_for_user_input", surfaceKind: ASK_USER_SURFACE_KIND, label: "Answer the question in Questions to continue", sessionId: pending.sessionId })
    }
    return () => { if (blockerId) attention.removeBlocker(blockerId) }
  }, [attention, runtime, pendingSnapshot])

  useEffect(() => {
    let stopped = false
    async function poll() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/v1/ui/state`, { headers: authHeaders })
        const state = await response.json().catch(() => null) as Record<string, unknown> | null
        if (!stopped) runtime.setPending(readPendingQuestionFromState(state))
      } catch { /* best effort */ }
    }
    void poll()
    const id = setInterval(poll, 500)
    return () => { stopped = true; clearInterval(id) }
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
    if (question?.status === "ready") void client.opened(question).catch(() => undefined)
  }, [client, question?.questionId, question?.status])

  return <div className={className ?? "h-full"}>
    <div className="h-full overflow-auto bg-[radial-gradient(circle_at_top_left,color-mix(in_oklch,var(--primary)_12%,transparent),transparent_34%),linear-gradient(180deg,color-mix(in_oklch,var(--muted)_62%,transparent),transparent_52%)] p-5 text-sm">
      {!question ? <Card className="border-dashed bg-background/85 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4 text-muted-foreground" /> No pending questions</CardTitle><CardDescription>When the agent needs a decision, the form will appear here.</CardDescription></CardHeader></Card> : null}
      {question?.status === "draft" ? <Card className="bg-background/90 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Loader2 className="h-4 w-4 animate-spin text-primary" /> Preparing question…</CardTitle><CardDescription>The agent is building the form.</CardDescription></CardHeader></Card> : null}
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
          <Card className="overflow-hidden border-primary/15 bg-background/95 shadow-[0_18px_60px_-36px_color-mix(in_oklch,var(--primary)_55%,transparent)]">
            <div className="h-1 bg-[linear-gradient(90deg,color-mix(in_oklch,var(--primary)_80%,transparent),color-mix(in_oklch,var(--accent)_80%,transparent))]" />
            <CardHeader className="gap-3 pb-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <Badge variant="secondary" className="w-fit gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium"><Sparkles className="h-3 w-3" /> Needs your input</Badge>
                  <CardTitle className="text-balance text-xl leading-tight tracking-tight">{question.title ?? "Question"}</CardTitle>
                </div>
                <div className="rounded-full border bg-primary/10 p-2 text-primary"><HelpCircle className="h-5 w-5" /></div>
              </div>
              {question.context ? <CardDescription className="max-w-[62ch] text-[13px] leading-6">{question.context}</CardDescription> : null}
            </CardHeader>
            <CardContent>
              <QuestionForm>
                <div className="space-y-4 rounded-xl border bg-muted/20 p-4 [&_[data-field]]:space-y-2 [&_fieldset]:space-y-2 [&_input:not([type=radio]):not([type=checkbox])]:h-9 [&_input:not([type=radio]):not([type=checkbox])]:w-full [&_input:not([type=radio]):not([type=checkbox])]:rounded-md [&_input:not([type=radio]):not([type=checkbox])]:border [&_input:not([type=radio]):not([type=checkbox])]:bg-background [&_input:not([type=radio]):not([type=checkbox])]:px-3 [&_label]:flex [&_label]:items-center [&_label]:gap-2 [&_legend]:mb-2 [&_legend]:font-medium [&_p[role=alert]]:text-destructive [&_select]:h-9 [&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:bg-background [&_select]:px-3 [&_small]:text-muted-foreground [&_textarea]:min-h-24 [&_textarea]:w-full [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:bg-background [&_textarea]:p-3"><QuestionFields /></div>
                {error ? <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive" role="alert">{error}</p> : null}
                <div className="mt-5 flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Submit closes this temporary question pane.</p><div className="flex gap-2"><Button asChild variant="outline"><QuestionCancelButton>Cancel</QuestionCancelButton></Button><Button asChild><QuestionSubmitButton>{question.schema.submitLabel ?? "Submit"}</QuestionSubmitButton></Button></div></div>
              </QuestionForm>
            </CardContent>
          </Card>
        </QuestionFormProvider>
      ) : null}
      {question && !["draft", "ready"].includes(question.status) ? <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><XCircle className="h-4 w-4 text-muted-foreground" />Question {question.status}</CardTitle></CardHeader></Card> : null}
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
