import React from "react"
import { buildPortUrl, fetchPrData, relativeTime, requestAgentRefresh, requestServerRefresh, timestamp } from "./data"
import { attentionNotes, needsAttention, StatusInline, toneText } from "./status"
import type { IssueCard, PrData, PullRequest } from "./types"
import { Button, ChipButton, classes, EmptyState, Input, Spinner } from "./ui"

type QuickFilter = "all" | "attention" | "ready" | "draft" | "demo"
type SortMode = "updated" | "created" | "number" | "status"

const FILTERS: Array<{ key: QuickFilter; label: string; test: (pr: PullRequest) => boolean }> = [
  { key: "all", label: "All", test: () => true },
  { key: "attention", label: "Attention", test: needsAttention },
  { key: "ready", label: "Ready", test: (pr) => pr.statusTone === "success" && !pr.isDraft },
  { key: "draft", label: "Draft", test: (pr) => pr.isDraft },
  { key: "demo", label: "Demo", test: (pr) => pr.ports.length > 0 },
]

function matchesIssue(issue: IssueCard, query: string): boolean {
  const needle = query.trim().toLowerCase().replace(/^#/, "")
  if (!needle) return true
  return String(issue.number).includes(needle)
    || issue.title.toLowerCase().includes(needle)
    || issue.author.toLowerCase().includes(needle)
    || issue.labels.some((label) => label.toLowerCase().includes(needle))
}

function matchesQuery(pr: PullRequest, query: string): boolean {
  const needle = query.trim().toLowerCase().replace(/^#/, "")
  if (!needle) return true
  return String(pr.number).includes(needle)
    || pr.title.toLowerCase().includes(needle)
    || pr.author.toLowerCase().includes(needle)
    || pr.headRefName.toLowerCase().includes(needle)
}

function sortPrs(prs: PullRequest[], sort: SortMode): PullRequest[] {
  return prs.slice().sort((a, b) => {
    if (sort === "created") return timestamp(b.createdAt) - timestamp(a.createdAt)
    if (sort === "number") return b.number - a.number
    if (sort === "status") return a.statusTag.localeCompare(b.statusTag) || timestamp(b.updatedAt) - timestamp(a.updatedAt)
    return timestamp(b.updatedAt) - timestamp(a.updatedAt)
  })
}

function GitHubIcon() {
  return (
    <svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

function IssueRow({ issue, onOpenBoard }: { issue: IssueCard; onOpenBoard: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="group cursor-pointer border-b border-border/40 px-3 py-2 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      onClick={onOpenBoard}
      onKeyDown={(event) => { if (event.key === "Enter") onOpenBoard() }}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">#{issue.number}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={issue.title}>{issue.title}</span>
        <a
          className="hidden items-center justify-center rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground group-hover:flex group-focus-within:flex"
          href={issue.url} target="_blank" rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          title="Open issue on GitHub"
        >
          <GitHubIcon />
        </a>
      </div>
      <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
        <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5">{issue.column.replace(/-/g, " ")}</span>
        <span className={classes("shrink-0 font-medium", issue.difficulty === "easy" ? "text-emerald-500" : issue.difficulty === "needs-plan" ? "text-amber-500" : "text-muted-foreground")}>{issue.difficulty ?? "unclassified"}</span>
        <span className="min-w-0 truncate">{issue.author} · {relativeTime(issue.updatedAt)}</span>
      </div>
    </div>
  )
}

function PrRow({ pr, onOpen }: { pr: PullRequest; onOpen: (pr: PullRequest) => void }) {
  const notes = attentionNotes(pr)
  const demoPort = pr.ports[0]
  return (
    <div
      role="button"
      tabIndex={0}
      className="group cursor-pointer border-b border-border/40 px-3 py-2 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      onClick={() => onOpen(pr)}
      onKeyDown={(event) => { if (event.key === "Enter") onOpen(pr) }}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">#{pr.number}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={pr.title}>{pr.title}</span>
        <span className="hidden shrink-0 items-center gap-0.5 group-focus-within:flex group-hover:flex">
          {demoPort && (
            <a
              className="flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-emerald-500/15 hover:text-emerald-600 dark:hover:text-emerald-400"
              href={buildPortUrl(demoPort.port)}
              target="_blank" rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
              title={`Open demo :${demoPort.port}`}
            >
              <PlayIcon />
            </a>
          )}
          <a
            className="flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            href={pr.url} target="_blank" rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            title="Open on GitHub"
          >
            <GitHubIcon />
          </a>
        </span>
      </div>
      <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
        <StatusInline pr={pr} />
        {notes.map((note) => (
          <span key={note.key} className={classes("shrink-0 font-medium", toneText[note.tone])}>{note.text}</span>
        ))}
        <span className="min-w-0 truncate">
          {pr.author} · {relativeTime(pr.updatedAt)}
        </span>
      </div>
    </div>
  )
}

export interface PrListPaneProps {
  onOpenPr: (pr: PullRequest) => void
  onOpenPrDashboard?: () => void
  onOpenIssueDashboard?: () => void
}

export function PrListPane({ onOpenPr, onOpenPrDashboard, onOpenIssueDashboard }: PrListPaneProps) {
  const [data, setData] = React.useState<PrData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState("")
  const [filter, setFilter] = React.useState<QuickFilter>("all")
  const [sort, setSort] = React.useState<SortMode>("updated")
  const [refetching, setRefetching] = React.useState(false)
  const [refetchMessage, setRefetchMessage] = React.useState<string | null>(null)
  const [prsOpen, setPrsOpen] = React.useState(true)
  const [issuesOpen, setIssuesOpen] = React.useState(true)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await fetchPrData())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void refresh() }, [refresh])
  React.useEffect(() => {
    let cancelled = false
    let running = false
    const tick = async () => {
      if (running || cancelled) return
      running = true
      try {
        await requestServerRefresh()
        if (!cancelled) setData(await fetchPrData())
        if (!cancelled) setError(null)
      } catch (cause) {
        // Keep the last good snapshot visible. The footer shows stale age; manual refetch can surface details.
        if (!cancelled && !data) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        running = false
      }
    }
    const id = window.setInterval(() => { void tick() }, 60_000)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [data, refresh])

  const refetchViaAgent = async () => {
    setRefetching(true)
    setRefetchMessage("Refreshing from GitHub…")
    const before = data?.generatedAt
    try {
      await requestAgentRefresh()
      // The agent executes the refresh tool on its own schedule — poll until
      // the data file actually changes instead of trusting the chat response.
      for (let waited = 0; waited <= 120_000; waited += 4_000) {
        const next = await fetchPrData().catch(() => null)
        if (next && next.generatedAt !== before) {
          setData(next)
          setError(null)
          setRefetchMessage("Refetched")
          window.setTimeout(() => setRefetchMessage(null), 1800)
          return
        }
        setRefetchMessage(`Waiting for the agent… ${Math.round(waited / 1000)}s`)
        await new Promise((resolve) => window.setTimeout(resolve, 4_000))
      }
      setRefetchMessage("Agent didn't update the data — ask it to “refresh github pr tracker” in chat.")
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setRefetchMessage(`Refetch failed: ${message.slice(0, 120)}`)
    } finally {
      setRefetching(false)
    }
  }

  const prs = data?.prs ?? []
  const issues = data?.issues ?? []
  const searched = prs.filter((pr) => matchesQuery(pr, query))
  const visibleIssues = issues.filter((issue) => matchesIssue(issue, query)).sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt))
  const activeFilter = FILTERS.find((candidate) => candidate.key === filter) ?? FILTERS[0]
  const visible = sortPrs(searched.filter(activeFilter.test), sort)
  const hasControls = prs.length > 0 || issues.length > 0

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground">
      <div className="shrink-0 border-b border-border px-3 pb-2 pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[13px] font-semibold">GitHub work</h2>
            {data && <span className="text-xs tabular-nums text-muted-foreground">{prs.length} PR · {issues.length} issues</span>}
          </div>
          <button
            type="button"
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            onClick={() => void refresh()}
            disabled={loading}
            title="Reload data"
          >
            {loading && data ? <Spinner className="size-4" /> : <RefreshIcon />}
          </button>
        </div>
        {hasControls && (
          <>
            <div className="mt-2 flex items-center gap-1.5">
              <Input
                className="h-7 flex-1 px-2 text-xs md:text-xs"
                placeholder="Filter PRs/issues by title, #, author, label"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
              <select
                className="h-7 shrink-0 rounded-md border border-border bg-background px-1 text-[11px] text-muted-foreground"
                value={sort}
                onChange={(event) => setSort(event.currentTarget.value as SortMode)}
                aria-label="Sort pull requests"
              >
                <option value="updated">Updated</option>
                <option value="created">Created</option>
                <option value="number">Number</option>
                <option value="status">Status</option>
              </select>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {FILTERS.map((candidate) => {
                const count = candidate.key === "all" ? searched.length : searched.filter(candidate.test).length
                if (candidate.key !== "all" && count === 0 && filter !== candidate.key) return null
                return (
                  <ChipButton
                    key={candidate.key}
                    selected={filter === candidate.key}
                    onClick={() => setFilter(candidate.key)}
                    className={classes(filter !== candidate.key && "text-muted-foreground")}
                  >
                    {candidate.label}
                    <span className="tabular-nums opacity-60">{count}</span>
                  </ChipButton>
                )
              })}
            </div>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading && prs.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Spinner className="size-4" /> Loading…</div>
        )}
        {error && prs.length === 0 && !loading && (
          <div className="px-3 py-6 text-center">
            <p className="text-sm font-medium">No PR data yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Ask the agent to “refresh github pr tracker”, or use the button below.</p>
            <Button variant="outline" size="xs" className="mt-3" disabled={refetching} onClick={() => void refetchViaAgent()}>
              {refetching ? "Refetching…" : "Fetch via agent"}
            </Button>
          </div>
        )}
        {!loading && !error && hasControls && visible.length === 0 && visibleIssues.length === 0 && (
          <EmptyState
            className="m-3 min-h-28"
            title="No matching PRs or issues"
            actions={<Button variant="ghost" size="xs" onClick={() => { setQuery(""); setFilter("all") }}>Clear filters</Button>}
          />
        )}
        {!loading && !error && hasControls && (
          <>
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-1.5 backdrop-blur">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs font-semibold" onClick={() => setPrsOpen((value) => !value)}>
                <span className="text-muted-foreground">{prsOpen ? "▾" : "▸"}</span>
                <span>Pull requests</span>
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{visible.length}</span>
              </button>
              {onOpenPrDashboard && <Button variant="ghost" size="xs" className="text-[11px]" onClick={onOpenPrDashboard}>Open PR dashboard</Button>}
            </div>
            {prsOpen && (visible.length > 0 ? visible.map((pr) => <PrRow key={pr.number} pr={pr} onOpen={onOpenPr} />) : <div className="border-b border-border/40 px-3 py-4 text-center text-xs text-muted-foreground">No matching pull requests</div>)}
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-1.5 backdrop-blur">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs font-semibold" onClick={() => setIssuesOpen((value) => !value)}>
                <span className="text-muted-foreground">{issuesOpen ? "▾" : "▸"}</span>
                <span>Issues</span>
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{visibleIssues.length}</span>
              </button>
              {onOpenIssueDashboard && <Button variant="secondary" size="xs" className="text-[11px]" onClick={onOpenIssueDashboard}>Open issue board</Button>}
            </div>
            {issuesOpen && (visibleIssues.length > 0 ? visibleIssues.map((issue) => <IssueRow key={issue.number} issue={issue} onOpenBoard={onOpenIssueDashboard ?? (() => undefined)} />) : <div className="border-b border-border/40 px-3 py-4 text-center text-xs text-muted-foreground">No matching issues</div>)}
          </>
        )}
      </div>

      {data && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="truncate" title={data.generatedAt}>
            {refetchMessage ?? `Data from ${relativeTime(data.generatedAt)}`}
          </span>
          <Button variant="ghost" size="xs" className="shrink-0 text-[11px] text-muted-foreground" disabled={refetching} onClick={() => void refetchViaAgent()}>
            {refetching ? <Spinner className="size-3" /> : "Refetch"}
          </Button>
        </div>
      )}
    </div>
  )
}
