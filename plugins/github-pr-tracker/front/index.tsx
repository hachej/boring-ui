import React from "react"
import { definePlugin, type PaneProps } from "@hachej/boring-workspace/plugin"
import "./styles.css"
import { fetchPrData, requestAgentClassifyIssues, requestAgentLabelIssue, requestServerRefresh } from "./data"
import { PrDetail } from "./prDetail"
import type { IssueCard, PrData, PullRequest } from "./types"
import { Button, classes, EmptyState, Spinner } from "./ui"

const PLUGIN_ID = "github-pr-tracker"
const MAIN_PANEL_ID = `${PLUGIN_ID}.panel`
const LEFT_PANEL_ID = `${PLUGIN_ID}.left`

function usePrData() {
  const [data, setData] = React.useState<PrData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
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
      try { await requestServerRefresh(); if (!cancelled) await refresh() } catch {}
      finally { running = false }
    }
    const id = window.setInterval(() => { void tick() }, 60_000)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [refresh])
  return { data, loading, error, refresh }
}

const BOARD_COLUMNS: Array<{ id: IssueCard["column"]; title: string; hint: string }> = [
  { id: "to-plan", title: "To plan", hint: "Needs scoping or task breakdown" },
  { id: "bclaw-ready", title: "Boring Claw", hint: "bclaw:ready queue" },
  { id: "to-review", title: "To review", hint: "Candidate work to inspect" },
  { id: "to-merge", title: "To merge", hint: "Ready or near-ready" },
]

const COLUMN_LABELS: Record<IssueCard["column"], string> = {
  "to-plan": "status:to-plan",
  "to-review": "status:to-review",
  "to-merge": "status:to-merge",
  "bclaw-ready": "bclaw:ready",
}
const ALL_COLUMN_LABELS = Object.values(COLUMN_LABELS)

type IssueFilter = "all" | "easy" | "needs-plan" | "unclassified" | "executable"
const ISSUE_FILTERS: Array<{ id: IssueFilter; label: string; test: (issue: IssueCard) => boolean }> = [
  { id: "all", label: "All", test: () => true },
  { id: "easy", label: "Easy", test: (issue) => issue.difficulty === "easy" },
  { id: "needs-plan", label: "Needs plan", test: (issue) => issue.difficulty === "needs-plan" },
  { id: "unclassified", label: "Unclassified", test: (issue) => !issue.difficulty },
  { id: "executable", label: "bclaw:ready", test: (issue) => issue.labels.some((label) => label.toLowerCase() === "bclaw:ready") },
]

function IssuesKanban({ data, onRefresh }: { data: PrData; onRefresh: () => void }) {
  const [busy, setBusy] = React.useState<string | null>(null)
  const [filter, setFilter] = React.useState<IssueFilter>("all")
  const [localColumns, setLocalColumns] = React.useState<Record<number, IssueCard["column"]>>({})
  const [localLabelPatches, setLocalLabelPatches] = React.useState<Record<number, { add: string[]; remove: string[] }>>({})
  const allIssues = (data.issues ?? []).map((issue) => {
    const patch = localLabelPatches[issue.number]
    const remove = new Set((patch?.remove ?? []).map((label) => label.toLowerCase()))
    const labels = issue.labels.filter((label) => !remove.has(label.toLowerCase()))
    for (const label of patch?.add ?? []) if (!labels.some((existing) => existing.toLowerCase() === label.toLowerCase())) labels.push(label)
    return { ...issue, labels, column: localColumns[issue.number] ?? issue.column }
  })
  const activeFilter = ISSUE_FILTERS.find((candidate) => candidate.id === filter) ?? ISSUE_FILTERS[0]
  const issues = allIssues.filter(activeFilter.test)
  React.useEffect(() => { setLocalColumns({}); setLocalLabelPatches({}) }, [data.generatedAt])
  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key)
    try { await action(); setTimeout(onRefresh, 1800) } finally { setBusy(null) }
  }
  const labelIssue = (issue: IssueCard, add: string[], remove: string[], key: string) => {
    const columnFromAddedLabel = BOARD_COLUMNS.find((column) => add.some((label) => label.toLowerCase() === COLUMN_LABELS[column.id].toLowerCase()))?.id
    if (columnFromAddedLabel) setLocalColumns((current) => ({ ...current, [issue.number]: columnFromAddedLabel }))
    setLocalLabelPatches((current) => {
      const existing = current[issue.number] ?? { add: [], remove: [] }
      const nextRemove = [...new Set([...existing.remove, ...remove].filter((label) => !add.some((added) => added.toLowerCase() === label.toLowerCase())))]
      const nextAdd = [...new Set([...existing.add, ...add].filter((label) => !remove.some((removed) => removed.toLowerCase() === label.toLowerCase())))]
      return { ...current, [issue.number]: { add: nextAdd, remove: nextRemove } }
    })
    void run(key, () => requestAgentLabelIssue(issue.number, add, remove))
  }
  const moveIssue = (issue: IssueCard, column: IssueCard["column"]) => {
    if (issue.column === column) return
    setLocalColumns((current) => ({ ...current, [issue.number]: column }))
    labelIssue(issue, [COLUMN_LABELS[column]], ALL_COLUMN_LABELS.filter((label) => label !== COLUMN_LABELS[column]), `move-${issue.number}`)
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h2 className="text-base font-semibold text-foreground">Issues Kanban</h2>
          <p className="text-xs text-muted-foreground">{issues.length}/{allIssues.length} open issues · labels drive columns and difficulty</p>
        </div>
        <Button variant="secondary" onClick={() => void run("classify", requestAgentClassifyIssues)} disabled={!!busy}>{busy === "classify" ? <Spinner className="size-3" /> : "LLM classify: easy / needs-plan"}</Button>
      </div>
      <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-muted/20 p-2">
        {ISSUE_FILTERS.map((candidate) => {
          const count = allIssues.filter(candidate.test).length
          return <button key={candidate.id} type="button" className={classes("rounded-full border px-2.5 py-1 text-xs font-medium transition-colors", filter === candidate.id ? "border-foreground/30 bg-foreground/10 text-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground")} onClick={() => setFilter(candidate.id)}>{candidate.label} <span className="tabular-nums opacity-60">{count}</span></button>
        })}
      </div>
      <KanbanBoard>
        {BOARD_COLUMNS.map((col) => {
          const cards = issues.filter((issue) => issue.column === col.id)
          return <KanbanColumn key={col.id} id={col.id} title={col.title} count={cards.length} onDropIssue={moveIssue}>{cards.map((issue) => <IssueKanbanCard key={issue.number} issue={issue} busy={busy} labelIssue={labelIssue} />)}{cards.length === 0 && <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">Drop issues here</div>}</KanbanColumn>
        })}
      </KanbanBoard>
    </div>
  )
}

function KanbanBoard({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[70vh] w-full overflow-hidden pb-2"><div className="w-full gap-3" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>{children}</div></div>
}
function KanbanColumn({ id, title, count, children, onDropIssue }: { id: IssueCard["column"]; title: string; count: number; children: React.ReactNode; onDropIssue: (issue: IssueCard, column: IssueCard["column"]) => void }) {
  const [over, setOver] = React.useState(false)
  return <section className={classes("flex max-h-[72vh] min-h-[560px] min-w-0 flex-col rounded-xl border bg-muted/20 transition-colors", over ? "border-primary/70 bg-primary/5" : "border-border")} onDragOver={(event) => { event.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={(event) => { event.preventDefault(); setOver(false); const raw = event.dataTransfer.getData("application/x-github-issue"); if (!raw) return; try { onDropIssue(JSON.parse(raw) as IssueCard, id) } catch {} }}><header className="flex shrink-0 items-center justify-between border-b border-border bg-background/70 px-3 py-2"><h3 className="text-sm font-semibold text-foreground">{title}</h3><span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{count}</span></header><div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">{children}</div></section>
}

function IssueKanbanCard({ issue, busy, labelIssue }: { issue: IssueCard; busy: string | null; labelIssue: (issue: IssueCard, add: string[], remove: string[], key: string) => void }) {
  const key = `exec-${issue.number}`
  const labels = issue.labels.filter((label) => !/^status:/i.test(label)).slice(0, 6)
  const chatHref = issue.bclawSessionId ? `${window.location.pathname}?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(window.location.search)), session: issue.bclawSessionId }).toString()}` : undefined
  return <article draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-github-issue", JSON.stringify(issue)) }} className="cursor-grab rounded-lg border border-border bg-card p-3 shadow-sm active:cursor-grabbing"><div className="mb-2 flex items-start gap-2"><a className="min-w-0 flex-1 text-sm font-medium leading-snug text-foreground hover:underline" href={issue.url} target="_blank" rel="noreferrer" draggable={false}><span className="mr-1 tabular-nums text-muted-foreground">#{issue.number}</span>{issue.title}</a><span className={issue.difficulty === "easy" ? "shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-500" : issue.difficulty === "needs-plan" ? "shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-500" : "shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"}>{issue.difficulty ?? "unclassified"}</span></div>{labels.length > 0 && <div className="flex flex-wrap gap-1">{labels.map((label) => <span key={label} className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{label}</span>)}</div>}{(issue.associatedPrs?.length ?? 0) > 0 && <div className="mt-2 flex flex-wrap gap-1">{issue.associatedPrs?.map((pr) => <a key={pr.number} href={pr.url} target="_blank" rel="noreferrer" draggable={false} className="rounded-full border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-500" title={pr.title}>PR #{pr.number}{pr.isDraft ? " draft" : ""}</a>)}</div>}<div className="mt-2 flex flex-wrap gap-1"><Button size="xs" variant="ghost" onClick={() => labelIssue(issue, ["bclaw:ready"], ALL_COLUMN_LABELS.filter((label) => label !== "bclaw:ready"), key)} disabled={!!busy}>{busy === key ? <Spinner className="size-3" /> : "+ bclaw:ready"}</Button>{chatHref && <a className="inline-flex h-6 items-center rounded-md px-2 text-xs font-medium hover:bg-muted/60" href={chatHref} target="_blank" rel="noreferrer" draggable={false}>Open chat</a>}<Button size="xs" variant="ghost" onClick={() => labelIssue(issue, ["easy"], ["needs-plan"], `easy-${issue.number}`)} disabled={!!busy}>easy</Button><Button size="xs" variant="ghost" onClick={() => labelIssue(issue, ["needs-plan"], ["easy"], `plan-${issue.number}`)} disabled={!!busy}>needs-plan</Button></div></article>
}

function PullRequestsDashboard({ prs, onOpenPr }: { prs: PullRequest[]; onOpenPr: (pr: PullRequest) => void }) {
  return <div className="space-y-4"><div><h2 className="text-base font-semibold text-foreground">Pull requests</h2><p className="text-xs text-muted-foreground">{prs.length} open pull requests</p></div><div className="rounded-xl border border-border bg-card"><div className="grid grid-cols-[80px_1fr_120px_120px] gap-2 border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground"><span>PR</span><span>Title</span><span>Status</span><span>Updated</span></div>{prs.map((pr) => <button key={pr.number} type="button" className="grid w-full grid-cols-[80px_1fr_120px_120px] gap-2 border-b border-border/50 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/40" onClick={() => onOpenPr(pr)}><span className="tabular-nums text-muted-foreground">#{pr.number}</span><span className="min-w-0 truncate font-medium text-foreground">{pr.title}</span><span className="truncate text-xs text-muted-foreground">{pr.statusTag}</span><span className="truncate text-xs text-muted-foreground">{pr.updatedAt ? new Date(pr.updatedAt).toLocaleDateString() : "unknown"}</span></button>)}</div></div>
}

function MainPane({ params, containerApi }: PaneProps<{ number?: number; view?: "issues" | "prs" }>) {
  const { data, loading, error, refresh } = usePrData()
  const number = params?.number
  const prs = data?.prs ?? []
  const selected = typeof number === "number" ? prs.find((pr) => pr.number === number) : null
  const openPr = (pr: PullRequest) => containerApi.addPanel({ id: `${MAIN_PANEL_ID}.${pr.number}`, component: MAIN_PANEL_ID, title: `PR #${pr.number}`, params: { number: pr.number } })

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">GitHub PRs</span>
        {data?.repo && <span className="font-mono">{data.repo}</span>}
        {typeof number === "number" && <span className="tabular-nums">#{number}</span>}
        <Button variant="ghost" size="xs" className="ml-auto text-muted-foreground" onClick={() => void refresh()} disabled={loading}>
          {loading ? <Spinner className="size-3" /> : "Reload"}
        </Button>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
        <div className={typeof number === "number" ? "mx-auto max-w-5xl min-w-0" : "w-full min-w-0 max-w-none"}>
          {loading && !data && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Spinner className="size-4" /> Loading PR data…</div>
          )}
          {error && !data && !loading && (
            <EmptyState
              title="No PR data loaded"
              description="Ask the agent to run “refresh github pr tracker”. It uses your local gh CLI and writes data for this panel."
            >
              <pre className="max-w-full overflow-auto rounded bg-muted/50 p-2 text-left text-xs text-muted-foreground">{error}</pre>
            </EmptyState>
          )}
          {data && typeof number !== "number" && params?.view === "prs" && (
            <PullRequestsDashboard prs={prs} onOpenPr={openPr} />
          )}
          {data && typeof number !== "number" && params?.view !== "prs" && (
            <IssuesKanban data={data} onRefresh={() => void refresh()} />
          )}
          {data && typeof number === "number" && !selected && (
            <EmptyState
              title={`PR #${number} not found`}
              description="It is not in the latest snapshot — it may be merged or closed. Refetch to update."
            />
          )}
          {selected && (
            <PrDetail
              pr={selected}
              allLabels={[...new Set(prs.flatMap((candidate) => candidate.labels))].sort()}
              onDataChanged={() => void refresh()}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function LeftPane({ containerApi }: PaneProps) {
  const [busy, setBusy] = React.useState(false)
  const openPrDashboard = () => containerApi.addPanel({ id: `${MAIN_PANEL_ID}.prs`, component: MAIN_PANEL_ID, title: "PR Dashboard", params: { view: "prs" } })
  const openIssueDashboard = () => containerApi.addPanel({ id: `${MAIN_PANEL_ID}.issues`, component: MAIN_PANEL_ID, title: "Issues Kanban", params: { view: "issues" } })
  const refresh = async () => { setBusy(true); try { await requestServerRefresh() } finally { setBusy(false) } }
  return <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto bg-background p-3 text-foreground"><div><h2 className="text-sm font-semibold">GitHub Tracker</h2><p className="text-xs text-muted-foreground">Controls and dashboards</p></div><Button variant="secondary" onClick={openIssueDashboard}>Open issue board</Button><Button variant="outline" onClick={openPrDashboard}>Open PR dashboard</Button><Button variant="outline" onClick={() => void refresh()} disabled={busy}>{busy ? <Spinner className="size-3" /> : "Refresh now"}</Button><Button variant="ghost" onClick={() => void requestAgentClassifyIssues()}>LLM classify issues</Button></div>
}

export default definePlugin({
  id: PLUGIN_ID,
  label: "GitHub PR Tracker",
  panels: [
    { id: MAIN_PANEL_ID, label: "GitHub PR Tracker", component: MainPane },
    { id: LEFT_PANEL_ID, label: "GitHub PR Tracker", component: LeftPane },
  ],
  commands: [{ id: `${PLUGIN_ID}.open`, title: "Open GitHub PR Tracker", panelId: MAIN_PANEL_ID }],
  leftTabs: [{ id: `${PLUGIN_ID}.tab`, title: "GitHub PRs", panelId: LEFT_PANEL_ID }],
})
