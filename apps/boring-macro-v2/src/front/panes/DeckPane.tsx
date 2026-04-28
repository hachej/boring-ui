import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { DockviewPanelApi } from "dockview-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts"
import type { Observation, SeriesPayload } from "../macroSeriesTypes"
import { fetchMacroSeries } from "../macroSeriesData"

interface DeckParams {
  path?: string
}

interface DeckPaneProps {
  params?: DeckParams
  panelApi?: DockviewPanelApi
}


function openSeriesPane(seriesId: string): void {
  void fetch("/api/v1/ui/commands", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "openPanel",
      params: {
        id: `chart:${seriesId}`,
        component: "chart-canvas",
        title: seriesId,
        params: { seriesId },
      },
    }),
  })
}

const COLORS = ["#ff6600", "#3b82f6", "#10b981", "#8b5cf6", "#ef4444"]

function fmtNumber(v: number | null | undefined): string {
  if (v == null) return "—"
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + "M"
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(2) + "K"
  return v.toFixed(2)
}

function changeBadge(obs: Observation[]): { abs: number; pct: number | null; latest: number | null } | null {
  const vals = obs.filter((o): o is Observation & { value: number } => o.value != null)
  if (vals.length < 2) return null
  const first = vals[0].value
  const last = vals[vals.length - 1].value
  const abs = last - first
  const pct = Math.abs(first) > Number.EPSILON ? (abs / first) * 100 : null
  return { abs, pct, latest: last }
}

function MiniTimeSeries({ ids, title }: { ids: string[]; title?: string }) {
  const [series, setSeries] = useState<SeriesPayload[]>([])
  useEffect(() => {
    let cancelled = false
    Promise.all(ids.map(fetchMacroSeries)).then((all) => {
      if (!cancelled) setSeries(all)
    })
    return () => {
      cancelled = true
    }
  }, [ids.join(",")])

  const merged = useMemo(() => {
    const map = new Map<string, Record<string, string | number | null>>()
    series.forEach((s, i) => {
      const id = ids[i]
      for (const o of s.observations) {
        let row = map.get(o.date)
        if (!row) {
          row = { date: o.date }
          map.set(o.date, row)
        }
        row[id] = o.value
      }
    })
    return [...map.values()].sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    )
  }, [series, ids.join(",")])

  return (
    <figure className="my-4 rounded border border-border p-2">
      <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium text-muted-foreground">
          {title ?? ids.join(" · ")}
        </span>
        <div className="flex flex-wrap gap-2">
          {series.map((s, i) => {
            const id = ids[i]
            const c = changeBadge(s.observations)
            const color = COLORS[i % COLORS.length]
            return (
              <button
                key={id}
                type="button"
                onClick={() => openSeriesPane(id)}
                className="flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] hover:bg-muted/50"
                title={`Open ${id} in chart pane`}
              >
                <span className="font-mono" style={{ color }}>{id}</span>
                {c?.latest != null && (
                  <span className="tabular-nums">{fmtNumber(c.latest)}</span>
                )}
                {c?.pct != null && (
                  <span
                    className={`tabular-nums ${
                      c.pct >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {c.pct >= 0 ? "+" : ""}
                    {c.pct.toFixed(1)}%
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </figcaption>
      <div style={{ width: "100%", height: 240 }}>
        <ResponsiveContainer>
          <LineChart data={merged}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            {ids.map((id, i) => (
              <Line
                key={id}
                type="monotone"
                dataKey={id}
                stroke={COLORS[i % COLORS.length]}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

const TIMESERIES_RX = /\{\{TimeSeries\s+([^}]+?)\}\}/g

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  const rx = /(\w+)\s*=\s*"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = rx.exec(raw)) !== null) {
    out[m[1]] = m[2]
  }
  return out
}

interface SegmentText {
  type: "text"
  value: string
}
interface SegmentWidget {
  type: "timeseries"
  ids: string[]
  title?: string
}
type Segment = SegmentText | SegmentWidget

function tokenize(markdown: string): Segment[] {
  const segs: Segment[] = []
  let last = 0
  for (const m of markdown.matchAll(TIMESERIES_RX)) {
    if (m.index === undefined) continue
    if (m.index > last) {
      segs.push({ type: "text", value: markdown.slice(last, m.index) })
    }
    const attrs = parseAttrs(m[1])
    const ids = (attrs.ids ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    segs.push({ type: "timeseries", ids, title: attrs.title })
    last = m.index + m[0].length
  }
  if (last < markdown.length) {
    segs.push({ type: "text", value: markdown.slice(last) })
  }
  return segs
}

interface ParsedDeck {
  title: string | null
  body: string
}

function parseFrontmatter(markdown: string): ParsedDeck {
  const lines = markdown.split("\n")
  if (lines[0]?.trim() !== "---") return { title: null, body: markdown }
  let title: string | null = null
  let i = 1
  for (; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() === "---") {
      i += 1
      break
    }
    const t = line.trim()
    if (t.toLowerCase().startsWith("title:")) {
      const v = t.slice(6).trim().replace(/^['"]|['"]$/g, "")
      if (v) title = v
    }
  }
  return { title, body: lines.slice(i).join("\n") }
}

function splitSlides(markdown: string): string[] {
  const slides: string[] = []
  let current: string[] = []
  for (const line of markdown.split("\n")) {
    if (line.trim() === "---") {
      const slide = current.join("\n").trim()
      if (slide) slides.push(slide)
      current = []
    } else {
      current.push(line)
    }
  }
  const tail = current.join("\n").trim()
  if (tail) slides.push(tail)
  return slides.length > 0 ? slides : ["# Empty Deck\n\nAdd slides separated by `---`."]
}

export function DeckPane({ params: initial, panelApi }: DeckPaneProps) {
  const [params, setParams] = useState<DeckParams>(initial ?? {})
  const path = params.path

  const [savedContent, setSavedContent] = useState<string>("")
  const [draft, setDraft] = useState<string>("")
  const [mode, setMode] = useState<"read" | "edit">("read")
  const [activeSlide, setActiveSlide] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft

  useEffect(() => {
    if (!panelApi) return
    const sub = panelApi.onDidParametersChange((e) => {
      setParams({ ...((e.params ?? {}) as DeckParams) })
    })
    return () => sub.dispose()
  }, [panelApi])

  // Load
  useEffect(() => {
    if (!path) return
    let cancelled = false
    setError(null)
    fetch(`/api/macro/deck?path=${encodeURIComponent(path)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`deck ${path}: ${r.status}`)
        return r.text()
      })
      .then((text) => {
        if (!cancelled) {
          setSavedContent(text)
          setDraft(text)
          setActiveSlide(0)
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [path])

  const dirty = mode === "edit" && draft !== savedContent

  const save = useCallback(async () => {
    if (!path) return
    setSaving(true)
    try {
      const res = await fetch(`/api/macro/deck?path=${encodeURIComponent(path)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draftRef.current }),
      })
      if (!res.ok) throw new Error(`save: ${res.status}`)
      setSavedContent(draftRef.current)
      setSavedAt(Date.now())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [path])

  // Cmd+S to save while editing.
  useEffect(() => {
    if (mode !== "edit") return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [mode, save])

  const parsed = useMemo(() => parseFrontmatter(savedContent), [savedContent])
  const slides = useMemo(() => splitSlides(parsed.body), [parsed.body])

  if (!path) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No deck loaded.
      </div>
    )
  }

  if (error && savedContent === "") {
    return (
      <div className="flex h-full items-center justify-center text-sm text-destructive">
        {error}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs">
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold">
            {parsed.title ?? path.split("/").pop()?.replace(/\.md$/, "") ?? path}
          </span>
          <span className="truncate font-mono text-muted-foreground">{path}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {mode === "read" ? (
            <>
              <button
                type="button"
                onClick={() => setActiveSlide((i) => Math.max(0, i - 1))}
                disabled={activeSlide === 0}
                className="rounded border border-border px-2 py-0.5 hover:bg-muted disabled:opacity-40"
              >
                Prev
              </button>
              <span className="tabular-nums">
                {activeSlide + 1} / {slides.length}
              </span>
              <button
                type="button"
                onClick={() =>
                  setActiveSlide((i) => Math.min(slides.length - 1, i + 1))
                }
                disabled={activeSlide === slides.length - 1}
                className="rounded border border-border px-2 py-0.5 hover:bg-muted disabled:opacity-40"
              >
                Next
              </button>
            </>
          ) : (
            <>
              {dirty && <span className="text-orange-600">●</span>}
              {saving && <span className="text-muted-foreground">saving…</span>}
              {savedAt && !dirty && !saving && (
                <span className="text-muted-foreground">saved</span>
              )}
              <button
                type="button"
                onClick={() => void save()}
                disabled={!dirty || saving}
                className="rounded border border-border px-2 py-0.5 hover:bg-muted disabled:opacity-40"
              >
                Save
              </button>
            </>
          )}
          <div className="flex items-center gap-0.5 rounded border border-border bg-muted/50 p-0.5">
            {(["read", "edit"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded px-2 py-0.5 text-xs ${
                  mode === m
                    ? "bg-background font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m === "read" ? "Read" : "Edit"}
              </button>
            ))}
          </div>
        </div>
      </header>

      {error && savedContent !== "" && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}

      {mode === "read" ? (
        <article className="prose prose-sm max-w-none flex-1 overflow-auto px-6 py-4 dark:prose-invert">
          {tokenize(slides[activeSlide] ?? "").map((seg, i) =>
            seg.type === "text" ? (
              <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>
                {seg.value}
              </ReactMarkdown>
            ) : (
              <MiniTimeSeries key={i} ids={seg.ids} title={seg.title} />
            ),
          )}
        </article>
      ) : (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="flex-1 resize-none border-0 bg-background px-4 py-3 font-mono text-xs leading-relaxed outline-none"
          placeholder="# Slide 1&#10;&#10;Use --- on its own line to split slides.&#10;&#10;Embed series:&#10;{{TimeSeries ids=&quot;CPIAUCSL,UNRATE&quot; title=&quot;Inflation vs Unemployment&quot;}}"
        />
      )}
    </div>
  )
}
