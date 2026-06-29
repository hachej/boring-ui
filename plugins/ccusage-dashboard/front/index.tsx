import React, { useEffect, useMemo, useState } from "react"
import { definePlugin, type PaneProps, type WorkspaceSourceProps } from "@hachej/boring-workspace/plugin"
import { useApiBaseUrl, useWorkspaceRequestId } from "@hachej/boring-workspace"

const DATA_PATH = ".pi/extensions/ccusage-dashboard/usage.json"
const REPORTS = ["daily", "weekly", "monthly", "session", "blocks"] as const
const SOURCES = ["all", "claude", "codex", "opencode", "amp", "droid", "codebuff", "hermes", "pi", "goose", "openclaw", "kilo", "kimi", "qwen", "copilot", "gemini"] as const

type Report = (typeof REPORTS)[number]
type Source = (typeof SOURCES)[number]
type Row = Record<string, unknown>
type Usage = { ok: boolean; report: Report; source: Source; generatedAt: string; command: string[]; data: Row[]; summary: Record<string, unknown>; error?: string }

type Params = { report?: Report; source?: Source }

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const cf = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 })
const usd = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 })

function workspaceIdFromLocation(): string | undefined {
  const importMatch = /\/runtime\/([^/?#]+)\//.exec(import.meta.url)
  if (importMatch?.[1]) return importMatch[1]
  if (typeof window === "undefined") return undefined
  const direct = new URLSearchParams(window.location.search).get("workspaceId")
  if (direct) return direct
  const pathMatch = /\/runtime\/([^/?#]+)/.exec(window.location.pathname)
  return pathMatch?.[1]
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function rowLabel(row: Row, index: number): string {
  return String(row.date ?? row.week ?? row.month ?? row.session ?? row.source ?? row.agent ?? `Row ${index + 1}`)
}

function rowCost(row: Row): number {
  return num(row.costUSD ?? row.totalCost)
}

function total(data: Usage | undefined, keys: string[], rowGetter: (row: Row) => number): number {
  if (!data) return 0
  for (const key of keys) if (typeof data.summary[key] === "number") return data.summary[key] as number
  return data.data.reduce((sum, row) => sum + rowGetter(row), 0)
}

async function fetchUsage(apiBaseUrl: string, workspaceId?: string): Promise<Usage> {
  const query = new URLSearchParams({ path: DATA_PATH, t: String(Date.now()) })
  if (workspaceId) query.set("workspaceId", workspaceId)
  const headers: Record<string, string> = {}
  if (workspaceId) headers["x-boring-workspace-id"] = workspaceId
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/api/v1/files/raw?${query.toString()}`, { credentials: "include", headers })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`No ccusage data yet. Click Refresh, or ask the agent to run refresh_ccusage_dashboard.${detail ? ` (${response.status}: ${detail.slice(0, 160)})` : ""}`)
  }
  return await response.json() as Usage
}

async function readResponseError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "")
  if (!text) return `agent request failed (${response.status})`
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown }
    return String(typeof parsed.error?.message === "string" ? parsed.error.message : typeof parsed.message === "string" ? parsed.message : text)
  } catch {
    return text.slice(0, 200)
  }
}

async function sendAgentChat(message: string): Promise<void> {
  const workspaceId = workspaceIdFromLocation()
  const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (workspaceId) headers["x-boring-workspace-id"] = workspaceId
  const sessionResponse = await fetch(`/api/v1/agent/pi-chat/sessions${query}`, { method: "POST", credentials: "include", headers, body: JSON.stringify({ title: "ccusage dashboard refresh" }) })
  if (!sessionResponse.ok) throw new Error(await readResponseError(sessionResponse))
  const session = await sessionResponse.json().catch(() => null) as { id?: unknown } | null
  const sessionId = typeof session?.id === "string" ? session.id : undefined
  if (!sessionId) throw new Error("agent session creation did not return a session id")
  const promptResponse = await fetch(`/api/v1/agent/pi-chat/${encodeURIComponent(sessionId)}/prompt${query}`, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify({ message, clientNonce: `ccusage-dashboard-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` }),
  })
  if (!promptResponse.ok) throw new Error(await readResponseError(promptResponse))
  await promptResponse.text().catch(() => undefined)
}

function refreshPrompt(report: Report, source: Source, since: string, until: string, timezone: string): string {
  const bits = [`report: ${report}`, `source: ${source}`]
  if (since) bits.push(`since: ${since}`)
  if (until) bits.push(`until: ${until}`)
  if (timezone) bits.push(`timezone: ${timezone}`)
  return `Use refresh_ccusage_dashboard with ${bits.join(", ")} and update the ccusage dashboard.`
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="rounded-xl border border-border bg-card p-4 shadow-sm"><div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-2 text-2xl font-semibold">{value}</div>{hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}</div>
}

function Chart({ rows }: { rows: Row[] }) {
  const chartRows = rows.slice(-60)
  if (chartRows.length === 0) return <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No usage rows found yet.</div>
  const maxTokens = Math.max(1, ...chartRows.map((row) => num(row.totalTokens)))
  const maxCost = Math.max(1, ...chartRows.map(rowCost))
  const width = Math.max(680, chartRows.length * 36)
  const height = 260, left = 52, right = 24, top = 20, bottom = 44
  const innerWidth = width - left - right, innerHeight = height - top - bottom
  const x = (i: number) => left + (chartRows.length <= 1 ? innerWidth / 2 : (i / (chartRows.length - 1)) * innerWidth)
  const tokenY = (tokens: number) => top + innerHeight - (tokens / maxTokens) * innerHeight
  const costY = (cost: number) => top + innerHeight - (cost / maxCost) * innerHeight
  const costPoints = chartRows.map((row, i) => `${x(i)},${costY(rowCost(row))}`).join(" ")
  return <div className="overflow-x-auto rounded-xl border border-border bg-card p-3"><svg width={width} height={height} role="img" aria-label="Token consumption over time" className="block"><line x1={left} y1={top + innerHeight} x2={width - right} y2={top + innerHeight} stroke="currentColor" className="text-border" /><line x1={left} y1={top} x2={left} y2={top + innerHeight} stroke="currentColor" className="text-border" />{[0, .25, .5, .75, 1].map((tick) => { const y = top + innerHeight - tick * innerHeight; return <g key={tick}><line x1={left} y1={y} x2={width - right} y2={y} stroke="currentColor" className="text-border/60" strokeDasharray="3 5" /><text x={left - 10} y={y + 4} textAnchor="end" className="fill-muted-foreground text-[10px]">{cf.format(maxTokens * tick)}</text></g> })}{chartRows.map((row, i) => { const barWidth = Math.max(10, Math.min(24, innerWidth / Math.max(1, chartRows.length) - 6)); const tokens = num(row.totalTokens); const y = tokenY(tokens); return <g key={`${rowLabel(row, i)}-${i}`}><rect x={x(i) - barWidth / 2} y={y} width={barWidth} height={top + innerHeight - y} rx={4} className="fill-sky-500/75" /><title>{`${rowLabel(row, i)} — ${nf.format(tokens)} tokens, ${usd.format(rowCost(row))}`}</title></g> })}<polyline points={costPoints} fill="none" stroke="rgb(245 158 11)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />{chartRows.map((row, i) => <text key={`label-${i}`} x={x(i)} y={height - 16} textAnchor="middle" className="fill-muted-foreground text-[10px]">{rowLabel(row, i).slice(5)}</text>)}</svg><div className="mt-2 flex gap-4 text-xs text-muted-foreground"><span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-sky-500" />Tokens</span><span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" />Cost trend</span></div></div>
}

function CcusageDashboard({ params }: PaneProps<Params>) {
  const apiBaseUrl = useApiBaseUrl()
  const workspaceRequestId = useWorkspaceRequestId() || workspaceIdFromLocation()
  const [report, setReport] = useState<Report>(params.report ?? "daily")
  const [source, setSource] = useState<Source>(params.source ?? "all")
  const [since, setSince] = useState("")
  const [until, setUntil] = useState("")
  const [timezone, setTimezone] = useState("")
  const [data, setData] = useState<Usage>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [loadKey, setLoadKey] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(undefined)
    fetchUsage(apiBaseUrl, workspaceRequestId)
      .then((next) => { if (active) setData(next) })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : String(caught)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [apiBaseUrl, workspaceRequestId, loadKey])

  async function refresh() {
    setRefreshing(true)
    setError(undefined)
    try {
      await sendAgentChat(refreshPrompt(report, source, since, until, timezone))
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

  return <div className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground"><div className="border-b border-border bg-card/60 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">ccusage token dashboard</h2><p className="mt-1 text-sm text-muted-foreground">Workspace-local token consumption over time. Refresh runs ccusage through the agent and writes usage.json.</p></div><div className="flex gap-2"><button className="rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-accent" onClick={() => setLoadKey((key) => key + 1)}>{loading ? "Loading…" : "Reload file"}</button><button className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90" onClick={refresh}>{refreshing ? "Refreshing…" : "Refresh ccusage"}</button></div></div><div className="mt-4 grid gap-3 md:grid-cols-5"><label className="text-xs font-medium text-muted-foreground">Report<select className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" value={report} onChange={(event) => setReport(event.target.value as Report)}>{REPORTS.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label className="text-xs font-medium text-muted-foreground">Source<select className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" value={source} onChange={(event) => setSource(event.target.value as Source)}>{SOURCES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label className="text-xs font-medium text-muted-foreground">Since<input className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" placeholder="YYYY-MM-DD" value={since} onChange={(event) => setSince(event.target.value)} /></label><label className="text-xs font-medium text-muted-foreground">Until<input className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" placeholder="YYYY-MM-DD" value={until} onChange={(event) => setUntil(event.target.value)} /></label><label className="text-xs font-medium text-muted-foreground">Timezone<input className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" placeholder="local / UTC" value={timezone} onChange={(event) => setTimezone(event.target.value)} /></label></div></div><div className="min-h-0 min-w-0 flex-1 overflow-auto p-4">{error ? <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}<div className="grid gap-3 md:grid-cols-5"><Stat label="Total tokens" value={cf.format(totals.tokens)} hint={nf.format(totals.tokens)} /><Stat label="Input" value={cf.format(totals.input)} /><Stat label="Output" value={cf.format(totals.output)} /><Stat label="Cache" value={cf.format(totals.cache)} /><Stat label="Cost" value={usd.format(totals.cost)} /></div><div className="mt-4"><Chart rows={data?.data ?? []} /></div><div className="mt-4 overflow-hidden rounded-xl border border-border bg-card"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3"><div className="text-sm font-medium">Usage rows</div><div className="text-xs text-muted-foreground">{data?.command?.join(" ") ?? "ccusage"}{data?.generatedAt ? ` · ${new Date(data.generatedAt).toLocaleString()}` : ""}</div></div><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-muted/30 text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2 text-left">Period</th><th className="px-4 py-2 text-left">Agent</th><th className="px-4 py-2 text-right">Input</th><th className="px-4 py-2 text-right">Output</th><th className="px-4 py-2 text-right">Cache</th><th className="px-4 py-2 text-right">Total</th><th className="px-4 py-2 text-right">Cost</th><th className="px-4 py-2 text-left">Models</th></tr></thead><tbody>{(data?.data ?? []).map((row, index) => { const models = (Array.isArray(row.models) ? row.models : Array.isArray(row.modelsUsed) ? row.modelsUsed : []) as unknown[]; return <tr key={`${rowLabel(row, index)}-${index}`} className="border-t border-border"><td className="whitespace-nowrap px-4 py-2 font-medium">{rowLabel(row, index)}</td><td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{String(row.source ?? row.agent ?? data?.source ?? source)}</td><td className="px-4 py-2 text-right tabular-nums">{nf.format(num(row.inputTokens))}</td><td className="px-4 py-2 text-right tabular-nums">{nf.format(num(row.outputTokens))}</td><td className="px-4 py-2 text-right tabular-nums">{nf.format(num(row.cacheCreationTokens) + num(row.cacheReadTokens))}</td><td className="px-4 py-2 text-right tabular-nums">{nf.format(num(row.totalTokens))}</td><td className="px-4 py-2 text-right tabular-nums">{usd.format(rowCost(row))}</td><td className="max-w-sm px-4 py-2 text-muted-foreground">{models.slice(0, 3).map(String).join(", ")}{models.length > 3 ? ` +${models.length - 3}` : ""}</td></tr> })}</tbody></table></div></div></div></div>
}

function CcusageSource({ openPanel }: WorkspaceSourceProps) {
  return <div className="flex h-full flex-col gap-3 bg-background p-3 text-foreground"><div><h2 className="text-sm font-semibold">ccusage</h2><p className="text-xs text-muted-foreground">Token usage dashboard</p></div><button type="button" className="rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-accent" onClick={() => openPanel?.({ id: "ccusage-dashboard.panel", component: "ccusage-dashboard.panel", title: "ccusage Dashboard" })}>Open dashboard</button></div>
}

export default definePlugin({
  id: "ccusage-dashboard",
  label: "ccusage Dashboard",
  workspaceSources: [{ id: "ccusage-dashboard.tab", label: "ccusage", component: CcusageSource, defaultPanelId: "ccusage-dashboard.panel" }],
  panels: [{ id: "ccusage-dashboard.panel", label: "ccusage Dashboard", component: CcusageDashboard, placement: "center" }],
  commands: [{ id: "ccusage-dashboard.open", title: "Open ccusage Dashboard", panelId: "ccusage-dashboard.panel" }],
})
