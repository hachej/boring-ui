"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ExternalLink, Inbox, MailOpen, X } from "lucide-react"
import { IconButton } from "@hachej/boring-ui-kit"
import { HumanArtifactList, useWorkspaceAttention, useAppLeftOverlayChrome, cn, type HumanArtifact } from "@hachej/boring-workspace"
import { attentionBlockerToInboxItem, isInboxAttentionBlocker } from "./attentionBlockerAdapter"
import { InboxFilterBar } from "./InboxFilterBar"
import { InboxSection } from "./InboxSection"
import {
  filterInboxItems,
  mergeInboxPinnedState,
  sortInboxItems,
  type InboxFilter,
  type WorkspaceInboxItemViewModel,
} from "./inboxItemModel"
import { useWorkspaceInboxShell } from "./WorkspaceInboxShellContext"
import { useRelatedTasks } from "./taskProvenanceClient"
import { useQuestionsRuntime } from "../runtime"

export interface InboxOverlayProps {
  onClose: () => void
  pinStorageKey?: string
  initialItemId?: string
}

function readPinnedIds(storageKey?: string): ReadonlySet<string> {
  if (!storageKey) return new Set()
  try {
    const raw = globalThis.localStorage?.getItem(storageKey)
    const parsed = raw ? JSON.parse(raw) as { ids?: unknown } : null
    return new Set(Array.isArray(parsed?.ids) ? parsed.ids.filter((id): id is string => typeof id === "string" && id.length > 0) : [])
  } catch {
    return new Set()
  }
}

function writePinnedIds(storageKey: string | undefined, ids: ReadonlySet<string>): void {
  if (!storageKey) return
  try {
    const values = Array.from(ids)
    if (values.length === 0) globalThis.localStorage?.removeItem(storageKey)
    else globalThis.localStorage?.setItem(storageKey, JSON.stringify({ ids: values }))
  } catch {
    // Best-effort local pin state, matching session pin persistence.
  }
}

export function InboxOverlay({ onClose, pinStorageKey, initialItemId }: InboxOverlayProps) {
  const { headerInsetStart, headerInsetEnd } = useAppLeftOverlayChrome()
  const { blockers } = useWorkspaceAttention()
  const shell = useWorkspaceInboxShell()
  const runtime = useQuestionsRuntime()
  const [filter, setFilter] = useState<InboxFilter>("all")
  const [shellError, setShellError] = useState<string | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(initialItemId ?? null)
  const [pinnedIds, setPinnedIds] = useState<ReadonlySet<string>>(() => readPinnedIds(pinStorageKey))
  useEffect(() => {
    setPinnedIds(readPinnedIds(pinStorageKey))
  }, [pinStorageKey])
  useEffect(() => {
    if (initialItemId) setSelectedItemId(initialItemId)
  }, [initialItemId])
  const sorted = useMemo(() => sortInboxItems(blockers.filter(isInboxAttentionBlocker).map(attentionBlockerToInboxItem)), [blockers])
  const filtered = useMemo(() => filterInboxItems(sorted, filter), [filter, sorted])
  const items = useMemo(() => mergeInboxPinnedState(filtered, pinnedIds), [filtered, pinnedIds])
  const pinnedItems = useMemo(() => items.filter((item) => item.pinned), [items])
  const unpinnedItems = useMemo(() => items.filter((item) => !item.pinned), [items])
  const relatedTasks = useRelatedTasks({
    apiBaseUrl: runtime.apiBaseUrl,
    headers: runtime.authHeaders,
    sessionIds: sorted.flatMap((item) => item.sessionId ? [item.sessionId] : []),
  })
  const counts = useMemo(() => ({
    all: sorted.length,
    questions: filterInboxItems(sorted, "questions").length,
    reviews: filterInboxItems(sorted, "reviews").length,
  }), [sorted])

  const togglePinned = useCallback((id: string) => {
    setPinnedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      writePinnedIds(pinStorageKey, next)
      return next
    })
  }, [pinStorageKey])
  const handleShellResult = useCallback((result: ReturnType<typeof shell.openInboxArtifact>) => {
    setShellError(result.success ? null : result.message)
  }, [])
  const openItem = useCallback((item: WorkspaceInboxItemViewModel) => {
    setShellError(null)
    setSelectedItemId((current) => current === item.id ? null : item.id)
  }, [])
  const openChat = useCallback((item: WorkspaceInboxItemViewModel) => {
    if (!item.sessionId) return
    handleShellResult(shell.openDetachedChat(item.sessionId, { title: item.title }))
  }, [handleShellResult, shell])
  const renderExpandedItem = useCallback((item: WorkspaceInboxItemViewModel) => {
    const blocker = blockers.find((entry) => entry.id === item.id)
    const questionArtifact: HumanArtifact | null = blocker?.surfaceKind && blocker.target
      ? {
          id: `${item.id}:question`,
          surfaceKind: blocker.surfaceKind,
          target: blocker.target,
          title: item.title,
          description: "Answer requested",
        }
      : null
    const artifacts = [...(questionArtifact ? [questionArtifact] : []), ...item.artifacts]
    const tasks = item.sessionId ? relatedTasks.get(item.sessionId) ?? [] : []
    return (
      <div className="px-4 py-3">
        <HumanArtifactList artifacts={artifacts} onOpen={(artifact) => handleShellResult(shell.openInboxArtifact(item, artifact))} />
        {tasks.length > 0 ? (
          <div className="mt-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Related tasks</div>
            <div className="flex flex-wrap gap-1.5">
              {tasks.map((task) => task.url ? (
                <a key={`${task.adapterId}:${task.taskId}`} href={task.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 rounded-full border border-border px-2 py-1 text-[11px] font-medium hover:bg-muted">
                  <span>{task.number}</span><span className="max-w-48 truncate text-muted-foreground">{task.title}</span><ExternalLink className="size-3" aria-hidden="true" />
                </a>
              ) : (
                <span key={`${task.adapterId}:${task.taskId}`} className="inline-flex max-w-full items-center gap-1 rounded-full border border-border px-2 py-1 text-[11px] font-medium">
                  <span>{task.number}</span><span className="max-w-48 truncate text-muted-foreground">{task.title}</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    )
  }, [blockers, handleShellResult, relatedTasks, shell])
  return (
    <div data-boring-workspace-part="inbox-overlay" className="flex h-full min-h-0 flex-col bg-background">
      <header className={cn(
        "flex h-12 shrink-0 items-center justify-between border-b border-border/60",
        headerInsetStart ? "pl-12" : "pl-4",
        headerInsetEnd ? "pr-16" : "pr-4",
      )}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-[color:oklch(from_var(--accent)_l_c_h/0.14)] text-[color:var(--accent)]">
            <Inbox className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold tracking-tight text-foreground">Inbox</h2>
            <p className="truncate text-xs text-muted-foreground">Questions, reviews, and owner decisions</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton type="button" variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close inbox" title="Close" className="text-muted-foreground hover:text-foreground">
            <X className="size-3" strokeWidth={1.75} />
          </IconButton>
        </div>
      </header>

      <InboxFilterBar filter={filter} counts={counts} onFilterChange={setFilter} />
      {shellError ? <div className="border-b border-border/60 bg-destructive/10 px-4 py-2 text-xs text-destructive">{shellError}</div> : null}
      <div className="boring-scrollbar-discreet min-h-0 flex-1 overflow-y-auto bg-[color:oklch(from_var(--background)_calc(l-0.012)_c_h)] py-2" aria-live="polite">
        {items.length === 0 ? (
          <div className="flex h-full min-h-[180px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
            <div>
              <MailOpen className="mx-auto mb-3 size-8 text-muted-foreground/70" strokeWidth={1.75} />
              <div className="font-medium text-foreground/80">Inbox zero</div>
              <p className="mt-1 max-w-xs">When plugins or external harnesses ask for a decision, it appears here.</p>
            </div>
          </div>
        ) : (
          <>
            <InboxSection
              title="Pinned"
              items={pinnedItems}
              onTogglePinned={togglePinned}
              onOpenArtifact={openItem}
              onOpenChat={openChat}
              expandedItemId={selectedItemId}
              renderExpanded={renderExpandedItem}
            />
            <InboxSection
              title="Inbox"
              items={unpinnedItems}
              onTogglePinned={togglePinned}
              onOpenArtifact={openItem}
              onOpenChat={openChat}
              expandedItemId={selectedItemId}
              renderExpanded={renderExpandedItem}
            />
          </>
        )}
      </div>
    </div>
  )
}
