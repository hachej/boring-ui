"use client"

import { Button, EmptyState, Notice, Pane, PaneBody, PaneHeader, PaneTitle } from "@hachej/boring-ui-kit"
import { Artifact, ArtifactAction, ArtifactActions, ArtifactDescription, ArtifactHeader, ArtifactTitle, useOpenArtifact } from "@hachej/boring-agent/front/artifacts"
import {
  WORKSPACE_COMPOSER_STOP_EVENT,
  postUiCommand,
  useWorkspaceAttention,
  useWorkspaceContext,
  useWorkspaceContextOptional,
  workspaceComposerStopAppliesToSession,
  type HumanArtifact,
  type PaneProps,
  type PluginProviderProps,
} from "@hachej/boring-workspace"
import { definePlugin, type BoringFrontAppLeftOverlayProps, type BoringFrontFactoryWithId } from "@hachej/boring-workspace/plugin"
import { CheckCircle2, ExternalLink, FileText, HelpCircle, Inbox, SquareArrowOutUpRight, XCircle } from "lucide-react"
import { useEffect, useMemo, useSyncExternalStore, useState } from "react"
import { ASK_USER_PANEL_ID, ASK_USER_PANEL_TITLE, ASK_USER_PLUGIN_ID, ASK_USER_SURFACE_KIND } from "../shared/constants"
import { AskUserToolInputSchema } from "../shared/schema"
import type { AskUserAnswerValue, AskUserQuestion } from "../shared/types"
import { createQuestionsClient, QuestionsClientError } from "./client"
import { createQuestionsStore, pendingQuestionSnapshot, QuestionsRuntimeContext, isSessionOpen, useQuestionsRuntime, type QuestionsRuntime } from "./runtime"
import { useAskUserAttentionActions, useAskUserAttentionBlockers, useAskUserComposerStopCancel, useAskUserPendingRefresh } from "./providerHooks"
import { QuestionCancelButton, QuestionFields, QuestionForm, QuestionFormProvider, QuestionSubmitButton } from "./primitives"
import { InboxOverlay } from "./inbox/InboxOverlay"
import { isInboxAttentionBlocker } from "./inbox/attentionBlockerAdapter"

function AskUserProvider({ agentTypeId, apiBaseUrl, authHeaders, authScopeKey, activeSessionId, openSessionIds, children }: PluginProviderProps) {
  const workspaceId = useWorkspaceContextOptional()?.workspaceId
  const authIdentity = useMemo(
    () => authScopeKey ?? JSON.stringify(Object.entries(authHeaders ?? {}).sort(([left], [right]) => left.localeCompare(right))),
    [authHeaders, authScopeKey],
  )
  const store = useMemo(() => createQuestionsStore(), [agentTypeId, apiBaseUrl, authIdentity, workspaceId])
  const runtime = useMemo<QuestionsRuntime>(() => ({
    ...store,
    agentTypeId,
    apiBaseUrl,
    authHeaders,
    activeSessionId,
    openSessionIds,
    async refreshPending(sessionId) {
      return await createQuestionsClient({ apiBaseUrl, headers: authHeaders }).pending(sessionId)
    },
  }), [activeSessionId, agentTypeId, apiBaseUrl, authHeaders, openSessionIds, store])
  const pendingSnapshot = useSyncExternalStore(runtime.subscribe, () => pendingQuestionSnapshot(runtime), () => "none")
  useAskUserAttentionBlockers(runtime, pendingSnapshot)
  useAskUserAttentionActions(runtime)
  useAskUserComposerStopCancel(runtime)
  useAskUserPendingRefresh(runtime, { activeSessionId, apiBaseUrl, authHeaders, workspaceId })
  return <QuestionsRuntimeContext.Provider value={runtime}>{children}</QuestionsRuntimeContext.Provider>
}

type QuestionsPaneParams = { questionId?: string; sessionId?: string; __closeWorkbenchOnDone?: () => void }
type QuestionTarget = { sessionId: string; questionId: string }
function hasExplicitTarget(params: QuestionsPaneParams | undefined): params is QuestionTarget {
  return typeof params?.sessionId === "string" && typeof params.questionId === "string"
}
function isPaneSessionVisible(runtime: QuestionsRuntime, sessionId: string): boolean {
  return !runtime.openSessionIds || isSessionOpen(runtime, sessionId)
}
function hasReadyQuestion(runtime: QuestionsRuntime, sessionId: string): boolean {
  const pending = runtime.getPending(sessionId)
  if (pending?.status === "ready") return true
  return runtime.getPendingHints().some((hint) => hint.sessionId === sessionId && (!hint.status || hint.status === "ready"))
}
function paneQuestionSessionId(runtime: QuestionsRuntime, params: QuestionsPaneParams | undefined): string | null {
  if (hasExplicitTarget(params)) return params.sessionId
  const activeSessionId = runtime.activeSessionId ?? null
  if (activeSessionId && isPaneSessionVisible(runtime, activeSessionId) && hasReadyQuestion(runtime, activeSessionId)) return activeSessionId
  const hintedSessionId = runtime.getPendingHints().find((hint) => !hint.status || hint.status === "ready")?.sessionId
  if (hintedSessionId) return hintedSessionId
  return activeSessionId && isPaneSessionVisible(runtime, activeSessionId) ? activeSessionId : null
}

async function resolveQuestionAction(
  runtime: QuestionsRuntime,
  question: AskUserQuestion,
  action: "submit" | "cancel",
  values?: Record<string, AskUserAnswerValue>,
): Promise<boolean> {
  if (!runtime.beginQuestionAction(question)) return false
  try {
    const client = createQuestionsClient({ apiBaseUrl: runtime.apiBaseUrl, headers: runtime.authHeaders })
    if (action === "submit") await client.submit(question, values ?? {})
    else await client.cancel(question)
    runtime.setPending(null, question.sessionId)
    return true
  } finally {
    runtime.finishQuestionAction(question)
  }
}

function PendingQuestionBody({ question, onResolved, onOpen, compact = false }: { question: AskUserQuestion; onResolved?: () => void; onOpen?: () => void; compact?: boolean }) {
  const runtime = useQuestionsRuntime()
  const [error, setError] = useState<string | null>(null)
  useSyncExternalStore(runtime.subscribe, () => pendingQuestionSnapshot(runtime), () => "none")
  const submitting = runtime.isQuestionActionInFlight(question)
  if (question.status !== "ready" || !question.schema) return <Notice><span className="flex items-center gap-2"><XCircle className="h-4 w-4 text-muted-foreground" />Question {question.status}</span></Notice>
  const run = async (action: "submit" | "cancel", values?: Record<string, AskUserAnswerValue>) => {
    setError(null)
    try {
      if (await resolveQuestionAction(runtime, question, action, values)) onResolved?.()
    } catch (err) {
      setError(err instanceof QuestionsClientError ? err.message : String(err))
    }
  }
  return <QuestionFormProvider key={question.questionId} schema={question.schema} submitting={submitting} onSubmit={(values) => run("submit", values)} onCancel={() => run("cancel")}>
    <QuestionForm className={compact ? "space-y-4" : "flex min-h-0 flex-1 flex-col"}>
      <div className={compact ? "space-y-4" : "flex-1 overflow-auto p-4"}>
        <section className="relative rounded-md border border-border/60 bg-muted/30 p-4 pr-12">
          {onOpen ? <Button type="button" variant="ghost" size="icon-sm" className="absolute right-3 top-3" style={{ width: 44, height: 44 }} onClick={onOpen} aria-label="Open Questions" title="Open Questions"><SquareArrowOutUpRight className="h-4 w-4" /></Button> : null}
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Waiting for answer</div>
          <h2 className="mt-2 text-balance text-sm font-semibold leading-5 text-foreground">{question.title ?? "Question"}</h2>
          {question.context ? <p className="mt-2 max-w-prose text-sm leading-6 text-muted-foreground">{question.context}</p> : null}
        </section>
        <div className="mt-4 space-y-4"><QuestionFields /></div>
        {error ? <Notice className="mt-4" tone="destructive" role="alert">{error}</Notice> : null}
      </div>
      <div className={compact ? "flex justify-between gap-3 border-t pt-3" : "flex justify-between border-t bg-background px-4 py-3"}>
        <p className="min-w-0 text-xs text-muted-foreground">Sends answers and continues the agent.</p>
        <div className="flex gap-2"><Button asChild variant="outline" size="sm" className="h-11 sm:h-8"><QuestionCancelButton>Cancel</QuestionCancelButton></Button><Button asChild size="sm" className="h-11 sm:h-8"><QuestionSubmitButton>{question.schema.submitLabel ?? "Send answers"}</QuestionSubmitButton></Button></div>
      </div>
    </QuestionForm>
  </QuestionFormProvider>
}

function QuestionsPane({ api, params, className }: PaneProps<QuestionsPaneParams>) {
  const runtime = useQuestionsRuntime()
  useSyncExternalStore(runtime.subscribe, () => pendingQuestionSnapshot(runtime), () => "none")
  const sessionId = paneQuestionSessionId(runtime, params)
  const pending = runtime.getPending(sessionId)
  const question = hasExplicitTarget(params)
    ? (pending?.questionId === params.questionId ? pending : null)
    : pending
  useEffect(() => {
    if (!sessionId) return
    if (!pending || (hasExplicitTarget(params) && pending.questionId !== params.questionId)) {
      void runtime.refreshPending(sessionId)
        .then((question) => runtime.setPending(question, sessionId))
        .catch(() => undefined)
    }
  }, [params, pending, runtime, sessionId])
  useEffect(() => {
    const onStop = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail
      if (!question || !workspaceComposerStopAppliesToSession(detail, question.sessionId)) return
      // The provider owns cancellation and only removes the durable row after
      // the server confirms success. This pane may close independently.
      api.close()
    }
    window.addEventListener(WORKSPACE_COMPOSER_STOP_EVENT, onStop)
    return () => window.removeEventListener(WORKSPACE_COMPOSER_STOP_EVENT, onStop)
  }, [api, question, runtime])
  return <div className={className ? `${className} min-h-0 overflow-hidden` : "h-full min-h-0 overflow-hidden"}>
    <Pane className="h-full min-h-0 overflow-hidden border-0 bg-background text-sm">
      <PaneHeader className="border-b bg-background/95"><PaneTitle className="flex items-center gap-2"><HelpCircle className="h-4 w-4 text-muted-foreground" /> Agent needs input</PaneTitle></PaneHeader>
      {!question ? <PaneBody className="overflow-auto p-4"><EmptyState icon={<HelpCircle className="h-5 w-5" />} title="No pending questions" description="When the agent needs a decision, the form will appear here." className="border border-dashed bg-muted/20" /></PaneBody> : <PendingQuestionBody question={question} onResolved={() => { api.close(); params?.__closeWorkbenchOnDone?.() }} />}
    </Pane>
  </div>
}

function inlineArtifactsFromInput(input: unknown): HumanArtifact[] {
  const result = AskUserToolInputSchema.safeParse(input)
  return result.success ? result.data.artifacts ?? [] : []
}

function InlineArtifactList({ artifacts }: { artifacts: HumanArtifact[] }) {
  const openArtifact = useOpenArtifact()
  if (artifacts.length === 0) return null
  return <ul className="mt-3 space-y-2" aria-label="Artifacts">
    {artifacts.map((artifact) => {
      const opensWorkspacePath = artifact.surfaceKind === "workspace.open.path"
      const open = () => {
        if (opensWorkspacePath) openArtifact?.(artifact.target)
        else postUiCommand({ kind: "openSurface", params: { kind: artifact.surfaceKind, target: artifact.target } })
      }
      const canOpen = !opensWorkspacePath || openArtifact !== null
      return <li key={artifact.id}><Artifact className="shadow-none">
        <ArtifactHeader className="gap-3 border-b-0 px-3 py-2">
          <div className="min-w-0 flex-1">
            <ArtifactTitle className="truncate">{artifact.title}</ArtifactTitle>
            {artifact.description ? <ArtifactDescription className="mt-0.5 line-clamp-2 text-xs">{artifact.description}</ArtifactDescription> : null}
          </div>
          <ArtifactActions>
            <ArtifactAction
              icon={opensWorkspacePath ? FileText : ExternalLink}
              label={`Open ${artifact.title}`}
              tooltip={canOpen ? `Open ${artifact.title}` : "Workspace file opening is unavailable"}
              disabled={!canOpen}
              onClick={open}
            />
          </ArtifactActions>
        </ArtifactHeader>
      </Artifact></li>
    })}
  </ul>
}

function InlineQuestion({ part }: { part: unknown }) {
  const runtime = useQuestionsRuntime()
  useSyncExternalStore(runtime.subscribe, () => pendingQuestionSnapshot(runtime), () => "none")
  const toolPart = typeof part === "object" && part ? part as { toolCallId?: unknown; state?: unknown; input?: unknown } : null
  const toolCallId = typeof toolPart?.toolCallId === "string" ? toolPart.toolCallId : null
  const question = toolCallId ? runtime.getPendingByToolCallId(toolCallId) : null
  const artifacts = inlineArtifactsFromInput(toolPart?.input)
  if (question) return <section data-boring-ask-user-inline-question="true" data-testid="ask-user-inline-question" className="my-3 rounded-lg border border-border/70 bg-card p-4 text-sm shadow-sm">
    <PendingQuestionBody question={question} compact onOpen={() => postUiCommand({ kind: "openSurface", params: { kind: ASK_USER_SURFACE_KIND, target: question.questionId, meta: { sessionId: question.sessionId } } })} />
    <InlineArtifactList artifacts={artifacts} />
  </section>
  if (toolPart?.state !== "output-available" && toolPart?.state !== "output-error" && toolPart?.state !== "aborted") return null
  const input = typeof toolPart.input === "object" && toolPart.input ? toolPart.input as { title?: unknown } : null
  const title = typeof input?.title === "string" ? input.title : "Agent question"
  const cancelled = toolPart.state !== "output-available"
  return <section data-boring-ask-user-resolved-question="true" className="my-3 rounded-lg border border-border/60 bg-muted/25 px-4 py-3 text-sm">
    <div className="flex items-center gap-3">
      {cancelled ? <XCircle className="h-4 w-4 text-muted-foreground" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
      <div className="min-w-0"><div className="truncate font-medium text-foreground">{title}</div><div className="text-xs text-muted-foreground">{cancelled ? "Question cancelled" : "Answer submitted"}</div></div>
    </div>
    <InlineArtifactList artifacts={artifacts} />
  </section>
}

function InboxCountBadge() {
  const { blockers } = useWorkspaceAttention()
  const count = blockers.filter(isInboxAttentionBlocker).length
  if (count === 0) return null
  return <span data-boring-workspace-part="app-left-inbox-count" aria-label={`${count} inbox item${count === 1 ? "" : "s"}`} className="inline-flex min-w-5 items-center justify-center rounded-full bg-[color:var(--accent)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white shadow-sm">{count > 99 ? "99+" : String(count)}</span>
}
function AskUserInboxOverlay({ onClose, params }: BoringFrontAppLeftOverlayProps) {
  const { workspaceId } = useWorkspaceContext()
  return <InboxOverlay
    onClose={onClose}
    initialItemId={params?.itemId}
    pinStorageKey={`boring-workspace:inbox-pins:${workspaceId ?? "workspace"}`}
  />
}

export interface CreateAskUserPluginOptions { appLeftInbox?: boolean }
export function createAskUserPlugin(options: CreateAskUserPluginOptions = {}): BoringFrontFactoryWithId {
  return definePlugin({
    id: ASK_USER_PLUGIN_ID,
    label: ASK_USER_PANEL_TITLE,
    providers: [{ id: `${ASK_USER_PLUGIN_ID}.provider`, component: AskUserProvider }],
    panels: [{ id: ASK_USER_PANEL_ID, label: ASK_USER_PANEL_TITLE, icon: HelpCircle, component: QuestionsPane, placement: "center", source: "builtin", chromeless: true }],
    toolRenderers: [Object.assign({ id: "ask_user", render: (part: unknown) => <InlineQuestion part={part} /> }, { presentation: "inline" as const })],
    appLeftActions: options.appLeftInbox ? [{ id: "inbox", label: "Inbox", icon: Inbox, trailing: InboxCountBadge, overlay: AskUserInboxOverlay, order: 10 }] : [],
    surfaceResolvers: [{
      id: `${ASK_USER_PLUGIN_ID}.surface`, kind: ASK_USER_SURFACE_KIND, source: "builtin",
      resolve(request) {
        const sessionId = typeof request.meta === "object" && request.meta && typeof (request.meta as { sessionId?: unknown }).sessionId === "string" ? (request.meta as { sessionId: string }).sessionId : undefined
        return { component: ASK_USER_PANEL_ID, id: ASK_USER_PANEL_ID, title: ASK_USER_PANEL_TITLE, params: { questionId: request.target, sessionId } }
      },
    }],
  })
}
export const askUserPlugin: BoringFrontFactoryWithId = createAskUserPlugin()
export { inboxDemoPlugin, createInboxDemoBlockers, INBOX_DEMO_SESSION_ID } from "./inbox/examples/inboxDemoPlugin"
export default askUserPlugin
