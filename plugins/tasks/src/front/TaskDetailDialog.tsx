import { useEffect, useState, type RefObject } from "react"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@hachej/boring-ui-kit"
import { RefreshCw, X } from "lucide-react"
import type { BoringTaskAdapter, BoringTaskCard, BoringTaskDetail, BoringTaskRelationDirection } from "../shared"

export interface TaskDetailSelection {
  adapter: BoringTaskAdapter
  task: BoringTaskCard
}

interface TaskDetailDialogProps {
  open: boolean
  selection: TaskDetailSelection | null
  returnFocusRef: RefObject<HTMLButtonElement | null>
  onOpenChange(open: boolean): void
}

interface DetailFailure {
  message: string
  retryable: boolean
}

interface DetailRequestState {
  selection: TaskDetailSelection | null
  detail: BoringTaskDetail | null
  failure: DetailFailure | null
  loading: boolean
}

const TASK_DETAIL_DIALOG_STYLES = `
[data-boring-task-detail] {
  inset: 0;
  top: 0;
  left: 0;
  width: 100%;
  max-width: none;
  height: 100dvh;
  transform: none;
  border-width: 0;
  border-radius: 0;
  box-shadow: none;
}
[data-boring-task-detail-body] {
  display: block;
  min-height: 0;
  flex: 1 1 0%;
  overflow-y: auto;
  overscroll-behavior: contain;
}
[data-boring-task-detail-main],
[data-boring-task-detail-aside] {
  overflow: visible;
}
[data-boring-task-detail-aside] {
  border-top: 1px solid var(--border);
}
@media (min-width: 640px) {
  [data-boring-task-detail] {
    inset: auto;
    top: 50%;
    left: 50%;
    width: min(52rem, calc(100vw - 2rem));
    height: min(82dvh, 48rem);
    transform: translate(-50%, -50%);
    border-width: 1px;
    border-radius: var(--boring-radius-xl, 0.875rem);
    box-shadow: 0 24px 64px color-mix(in oklch, var(--foreground) 16%, transparent);
  }
}
@media (min-width: 768px) {
  [data-boring-task-detail-body] {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 16rem;
    overflow: hidden;
  }
  [data-boring-task-detail-main],
  [data-boring-task-detail-aside] {
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  [data-boring-task-detail-aside] {
    border-top: 0;
    border-left: 1px solid var(--border);
  }
}
@media (prefers-reduced-motion: reduce) {
  [data-boring-task-detail] { animation: none !important; }
}
`

const RELATION_LABELS: Record<BoringTaskRelationDirection, string> = {
  parent: "Parent",
  child: "Child",
  "blocked-by": "Blocked by",
  blocks: "Blocks",
  related: "Related",
}

function detailFailure(cause: unknown): DetailFailure {
  if (cause && typeof cause === "object") {
    const typed = cause as { message?: unknown; retryable?: unknown }
    return {
      message: typeof typed.message === "string" && typed.message.trim()
        ? typed.message
        : "Task details could not be loaded.",
      retryable: typed.retryable !== false,
    }
  }
  return { message: "Task details could not be loaded.", retryable: true }
}

function DetailSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-8 px-5 py-6 sm:px-8" role="status" aria-live="polite">
      <span className="sr-only">Loading task details</span>
      <div className="flex max-w-2xl flex-col gap-3" aria-hidden="true">
        <span className="h-3 w-28 rounded-full bg-muted" />
        <span className="h-3 w-full rounded-full bg-muted/80" />
        <span className="h-3 w-5/6 rounded-full bg-muted/80" />
        <span className="h-3 w-2/3 rounded-full bg-muted/80" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3" aria-hidden="true">
        <span className="h-16 rounded-xl border border-border/70 bg-muted/20" />
        <span className="h-16 rounded-xl border border-border/70 bg-muted/20" />
        <span className="h-16 rounded-xl border border-border/70 bg-muted/20" />
      </div>
    </div>
  )
}

function PlainTextSection({ title, children }: { title: string; children?: string }) {
  if (!children) return null
  return (
    <section className="flex flex-col gap-3 border-t border-border/70 pt-6 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h3>
      <p className="max-w-[72ch] whitespace-pre-wrap break-words text-sm leading-6 text-foreground [overflow-wrap:anywhere]">{children}</p>
    </section>
  )
}

function DetailContent({ detail }: { detail: BoringTaskDetail }) {
  const { task } = detail
  const hasNarrative = Boolean(detail.body || detail.acceptanceCriteria || detail.notes)
  return (
    <div data-boring-task-detail-body>
      <div data-boring-task-detail-main className="boring-scrollbar-discreet flex min-h-0 flex-col gap-8 overflow-y-auto overscroll-contain px-5 py-6 sm:px-8 sm:py-8">
        {hasNarrative ? (
          <>
            <PlainTextSection title="Description">{detail.body}</PlainTextSection>
            <PlainTextSection title="Acceptance criteria">{detail.acceptanceCriteria}</PlainTextSection>
            <PlainTextSection title="Notes">{detail.notes}</PlainTextSection>
          </>
        ) : (
          <p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">No additional description, acceptance criteria, or notes were provided.</p>
        )}
      </div>

      <aside data-boring-task-detail-aside className="boring-scrollbar-discreet min-h-0 overflow-y-auto bg-muted/15 px-5 py-6" aria-label="Task facts and relations">
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Task facts</h3>
            <dl className="grid grid-cols-[minmax(5rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-3 text-xs leading-5">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="break-words text-right font-medium text-foreground">{task.statusId}</dd>
              {task.priority ? <><dt className="text-muted-foreground">Priority</dt><dd className="break-words text-right font-medium text-foreground">{task.priority}</dd></> : null}
              {task.issueType ? <><dt className="text-muted-foreground">Type</dt><dd className="break-words text-right font-medium text-foreground">{task.issueType}</dd></> : null}
              {task.assignee ? <><dt className="text-muted-foreground">Assignee</dt><dd className="break-words text-right font-medium text-foreground">{task.assignee}</dd></> : null}
              {detail.updatedAt ? <><dt className="text-muted-foreground">Updated</dt><dd className="break-words text-right font-medium text-foreground">{detail.updatedAt}</dd></> : null}
            </dl>
          </section>

          {detail.metadata.length > 0 ? (
            <section className="flex flex-col gap-3 border-t border-border/70 pt-6">
              <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Metadata</h3>
              <dl className="flex flex-col gap-4">
                {detail.metadata.map((item) => (
                  <div key={item.id} className="flex flex-col gap-1">
                    <dt className="text-[11px] font-medium text-muted-foreground">{item.label}</dt>
                    <dd className="whitespace-pre-wrap break-words text-xs leading-5 text-foreground [overflow-wrap:anywhere]">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {detail.relations.length > 0 ? (
            <section className="flex flex-col gap-3 border-t border-border/70 pt-6">
              <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Relations</h3>
              <ol className="flex flex-col gap-4">
                {detail.relations.map((relation, index) => (
                  <li key={`${relation.direction}:${relation.id}:${index}`} className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-muted-foreground">{RELATION_LABELS[relation.direction]}</span>
                    <span className="break-words text-xs font-medium leading-5 text-foreground [overflow-wrap:anywhere]">{relation.title ?? relation.id}</span>
                    {relation.title ? <span className="break-words text-[11px] leading-4 text-muted-foreground [overflow-wrap:anywhere]">{relation.id}</span> : null}
                    {relation.status || relation.nativeType ? (
                      <span className="text-[11px] leading-4 text-muted-foreground">{[relation.status, relation.nativeType].filter(Boolean).join(" · ")}</span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  )
}

export function TaskDetailDialog({ open, selection, returnFocusRef, onOpenChange }: TaskDetailDialogProps) {
  const [requestState, setRequestState] = useState<DetailRequestState>({
    selection: null,
    detail: null,
    failure: null,
    loading: false,
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      onOpenChange(false)
    }
    window.addEventListener("keydown", closeOnEscape, { capture: true })
    return () => window.removeEventListener("keydown", closeOnEscape, { capture: true })
  }, [onOpenChange, open])

  useEffect(() => {
    if (!open || !selection?.adapter.getTask) return
    let cancelled = false
    const requestedSelection = selection
    setRequestState({ selection: requestedSelection, detail: null, failure: null, loading: true })
    void Promise.resolve()
      .then(() => requestedSelection.adapter.getTask?.({ taskId: requestedSelection.task.id }))
      .then((nextDetail) => {
        if (!nextDetail) throw new Error("Task details are unavailable.")
        if (!cancelled) setRequestState({ selection: requestedSelection, detail: nextDetail, failure: null, loading: false })
      })
      .catch((cause) => {
        if (!cancelled) setRequestState({ selection: requestedSelection, detail: null, failure: detailFailure(cause), loading: false })
      })
    return () => { cancelled = true }
  }, [attempt, open, selection])

  const task = selection?.task
  const sourceLabel = selection?.adapter.label
  const visibleRequest = requestState.selection === selection
    ? requestState
    : { selection, detail: null, failure: null, loading: Boolean(open && selection) }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <style>{TASK_DETAIL_DIALOG_STYLES}</style>
      {selection && task ? (
        <DialogContent
          showCloseButton={false}
          data-boring-task-detail
          className="inset-0 top-0 left-0 flex h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-background p-0 shadow-none"
          overlayClassName="bg-background/80"
          onKeyDownCapture={(event) => {
            if (event.key !== "Escape") return
            event.stopPropagation()
            onOpenChange(false)
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            queueMicrotask(() => returnFocusRef.current?.focus())
          }}
          aria-busy={visibleRequest.loading}
        >
          <header className="flex shrink-0 items-start gap-4 border-b border-border/70 px-5 py-4 sm:px-8 sm:py-5">
            <div className="min-w-0 flex-1">
              <DialogDescription className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                <span>{sourceLabel}</span>
                <span aria-hidden="true">/</span>
                <span className="break-all normal-case tracking-normal">{task.number}</span>
              </DialogDescription>
              <DialogTitle className="max-w-[42ch] text-left text-lg font-semibold leading-6 tracking-tight text-foreground sm:text-xl sm:leading-7">
                {task.title}
              </DialogTitle>
              <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Task summary">
                <span className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-foreground">{task.statusId}</span>
                {task.priority ? <span className="rounded-full border border-border bg-muted/20 px-2.5 py-1 text-[11px] text-muted-foreground">{task.priority}</span> : null}
                {task.issueType ? <span className="rounded-full border border-border bg-muted/20 px-2.5 py-1 text-[11px] text-muted-foreground">{task.issueType}</span> : null}
                {(task.tags ?? []).slice(0, 4).map((tag) => <span key={tag} className="rounded-full border border-border bg-muted/20 px-2.5 py-1 text-[11px] text-muted-foreground">{tag}</span>)}
              </div>
            </div>
            <DialogClose asChild>
              <button type="button" className="grid size-10 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" aria-label="Close task details" title="Close">
                <X className="size-4" strokeWidth={1.75} />
              </button>
            </DialogClose>
          </header>

          {visibleRequest.loading ? <DetailSkeleton /> : visibleRequest.failure ? (
            <div className="grid flex-1 place-items-center px-5 py-10" role="alert">
              <div className="flex max-w-sm flex-col items-start gap-4">
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-base font-semibold text-foreground">Details unavailable</h3>
                  <p className="text-sm leading-6 text-muted-foreground">{visibleRequest.failure.message}</p>
                </div>
                {visibleRequest.failure.retryable ? (
                  <button type="button" className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" onClick={() => {
                    if (selection) setRequestState({ selection, detail: null, failure: null, loading: true })
                    setAttempt((current) => current + 1)
                  }}>
                    <RefreshCw className="size-3.5" strokeWidth={1.75} />
                    Retry
                  </button>
                ) : null}
              </div>
            </div>
          ) : visibleRequest.detail ? <DetailContent detail={visibleRequest.detail} /> : null}
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
