"use client"

import { useCallback, useMemo, useState, useSyncExternalStore } from "react"
import { ArrowLeft, ExternalLink, MailOpen, MessageSquare } from "lucide-react"
import { HumanArtifactList, emitWorkspaceAttentionAction, useWorkspaceAttention, useWorkspaceShellCapabilities, cn, type HumanArtifact, type WorkspaceAttentionBlocker } from "@hachej/boring-workspace"
import { attentionBlockerToInboxItem } from "./attentionBlockerAdapter"
import { formatInboxTime, inboxItemDate, inboxItemSender, type WorkspaceInboxItem } from "./inboxItemModel"
import { useWorkspaceInboxShell } from "./WorkspaceInboxShellContext"
import { useQuestionsRuntime } from "../runtime"
import { createQuestionsClient } from "../client"
import { QuestionFormProvider, QuestionForm, QuestionFields } from "../primitives"
import type { RelatedTaskRef } from "./taskProvenanceClient"

function InboxActions({ item, blocker, primary = false, onShellError }: { item: WorkspaceInboxItem; blocker?: WorkspaceAttentionBlocker; primary?: boolean; onShellError?: (message: string) => void }) {
  const shell = useWorkspaceShellCapabilities()
  if (!item.actions.length || !blocker) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {item.actions.map((action, index) => (
        <button
          key={action.id}
          type="button"
          className={cn(
            "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            primary && index === 0
              ? "border-transparent bg-primary text-primary-foreground hover:bg-primary/90"
              : "border-border/80 bg-background hover:bg-muted/60",
          )}
          onClick={(event) => {
            event.stopPropagation()
            emitWorkspaceAttentionAction({
              blockerId: blocker.id,
              actionId: action.id,
              blocker,
              sessionId: item.sessionId ?? undefined,
            })
            if (action.id === "open" && blocker.surfaceKind) {
              const result = shell.openArtifact({
                type: "surface",
                surfaceKind: blocker.surfaceKind,
                target: blocker.target,
              }, { sessionId: blocker.sessionId, title: item.title, instanceId: item.id })
              if (!result.success) onShellError?.(result.message)
            }
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}

export function InboxDetailPanel({
  params,
  relatedTasks = [],
  onBack,
}: {
  params?: { itemId?: string; blockerId?: string }
  relatedTasks?: readonly RelatedTaskRef[]
  onBack?: () => void
}) {
  const { blockers } = useWorkspaceAttention()
  const shell = useWorkspaceInboxShell()
  const id = params?.itemId ?? params?.blockerId
  const blocker = useMemo(() => blockers.find((entry) => entry.id === id), [blockers, id])
  const item = useMemo(() => blocker ? attentionBlockerToInboxItem(blocker) : null, [blocker])
  const runtime = useQuestionsRuntime()
  const paneSessionId = item?.sessionId
  const pending = useSyncExternalStore(runtime.subscribe, () => runtime.getPending(paneSessionId), () => runtime.getPending(paneSessionId))
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const openArtifact = useCallback((artifact: HumanArtifact) => {
    if (!item) return
    const result = shell.openInboxArtifact(item, artifact)
    if (!result.success) setError(result.message)
  }, [item, shell])
  const client = useMemo(() => createQuestionsClient({ apiBaseUrl: runtime.apiBaseUrl, headers: runtime.authHeaders }), [runtime.apiBaseUrl, runtime.authHeaders])

  if (!item) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-background px-6 text-center">
        <MailOpen className="mb-3 size-8 text-muted-foreground" strokeWidth={1.75} />
        <div className="text-sm font-medium text-foreground">Inbox item no longer exists</div>
        <p className="mt-1 text-xs text-muted-foreground">It may have been answered or dismissed.</p>
      </div>
    )
  }

  const subtitle = [item.sessionId ? `Session ${item.sessionId}` : null, item.targetLabel || null].filter(Boolean).join(" · ")

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground" data-boring-workspace-part="inbox-detail-panel">
      <div className="boring-scrollbar-discreet min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {onBack ? (
          <button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden="true" /> Back to Inbox
          </button>
        ) : null}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[color:var(--accent)]/12 px-2 py-0.5 text-[11px] font-medium text-[color:var(--accent)]">{item.kind}</span>
          <span className="text-xs text-muted-foreground">{item.description}</span>
        </div>
        <h1 className="text-[22px] font-normal leading-tight tracking-tight">{item.title}</h1>
        <div className="mt-5 flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[color:oklch(from_var(--accent)_l_c_h/0.14)] text-sm font-semibold text-[color:var(--accent)]">
            {inboxItemSender(item).slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="font-semibold">{inboxItemSender(item)}</div>
              <div className="text-xs text-muted-foreground" title={inboxItemDate(item).toLocaleString()}>{formatInboxTime(item)}</div>
            </div>
            {subtitle ? <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div> : null}
            {error ? <div className="mt-4 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">{error}</div> : null}
            {blocker && blocker.reason === "ask-user.question" && pending?.status === "ready" && pending.schema ? (
              <div className="mt-6 rounded-2xl border border-border/60 bg-muted/20 p-5">
                <div className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Submit Intention / Answer</div>
                <QuestionFormProvider
                  key={pending.questionId}
                  schema={pending.schema}
                  submitting={submitting}
                  onSubmit={async (values) => {
                    setSubmitting(true)
                    setError(null)
                    try {
                      await client.submit(pending, values)
                      runtime.setPending(null, pending.sessionId)
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err))
                    } finally {
                      setSubmitting(false)
                    }
                  }}
                  onCancel={async () => {
                    setSubmitting(true)
                    setError(null)
                    try {
                      await client.cancel(pending)
                      runtime.setPending(null, pending.sessionId)
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err))
                    } finally {
                      setSubmitting(false)
                    }
                  }}
                >
                  <QuestionForm className="space-y-4">
                    <div className="space-y-4">
                      <QuestionFields />
                    </div>
                    <div className="flex gap-2 pt-2">
                      <button
                        type="submit"
                        disabled={submitting}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition"
                      >
                        {submitting ? "Sending..." : pending.schema.submitLabel ?? "Send answers"}
                      </button>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={async () => {
                          if (window.confirm("Discard your answer?")) {
                            setSubmitting(true)
                            setError(null)
                            try {
                              await client.cancel(pending)
                              runtime.setPending(null, pending.sessionId)
                            } catch (err) {
                              setError(err instanceof Error ? err.message : String(err))
                            } finally {
                              setSubmitting(false)
                            }
                          }
                        }}
                        className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60 disabled:opacity-50 transition"
                      >
                        Cancel
                      </button>
                    </div>
                  </QuestionForm>
                </QuestionFormProvider>
              </div>
            ) : (
              <div className="mt-6 rounded-2xl border border-border/60 bg-muted/30 p-4 text-sm leading-6">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Details</div>
                <dl className="grid gap-2 text-xs sm:grid-cols-[96px_1fr]">
                  <dt className="text-muted-foreground">Item id</dt><dd className="break-all font-mono">{item.id}</dd>
                  <dt className="text-muted-foreground">Source</dt><dd>{item.source.label}</dd>
                  {item.sessionId ? <><dt className="text-muted-foreground">Session</dt><dd className="break-all">{item.sessionId}</dd></> : null}
                  {item.targetLabel ? <><dt className="text-muted-foreground">Target</dt><dd className="break-all">{item.targetLabel}</dd></> : null}
                </dl>
              </div>
            )}
            {relatedTasks.length > 0 ? (
              <div className="mt-5">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Related tasks</div>
                <div className="flex flex-wrap gap-2">
                  {relatedTasks.map((task) => task.url ? (
                    <a
                      key={`${task.adapterId}:${task.taskId}`}
                      href={task.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted"
                      aria-label={`Open task ${task.number} ${task.title}`}
                    >
                      <span>{task.number}</span><span className="max-w-48 truncate text-muted-foreground">{task.title}</span><ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  ) : (
                    <span key={`${task.adapterId}:${task.taskId}`} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium">
                      <span>{task.number}</span><span className="max-w-48 truncate text-muted-foreground">{task.title}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            <HumanArtifactList artifacts={item.artifacts} onOpen={openArtifact} className="mt-5" />
            <div className="mt-5 flex flex-wrap gap-2">
              {item.sessionId && item.chatAvailable ? (
                <button
                  type="button"
                  onClick={() => {
                    const result = shell.openDetachedChat(item.sessionId!, { title: item.title })
                    if (!result.success) setError(result.message)
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  <MessageSquare className="size-3.5" aria-hidden="true" /> Open chat
                </button>
              ) : null}
              <InboxActions item={item} blocker={blocker} primary onShellError={setError} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
