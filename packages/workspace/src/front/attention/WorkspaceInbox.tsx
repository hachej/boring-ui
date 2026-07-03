"use client"

import { useMemo } from "react"
import { Archive, Clock3, Inbox, MailOpen, MoreHorizontal, Search, Star } from "lucide-react"
import { definePlugin } from "../../shared/plugins/frontFactory"
import { cn } from "../lib/utils"
import type { PaneProps } from "../registry/types"
import {
  emitWorkspaceAttentionAction,
  useWorkspaceAttention,
  workspaceAttentionSessionBadgeForBlocker,
  type WorkspaceAttentionBlocker,
  type WorkspaceAttentionSessionBadge,
} from "./WorkspaceAttentionProvider"

export const WORKSPACE_INBOX_PLUGIN_ID = "workspace-inbox"
export const WORKSPACE_INBOX_LEFT_TAB_ID = "workspace.inbox"
export const WORKSPACE_INBOX_DETAIL_PANEL_ID = "workspace.inbox.detail"

function badgeToneClassName(tone: WorkspaceAttentionSessionBadge["tone"]): string {
  switch (tone) {
    case "danger": return "bg-destructive/12 text-destructive"
    case "warning": return "bg-amber-500/12 text-amber-700 dark:text-amber-300"
    case "neutral": return "bg-foreground/[0.07] text-muted-foreground"
    default: return "bg-[color:var(--accent)]/12 text-[color:var(--accent)]"
  }
}

function blockerTitle(blocker: WorkspaceAttentionBlocker): string {
  return blocker.label || blocker.reason || "Workspace item"
}

function blockerSubtitle(blocker: WorkspaceAttentionBlocker): string {
  const parts = [blocker.sessionId ? `Session ${blocker.sessionId}` : null, blocker.target ?? null]
  return parts.filter(Boolean).join(" · ")
}

function blockerSender(blocker: WorkspaceAttentionBlocker): string {
  const badge = workspaceAttentionSessionBadgeForBlocker(blocker)
  return badge?.label ?? blocker.reason.split(".")[0] ?? "workspace"
}

function openInboxDetail(containerApi: PaneProps["containerApi"] | undefined, blocker: WorkspaceAttentionBlocker): void {
  containerApi?.addPanel({
    id: `${WORKSPACE_INBOX_DETAIL_PANEL_ID}.${blocker.id}`,
    component: WORKSPACE_INBOX_DETAIL_PANEL_ID,
    title: blockerTitle(blocker),
    params: { blockerId: blocker.id },
  })
}

function InboxActions({ blocker, primary = false }: { blocker: WorkspaceAttentionBlocker; primary?: boolean }) {
  if (!blocker.actions?.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {blocker.actions.map((action, index) => (
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
              sessionId: blocker.sessionId,
            })
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}

export function WorkspaceInboxPane({ containerApi }: Partial<PaneProps> = {}) {
  const { blockers } = useWorkspaceAttention()
  const sortedBlockers = useMemo(
    () => [...blockers].sort((a, b) => {
      const aBadge = workspaceAttentionSessionBadgeForBlocker(a)
      const bBadge = workspaceAttentionSessionBadgeForBlocker(b)
      return (bBadge?.priority ?? 0) - (aBadge?.priority ?? 0) || blockerTitle(a).localeCompare(blockerTitle(b))
    }),
    [blockers],
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f6f8fc] text-[#202124] dark:bg-background dark:text-foreground" data-boring-workspace-part="attention-inbox">
      <div className="border-b border-[#dfe3eb] bg-[#f6f8fc] px-3 py-2 dark:border-border/60 dark:bg-muted/35">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#d3e3fd] text-[#0b57d0] dark:bg-[color:var(--accent)]/12 dark:text-[color:var(--accent)]">
              <Inbox className="h-4 w-4" strokeWidth={1.9} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-[14px] font-semibold tracking-tight">Inbox</h2>
              <p className="truncate text-[11px] text-[#5f6368] dark:text-muted-foreground">Owner decisions and review hooks</p>
            </div>
          </div>
          <span className="rounded-full bg-[#e8eaed] px-2 py-0.5 text-[11px] font-medium text-[#5f6368] dark:bg-foreground/[0.07] dark:text-muted-foreground">
            {sortedBlockers.length}
          </span>
        </div>
        <div className="flex h-8 items-center gap-2 rounded-full bg-[#eaf1fb] px-3 text-[#5f6368] dark:bg-background/70 dark:text-muted-foreground">
          <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span className="text-[12px]">Search inbox</span>
        </div>
      </div>

      {sortedBlockers.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[#5f6368] shadow-sm dark:bg-background/70 dark:text-muted-foreground">
            <MailOpen className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div className="text-sm font-medium">Inbox zero</div>
          <p className="mt-1 max-w-[220px] text-xs leading-5 text-[#5f6368] dark:text-muted-foreground">
            When plugins or external harnesses ask for a decision, it will appear here.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {sortedBlockers.map((blocker) => {
            const badge = workspaceAttentionSessionBadgeForBlocker(blocker)
            const subtitle = blockerSubtitle(blocker)
            return (
              <button
                key={blocker.id}
                type="button"
                className="group grid w-full grid-cols-[20px_minmax(78px,0.55fr)_minmax(0,1fr)_auto] items-center gap-2 border-b border-[#e8eaed] bg-white px-3 py-2 text-left text-[12px] shadow-[inset_0_-1px_0_rgba(100,121,143,0.02)] transition-colors hover:relative hover:z-[1] hover:bg-[#f2f6fc] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b57d0]/30 dark:border-border/60 dark:bg-background/75 dark:hover:bg-muted/50"
                onClick={() => openInboxDetail(containerApi, blocker)}
              >
                <span className="flex items-center gap-1 text-[#5f6368] dark:text-muted-foreground">
                  <span className="h-2 w-2 rounded-full bg-[#0b57d0] dark:bg-[color:var(--accent)]" />
                </span>
                <span className="min-w-0 truncate font-semibold">{blockerSender(blocker)}</span>
                <span className="min-w-0 truncate">
                  <span className="font-medium">{blockerTitle(blocker)}</span>
                  <span className="text-[#5f6368] dark:text-muted-foreground"> — {subtitle || blocker.reason}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {badge ? (
                    <span
                      className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", badgeToneClassName(badge.tone))}
                      data-boring-attention-kind={badge.kind}
                    >
                      {badge.label}
                    </span>
                  ) : null}
                  <span className="text-[11px] font-medium text-[#5f6368] dark:text-muted-foreground">now</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function WorkspaceInboxDetailPanel({ params }: PaneProps<{ blockerId?: string }>) {
  const { blockers } = useWorkspaceAttention()
  const blocker = blockers.find((item) => item.id === params?.blockerId)

  if (!blocker) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-background px-6 text-center">
        <MailOpen className="mb-3 h-8 w-8 text-muted-foreground" strokeWidth={1.75} />
        <div className="text-sm font-medium text-foreground">Inbox item no longer exists</div>
        <p className="mt-1 text-xs text-muted-foreground">It may have been answered or dismissed.</p>
      </div>
    )
  }

  const badge = workspaceAttentionSessionBadgeForBlocker(blocker)
  const subtitle = blockerSubtitle(blocker)

  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-[#202124] dark:bg-background dark:text-foreground" data-boring-workspace-part="attention-inbox-detail">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-[#e8eaed] px-4 text-[#5f6368] dark:border-border/60 dark:text-muted-foreground">
        <Archive className="h-4 w-4" strokeWidth={1.75} />
        <Clock3 className="ml-2 h-4 w-4" strokeWidth={1.75} />
        <Star className="ml-2 h-4 w-4" strokeWidth={1.75} />
        <MoreHorizontal className="ml-2 h-4 w-4" strokeWidth={1.75} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {badge ? (
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", badgeToneClassName(badge.tone))}>
              {badge.label}
            </span>
          ) : null}
          <span className="text-xs text-[#5f6368] dark:text-muted-foreground">{blocker.reason}</span>
        </div>
        <h1 className="text-[22px] font-normal leading-tight tracking-tight">{blockerTitle(blocker)}</h1>
        <div className="mt-5 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#d3e3fd] text-sm font-semibold text-[#0b57d0] dark:bg-[color:var(--accent)]/12 dark:text-[color:var(--accent)]">
            {blockerSender(blocker).slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="font-semibold">{blockerSender(blocker)}</div>
              <div className="text-xs text-[#5f6368] dark:text-muted-foreground">now</div>
            </div>
            {subtitle ? <div className="mt-0.5 text-xs text-[#5f6368] dark:text-muted-foreground">{subtitle}</div> : null}
            <div className="mt-6 rounded-2xl border border-[#e8eaed] bg-[#f8fafd] p-4 text-sm leading-6 dark:border-border/60 dark:bg-muted/30">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#5f6368] dark:text-muted-foreground">Details</div>
              <dl className="grid gap-2 text-xs sm:grid-cols-[96px_1fr]">
                <dt className="text-[#5f6368] dark:text-muted-foreground">Blocker id</dt><dd className="break-all font-mono">{blocker.id}</dd>
                <dt className="text-[#5f6368] dark:text-muted-foreground">Reason</dt><dd>{blocker.reason}</dd>
                {blocker.sessionId ? <><dt className="text-[#5f6368] dark:text-muted-foreground">Session</dt><dd className="break-all">{blocker.sessionId}</dd></> : null}
                {blocker.target ? <><dt className="text-[#5f6368] dark:text-muted-foreground">Target</dt><dd className="break-all">{blocker.target}</dd></> : null}
                {blocker.surfaceKind ? <><dt className="text-[#5f6368] dark:text-muted-foreground">Surface</dt><dd>{blocker.surfaceKind}</dd></> : null}
              </dl>
            </div>
            <div className="mt-5">
              <InboxActions blocker={blocker} primary />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export const workspaceInboxPlugin = definePlugin({
  id: WORKSPACE_INBOX_PLUGIN_ID,
  label: "Workspace Inbox",
  setup(api) {
    api.registerLeftTab({
      id: WORKSPACE_INBOX_LEFT_TAB_ID,
      title: "Inbox",
      panelId: WORKSPACE_INBOX_LEFT_TAB_ID,
      component: WorkspaceInboxPane,
      source: "builtin",
      icon: Inbox,
    })
    api.registerPanel({
      id: WORKSPACE_INBOX_DETAIL_PANEL_ID,
      label: "Inbox Detail",
      component: WorkspaceInboxDetailPanel,
      placement: "center",
      source: "builtin",
      icon: MailOpen,
    })
  },
})
