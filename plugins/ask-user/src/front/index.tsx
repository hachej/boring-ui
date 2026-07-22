"use client"

import { Button, EmptyState, Notice, Pane, PaneBody, PaneFooter, PaneHeader, PaneTitle } from "@hachej/boring-ui-kit"
import {
  WORKSPACE_COMPOSER_STOP_EVENT,
  useWorkspaceAttention,
  useWorkspaceContext,
  workspaceComposerStopAppliesToSession,
  type PaneProps,
  type PluginProviderProps,
} from "@hachej/boring-workspace"
import {
  definePlugin,
  type BoringFrontAppLeftOverlayProps,
  type BoringFrontFactoryWithId,
} from "@hachej/boring-workspace/plugin"
import { HelpCircle, Inbox, XCircle } from "lucide-react"
import { useEffect, useMemo, useRef, useSyncExternalStore, useState } from "react"
import { ASK_USER_PANEL_ID, ASK_USER_PANEL_TITLE, ASK_USER_PLUGIN_ID, ASK_USER_SURFACE_KIND } from "../shared/constants"
import { createQuestionsClient, QuestionsClientError } from "./client"
import {
  pendingQuestionSnapshot,
  QuestionsRuntimeContext,
  isSessionOpen,
  sharedQuestionsStore,
  useQuestionsRuntime,
  type QuestionsRuntime,
} from "./runtime"
import {
  useAskUserAttentionActions,
  useAskUserAttentionBlockers,
  useAskUserComposerStopCancel,
  useAskUserPendingRefresh,
} from "./providerHooks"
import { QuestionCancelButton, QuestionFields, QuestionForm, QuestionFormProvider, QuestionSubmitButton } from "./primitives"
import { InboxOverlay } from "./inbox/InboxOverlay"
import { isInboxAttentionBlocker } from "./inbox/attentionBlockerAdapter"

function AskUserProvider({ apiBaseUrl, authHeaders, activeSessionId, openSessionIds, children }: PluginProviderProps) {
  const runtime = useMemo<QuestionsRuntime>(() => ({
    ...sharedQuestionsStore,
    apiBaseUrl,
    authHeaders,
    activeSessionId,
    openSessionIds,
    async refreshPending(sessionId) {
      const pending = await createQuestionsClient({ apiBaseUrl, headers: authHeaders }).pending(sessionId)
      sharedQuestionsStore.setPending(pending, sessionId)
      return pending
    },
  }), [activeSessionId, apiBaseUrl, authHeaders, openSessionIds])
  const pendingSnapshot = useSyncExternalStore(runtime.subscribe, () => pendingQuestionSnapshot(runtime), () => "none")

  useAskUserAttentionBlockers(runtime, pendingSnapshot)
  useAskUserAttentionActions(runtime)
  useAskUserComposerStopCancel(runtime)
  useAskUserPendingRefresh(runtime, { activeSessionId, apiBaseUrl, authHeaders })

  return <QuestionsRuntimeContext.Provider value={runtime}>{children}</QuestionsRuntimeContext.Provider>
}

type QuestionsPaneParams = { questionId?: string; sessionId?: string; exactQuestion?: boolean; __closeWorkbenchOnDone?: () => void }

function paneQuestionSessionId(runtime: QuestionsRuntime, params: QuestionsPaneParams | undefined): string | null {
  if (params?.exactQuestion && params.sessionId && hasRequestedQuestion(runtime, params.sessionId, params.questionId)) return params.sessionId
  const activeSessionId = runtime.activeSessionId ?? null
  if (activeSessionId && isPaneSessionVisible(runtime, activeSessionId) && hasReadyQuestion(runtime, activeSessionId)) return activeSessionId
  if (params?.sessionId && hasReadyQuestion(runtime, params.sessionId)) return params.sessionId
  const hintedSessionId = runtime.getPendingHints().find((hint) => !hint.status || hint.status === "ready")?.sessionId
  if (hintedSessionId) return hintedSessionId
  if (params?.sessionId && isPaneSessionVisible(runtime, params.sessionId)) return params.sessionId
  return activeSessionId && isPaneSessionVisible(runtime, activeSessionId) ? activeSessionId : null
}

function isPaneSessionVisible(runtime: QuestionsRuntime, sessionId: string): boolean {
  return !runtime.openSessionIds || isSessionOpen(runtime, sessionId)
}

function isPaneSessionKnownHidden(runtime: QuestionsRuntime, sessionId: string): boolean {
  return !!runtime.openSessionIds && !isSessionOpen(runtime, sessionId)
}

function hasRequestedQuestion(runtime: QuestionsRuntime, sessionId: string, questionId?: string): boolean {
  const pending = runtime.getPending(sessionId)
  if (pending?.status === "ready" && (!questionId || pending.questionId === questionId)) return true
  return runtime.getPendingHints().some((hint) => hint.sessionId === sessionId && (!questionId || hint.questionId === questionId) && (!hint.status || hint.status === "ready"))
}

function hasReadyQuestion(runtime: QuestionsRuntime, sessionId: string): boolean {
  const pending = runtime.getPending(sessionId)
  if (pending?.status === "ready") return true
  return runtime.getPendingHints().some((hint) => hint.sessionId === sessionId && (!hint.status || hint.status === "ready"))
}

function InboxCountBadge() {
  const { blockers } = useWorkspaceAttention()
  const count = blockers.filter(isInboxAttentionBlocker).length
  if (count === 0) return null
  const label = count > 99 ? "99+" : String(count)
  return (
    <span
      data-boring-workspace-part="app-left-inbox-count"
      aria-label={`${count} inbox item${count === 1 ? "" : "s"}`}
      className="inline-flex min-w-5 items-center justify-center rounded-full bg-[color:var(--accent)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white shadow-sm"
    >
      {label}
    </span>
  )
}

function AskUserInboxOverlay({ onClose, params }: BoringFrontAppLeftOverlayProps) {
  const { workspaceId } = useWorkspaceContext()
  return <InboxOverlay
    onClose={onClose}
    initialItemId={params?.itemId}
    pinStorageKey={`boring-workspace:inbox-pins:${workspaceId ?? "workspace"}`}
  />
}

function QuestionsPane({ api, params, className }: PaneProps<QuestionsPaneParams>) {
  const runtime = useQuestionsRuntime()
  // Subscribe to the full pending snapshot, not only the currently selected
  // session payload. A fresh/demo page can mount with a new active session while
  // the server-published pending hint belongs to an older hidden session. The
  // selected pane session must be allowed to change when hints hydrate.
  useSyncExternalStore(runtime.subscribe, () => pendingQuestionSnapshot(runtime), () => "none")
  const paneSessionId = paneQuestionSessionId(runtime, params)
  const pending = useSyncExternalStore(runtime.subscribe, () => runtime.getPending(paneSessionId), () => runtime.getPending(paneSessionId))
  const [closedQuestionId, setClosedQuestionId] = useState<string | null>(null)
  const retargetRefreshRef = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const question = pending?.questionId === closedQuestionId ? null : pending
  const client = useMemo(() => createQuestionsClient({ apiBaseUrl: runtime.apiBaseUrl, headers: runtime.authHeaders }), [runtime.apiBaseUrl, runtime.authHeaders])
  useEffect(() => {
    if (!params?.sessionId || !isPaneSessionKnownHidden(runtime, params.sessionId)) return
    if (hasReadyQuestion(runtime, params.sessionId)) return
    const hints = runtime.getPendingHints()
    // On first mount the provider may not have loaded /api/v1/ui/state yet.
    // Do not close a hidden-session pane until the authoritative hints have
    // arrived; otherwise a fresh/demo route can flash-close before hydrating
    // the blocking question for its original session.
    if (hints.length === 0) return
    const activeSessionId = runtime.activeSessionId ?? null
    const canShowActiveQuestion = activeSessionId && isPaneSessionVisible(runtime, activeSessionId) && hasReadyQuestion(runtime, activeSessionId)
    if (!canShowActiveQuestion) api.close()
  }, [api, params?.sessionId, runtime])

  useEffect(() => {
    const onStop = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail
      if (!question || !workspaceComposerStopAppliesToSession(detail, question.sessionId)) return
      setClosedQuestionId(question.questionId)
      runtime.setPending(null, question.sessionId)
      api.close()
    }
    window.addEventListener(WORKSPACE_COMPOSER_STOP_EVENT, onStop)
    return () => window.removeEventListener(WORKSPACE_COMPOSER_STOP_EVENT, onStop)
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

export interface CreateAskUserPluginOptions {
  /** Register the workspace Inbox button/overlay in the app-left rail. */
  appLeftInbox?: boolean
}

/**
 * Creates a `BoringFrontFactoryWithId` for the ask-user plugin. Registers
 * (1) a provider that owns the per-app questions runtime (apiBaseUrl,
 * auth headers, in-memory pending-question store), (2) a "Questions"
 * panel rendering the pending question form, and (3) a surface
 * resolver mapping ASK_USER_SURFACE_KIND requests into the panel.
 *
 * Pass directly to `WorkspaceProvider.plugins`.
 *
 * The panel is opened via the surface resolver (kind: ASK_USER_SURFACE_KIND),
 * which is how the server-side agent tool triggers it. The app-left Inbox
 * button is opt-in via `appLeftInbox`.
 */
export function createAskUserPlugin(options: CreateAskUserPluginOptions = {}): BoringFrontFactoryWithId {
  return definePlugin({
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
  appLeftActions: options.appLeftInbox ? [
    {
      id: "inbox",
      label: "Inbox",
      icon: Inbox,
      trailing: InboxCountBadge,
      overlay: AskUserInboxOverlay,
      order: 10,
    },
  ] : [],
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
          params: { questionId: request.target, sessionId, exactQuestion: true },
        }
      },
    },
  ],
  })
}

export const askUserPlugin: BoringFrontFactoryWithId = createAskUserPlugin()

export { inboxDemoPlugin, createInboxDemoBlockers, INBOX_DEMO_SESSION_ID } from "./inbox/examples/inboxDemoPlugin"

export default askUserPlugin
