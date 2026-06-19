import { useEffect, useMemo, useState, type ChangeEvent } from "react"
import { useWorkspacePluginClient, type WorkspacePluginClient } from "@hachej/boring-workspace"
import { definePlugin, type PaneProps } from "@hachej/boring-workspace/plugin"

const DATA_PATH = ".pi/extensions/ccusage-dashboard/usage.json"
const REPORTS = ["daily", "weekly", "monthly", "session", "blocks"] as const
const SOURCES = ["all", "claude", "codex", "opencode", "amp", "droid", "codebuff", "hermes", "pi", "goose", "openclaw", "kilo", "kimi", "qwen", "copilot", "gemini"] as const

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const cf = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 })
const usd = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 })

type UsageRow = Record<string, unknown>
interface UsageData {
  summary?: Record<string, unknown>
  data?: UsageRow[]
  command?: string[]
  generatedAt?: string
  source?: string
}

type Report = typeof REPORTS[number]
type Source = typeof SOURCES[number]

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function rowLabel(row: UsageRow, index: number): string {
  return String(row.date ?? row.week ?? row.month ?? row.session ?? row.source ?? row.agent ?? `Row ${index + 1}`)
}

function rowCost(row: UsageRow): number {
  return num(row.costUSD ?? row.totalCost)
}

function rows(data: UsageData | undefined): UsageRow[] {
  return Array.isArray(data?.data) ? data.data : []
}

function total(data: UsageData | undefined, keys: string[], rowGetter: (row: UsageRow) => number): number {
  if (!data) return 0
  const summary = data.summary ?? {}
  for (const key of keys) {
    const value = summary[key]
    if (typeof value === "number") return value
  }
  return rows(data).reduce((sum, row) => sum + rowGetter(row), 0)
}

async function fetchUsage(client: WorkspacePluginClient): Promise<UsageData> {
  return client.readJsonFile<UsageData>(DATA_PATH, {
    missingMessage: "No ccusage data yet. Click Refresh, or ask the agent to run refresh_ccusage_dashboard.",
  })
}

function refreshPrompt(report: Report, source: Source, since: string, until: string, timezone: string): string {
  const bits = [`report: ${report}`, `source: ${source}`]
  if (since) bits.push(`since: ${since}`)
  if (until) bits.push(`until: ${until}`)
  if (timezone) bits.push(`timezone: ${timezone}`)
  return `Use refresh_ccusage_dashboard with ${bits.join(", ")} and update the ccusage dashboard.`
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

function Chart({ rows: chartInput }: { rows: UsageRow[] }) {
  const chartRows = chartInput.slice(-60)
  if (chartRows.length === 0) {
    return <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No usage rows found yet.</div>
  }
  const maxTokens = Math.max(1, ...chartRows.map((row) => num(row.totalTokens)))
  const maxCost = Math.max(1, ...chartRows.map(rowCost))
  const width = Math.max(680, chartRows.length * 36)
  const height = 260
  const left = 52
  const right = 24
  const top = 20
  const bottom = 44
  const innerWidth = width - left - right
  const innerHeight = height - top - bottom
  const x = (index: number) => left + (chartRows.length <= 1 ? innerWidth / 2 : (index / (chartRows.length - 1)) * innerWidth)
  const tokenY = (tokens: number) => top + innerHeight - (tokens / maxTokens) * innerHeight
  const costY = (cost: number) => top + innerHeight - (cost / maxCost) * innerHeight
  const costPoints = chartRows.map((row, index) => `${x(index)},${costY(rowCost(row))}`).join(" ")
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card p-3">
      <svg width={width} height={height} role="img" aria-label="Token consumption over time" className="block">
        <line x1={left} y1={top + innerHeight} x2={width - right} y2={top + innerHeight} stroke="currentColor" className="text-border" />
        <line x1={left} y1={top} x2={left} y2={top + innerHeight} stroke="currentColor" className="text-border" />
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = top + innerHeight - tick * innerHeight
          return (
            <g key={tick}>
              <line x1={left} y1={y} x2={width - right} y2={y} stroke="currentColor" className="text-border/60" strokeDasharray="3 5" />
              <text x={left - 10} y={y + 4} textAnchor="end" className="fill-muted-foreground text-[10px]">{cf.format(maxTokens * tick)}</text>
            </g>
          )
        })}
        {chartRows.map((row, index) => {
          const barWidth = Math.max(10, Math.min(24, innerWidth / Math.max(1, chartRows.length) - 6))
          const tokens = num(row.totalTokens)
          const y = tokenY(tokens)
          return (
            <g key={`${rowLabel(row, index)}-${index}`}>
              <rect x={x(index) - barWidth / 2} y={y} width={barWidth} height={top + innerHeight - y} rx={4} className="fill-sky-500/75" />
              <title>{`${rowLabel(row, index)} — ${nf.format(tokens)} tokens, ${usd.format(rowCost(row))}`}</title>
            </g>
          )
        })}
        <polyline points={costPoints} fill="none" stroke="rgb(245 158 11)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {chartRows.map((row, index) => <text key={`label-${index}`} x={x(index)} y={height - 16} textAnchor="middle" className="fill-muted-foreground text-[10px]">{rowLabel(row, index).slice(5)}</text>)}
      </svg>
      <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-sky-500" />Tokens</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" />Cost trend</span>
      </div>
    </div>
  )
}

function CcusageDashboard({ params }: PaneProps<{ report?: Report; source?: Source }>) {
  const pluginClient = useWorkspacePluginClient()
  const [report, setReport] = useState<Report>(params.report ?? "daily")
  const [source, setSource] = useState<Source>(params.source ?? "all")
  const [since, setSince] = useState("")
  const [until, setUntil] = useState("")
  const [timezone, setTimezone] = useState("")
  const [data, setData] = useState<UsageData>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [loadKey, setLoadKey] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(undefined)
    fetchUsage(pluginClient)
      .then((next) => { if (active) setData(next) })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : String(caught)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [pluginClient, loadKey])

  async function refresh() {
    setRefreshing(true)
    setError(undefined)
    try {
      await pluginClient.sendAgentPrompt(refreshPrompt(report, source, since, until, timezone), {
        title: "ccusage dashboard refresh",
        noncePrefix: "ccusage-dashboard",
      })
      window.setTimeout(() => setLoadKey((key) => key + 1), 1500)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setRefreshing(false)
    }
  }

  const totals = useMemo(() => ({
    tokens: total(data, ["totalTokens"], (row) => num(row.totalTokens)),
    input: total(data, ["totalInputTokens", "inputTokens"], (row) => num(row.inputTokens)),
    output: total(data, ["totalOutputTokens", "outputTokens"], (row) => num(row.outputTokens)),
    cache: total(data, ["totalCacheCreationTokens", "cacheCreationTokens"], (row) => num(row.cacheCreationTokens)) + total(data, ["totalCacheReadTokens", "cacheReadTokens"], (row) => num(row.cacheReadTokens)),
    cost: total(data, ["totalCostUSD", "totalCost", "costUSD"], rowCost),
  }), [data])

  const onReportChange = (event: ChangeEvent<HTMLSelectElement>) => setReport(event.target.value as Report)
  const onSourceChange = (event: ChangeEvent<HTMLSelectElement>) => setSource(event.target.value as Source)

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground">
      <div className="border-b border-border bg-card/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">ccusage token dashboard</h2>
            <p className="mt-1 text-sm text-muted-foreground">Workspace-local token consumption over time. Refresh runs ccusage through the agent and writes usage.json.</p>
          </div>
          <div className="flex gap-2">
            <button className="rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-accent" onClick={() => setLoadKey((key) => key + 1)}>{loading ? "Loading…" : "Reload file"}</button>
            <button className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90" onClick={() => void refresh()}>{refreshing ? "Refreshing…" : "Refresh ccusage"}</button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <label className="text-xs font-medium text-muted-foreground">Report<select className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" value={report} onChange={onReportChange}>{REPORTS.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className="text-xs font-medium text-muted-foreground">Source<select className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" value={source} onChange={onSourceChange}>{SOURCES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className="text-xs font-medium text-muted-foreground">Since<input className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" placeholder="YYYY-MM-DD" value={since} onChange={(event) => setSince(event.target.value)} /></label>
          <label className="text-xs font-medium text-muted-foreground">Until<input className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" placeholder="YYYY-MM-DD" value={until} onChange={(event) => setUntil(event.target.value)} /></label>
          <label className="text-xs font-medium text-muted-foreground">Timezone<input className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" placeholder="local / UTC" value={timezone} onChange={(event) => setTimezone(event.target.value)} /></label>
        </div>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
        {error ? <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
        <div className="grid gap-3 md:grid-cols-5">
          <Stat label="Total tokens" value={cf.format(totals.tokens)} hint={nf.format(totals.tokens)} />
          <Stat label="Input" value={cf.format(totals.input)} />
          <Stat label="Output" value={cf.format(totals.output)} />
          <Stat label="Cache" value={cf.format(totals.cache)} />
          <Stat label="Cost" value={usd.format(totals.cost)} />
        </div>
        <div className="mt-4"><Chart rows={rows(data)} /></div>
      </div>
    </div>
  )
}

export default definePlugin({
  id: "ccusage-dashboard",
  label: "ccusage Dashboard",
  panels: [{ id: "ccusage-dashboard.panel", label: "ccusage Dashboard", component: CcusageDashboard, placement: "workspace-page" }],
  commands: [{ id: "ccusage-dashboard.open", title: "Open ccusage Dashboard", panelId: "ccusage-dashboard.panel" }],
})
