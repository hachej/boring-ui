import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import { Button, Separator } from "@boring/workspace"
import { ChevronLeft, ChevronRight, ExternalLink, Maximize2, Minimize2 } from "lucide-react"

const MarkdownEditor = lazy(() =>
  import("@boring/workspace").then((m) => ({ default: m.MarkdownEditor })),
)
import type { Observation, SeriesPayload } from "../macroSeriesTypes"
import { fetchMacroSeries } from "../macroSeriesData"
import { SERIES_COLORS, formatSeriesValue, openSeriesPane } from "../macroSeriesUi"

interface DeckParams {
  path?: string
}

interface DeckPaneProps {
  params?: DeckParams
  panelApi?: DockviewPanelApi
}

const COLORS = SERIES_COLORS.slice(0, 5)

const fmtNumber = (v: number | null | undefined): string =>
  formatSeriesValue(v, { emptyLabel: "—" })

const padIndex = (n: number): string => String(n).padStart(2, "0")

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
    <figure className="not-prose my-6">
      <figcaption className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--deck-accent)]">
            Figure
          </span>
          <span className="text-base font-medium tracking-tight text-foreground">
            {title ?? ids.join(" · ")}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {series.map((s, i) => {
            const id = ids[i]
            const c = changeBadge(s.observations)
            const color = COLORS[i % COLORS.length]
            const positive = c?.pct != null && c.pct >= 0
            return (
              <button
                key={id}
                type="button"
                onClick={() => openSeriesPane(id)}
                className="group inline-flex items-center gap-2 rounded-md border border-border/70 bg-background/60 px-2 py-1 text-[11px] transition-colors hover:border-border hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                title={`Open ${id} in chart pane`}
              >
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="font-mono tracking-tight text-foreground">{id}</span>
                {c?.latest != null && (
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {fmtNumber(c.latest)}
                  </span>
                )}
                {c?.pct != null && (
                  <span
                    className={`font-mono tabular-nums ${
                      positive ? "text-emerald-500/90" : "text-rose-500/90"
                    }`}
                  >
                    {positive ? "+" : ""}
                    {c.pct.toFixed(1)}%
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </figcaption>
      <div
        className="relative"
        style={{
          width: "100%",
          height: "clamp(240px, 38cqw, 440px)",
        }}
      >
        <ResponsiveContainer>
          <LineChart data={merged} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid
              vertical={false}
              stroke="oklch(from var(--foreground) l c h / 0.08)"
              strokeDasharray="2 4"
            />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "oklch(from var(--muted-foreground) l c h / 0.85)" }}
              tickLine={false}
              axisLine={{ stroke: "oklch(from var(--border) l c h / 0.6)" }}
              minTickGap={32}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "oklch(from var(--muted-foreground) l c h / 0.85)" }}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            {ids.map((id, i) => (
              <Line
                key={id}
                type="monotone"
                dataKey={id}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={1.75}
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

// Deck title is encoded as a `## title: X` H2 inside the first slide. We
// avoid YAML frontmatter on purpose: the markdown editor used in edit mode
// doesn't understand `---\nkey: val\n---` and would mangle it on round-trip
// through autosave. A plain H2 survives the rich-editor round trip cleanly.
const TITLE_RX = /^##\s+title:\s*(.+)$/i

function parseFrontmatter(markdown: string): ParsedDeck {
  // Pre-strip a leading `---` separator (the file convention puts a `---`
  // at the very top, separating the cover from slide 1). Without this,
  // the title sits in slide 0 and an empty slide is rendered first.
  const lines = markdown.split("\n")
  let start = 0
  while (start < lines.length && lines[start].trim() === "") start += 1
  if (lines[start]?.trim() === "---") {
    lines.splice(start, 1)
  }

  // Find the first `## title: X` line in the first slide (i.e. before the
  // first `---` slide separator) and extract it.
  let title: string | null = null
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim()
    if (t === "---") break
    const m = TITLE_RX.exec(t)
    if (m) {
      title = m[1].trim().replace(/^['"]|['"]$/g, "") || null
      lines.splice(i, 1)
      // Eat one trailing blank so the slide doesn't open with whitespace.
      if (i < lines.length && lines[i].trim() === "") lines.splice(i, 1)
      break
    }
  }
  return { title, body: lines.join("\n") }
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

interface CoverSlide {
  kind: "cover"
  title: string
}
interface BodySlide {
  kind: "body"
  markdown: string
}
type DeckSlide = CoverSlide | BodySlide

function buildSlides(parsed: ParsedDeck): DeckSlide[] {
  const body = splitSlides(parsed.body).map<BodySlide>((markdown) => ({
    kind: "body",
    markdown,
  }))
  if (parsed.title) {
    return [{ kind: "cover", title: parsed.title }, ...body]
  }
  return body
}

export function DeckPane({ params: initial, panelApi }: DeckPaneProps) {
  const [params, setParams] = useState<DeckParams>(initial ?? {})
  const path = params.path

  const [savedContent, setSavedContent] = useState<string>("")
  const [draft, setDraft] = useState<string>("")
  const [mode, setMode] = useState<"read" | "edit">("read")
  const [activeSlide, setActiveSlide] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft

  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current
    if (!el) return
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void el.requestFullscreen?.().catch(() => {
        /* user denied, no-op */
      })
    }
  }, [])

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === rootRef.current)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

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

  const save = useCallback(async () => {
    if (!path) return
    // Snapshot the request payload so that, if the user types while this
    // request is in flight, we acknowledge ONLY what was actually persisted.
    // Setting `savedContent` from the live ref would mark newer keystrokes as
    // saved and let the autosave effect cancel the next save (data loss).
    const snapshot = draftRef.current
    try {
      const res = await fetch(`/api/macro/deck?path=${encodeURIComponent(path)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: snapshot }),
      })
      if (!res.ok) throw new Error(`save: ${res.status}`)
      setSavedContent(snapshot)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [path])

  // Autosave: persist any draft change. Debounce 600ms while editing; flush
  // immediately when the user toggles to read so the slides reflect what they
  // just typed.
  useEffect(() => {
    if (draft === savedContent) return
    const delay = mode === "edit" ? 600 : 0
    const t = setTimeout(() => void save(), delay)
    return () => clearTimeout(t)
  }, [draft, mode, savedContent, save])

  const parsed = useMemo(() => parseFrontmatter(savedContent), [savedContent])
  const slides = useMemo(() => buildSlides(parsed), [parsed])
  const total = slides.length
  const current = slides[activeSlide]
  const fileName =
    path?.split("/").pop()?.replace(/\.md$/, "") ?? path ?? "deck"
  const deckTitle = parsed.title ?? fileName

  // Arrow-key navigation in read mode.
  useEffect(() => {
    if (mode !== "read") return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return
      }
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault()
        setActiveSlide((i) => Math.min(total - 1, i + 1))
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault()
        setActiveSlide((i) => Math.max(0, i - 1))
      } else if (e.key === "Home") {
        e.preventDefault()
        setActiveSlide(0)
      } else if (e.key === "End") {
        e.preventDefault()
        setActiveSlide(total - 1)
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault()
        toggleFullscreen()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [mode, total, toggleFullscreen])

  if (!path) {
    return (
      <div className="flex h-full items-center justify-center bg-[color:var(--canvas)] text-sm text-muted-foreground">
        No deck loaded.
      </div>
    )
  }

  if (error && savedContent === "") {
    return (
      <div className="flex h-full items-center justify-center bg-[color:var(--canvas)] text-sm text-destructive">
        {error}
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className="deck-root flex h-full flex-col bg-[color:var(--canvas)]"
    >
      {/* Top chrome ----------------------------------------------------- */}
      <header className="flex items-center justify-between gap-3 border-b border-border/60 bg-background/60 px-4 py-2 backdrop-blur-[2px]">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--deck-accent)]">
            Deck
          </span>
          <span className="truncate text-[13px] font-medium tracking-tight text-foreground">
            {deckTitle}
          </span>
          <span className="hidden truncate font-mono text-[11px] text-muted-foreground/70 sm:inline">
            {path}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="inline-flex items-center rounded-md border border-border/70 bg-background p-0.5">
            {(["read", "edit"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={`rounded-[4px] px-2.5 py-1 text-[11px] font-medium tracking-tight transition-colors ${
                  mode === m
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m === "read" ? "Read" : "Edit"}
              </button>
            ))}
          </div>

          <Button
            variant="ghost"
            size="icon-xs"
            asChild
            aria-label="Open in new tab"
            title="Open deck in new tab"
          >
            <a
              href={`/present?path=${encodeURIComponent(path)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink />
            </a>
          </Button>

          <Button
            variant="ghost"
            size="icon-xs"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Present fullscreen"}
            title={isFullscreen ? "Exit fullscreen (Esc)" : "Present fullscreen (F)"}
          >
            {isFullscreen ? <Minimize2 /> : <Maximize2 />}
          </Button>
        </div>
      </header>

      {error && savedContent !== "" && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-5 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Stage --------------------------------------------------------- */}
      {mode === "read" ? (
        <div className="relative flex-1 overflow-hidden">
          {/* Ambient corner mark */}
          <div className="pointer-events-none absolute right-6 top-4 z-10 hidden font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/60 md:block">
            {padIndex(activeSlide + 1)} <span className="text-muted-foreground/30">/</span>{" "}
            {padIndex(total)}
          </div>

          <div className="absolute inset-0 overflow-auto">
            <div
              className={`mx-auto flex min-h-full w-full items-center justify-center ${
                isFullscreen
                  ? "max-w-[1600px] px-2 py-2"
                  : "max-w-[1100px] px-3 py-4 sm:px-6 sm:py-6"
              }`}
            >
              <article
                key={activeSlide}
                className="slide-canvas relative w-full overflow-hidden rounded-2xl border border-border/70 bg-card text-card-foreground shadow-[0_1px_0_oklch(from_var(--foreground)_l_c_h/0.04),0_24px_60px_-30px_oklch(from_var(--foreground)_l_c_h/0.45)]"
                style={{ containerType: "inline-size", containerName: "deck" }}
              >
                {current?.kind === "cover" ? (
                  <CoverSlideView
                    title={current.title}
                    fileName={fileName}
                    total={total - 1}
                  />
                ) : (
                  <BodySlideView
                    markdown={current?.kind === "body" ? current.markdown : ""}
                    eyebrow={deckTitle}
                    // 1-indexed body slide number (skips the cover when present).
                    slideNumber={
                      slides[0]?.kind === "cover" ? activeSlide : activeSlide + 1
                    }
                  />
                )}
              </article>
            </div>
          </div>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                <span className="animate-pulse">Loading editor…</span>
              </div>
            }
          >
            <MarkdownEditor
              content={draft}
              onChange={(v: string) => setDraft(v)}
              placeholder={`# Slide 1\n\nUse --- on its own line to split slides.\n\nEmbed series with {{TimeSeries ids="..."}}.`}
              className="flex min-h-0 flex-1 flex-col"
            />
          </Suspense>
        </div>
      )}

      {/* Slide rail (read mode only) ----------------------------------- */}
      {mode === "read" && (
        <footer className="flex shrink-0 items-center gap-3 border-t border-border/60 bg-background/60 px-4 py-2">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setActiveSlide((i) => Math.max(0, i - 1))}
            disabled={activeSlide === 0}
            aria-label="Previous slide"
          >
            <ChevronLeft />
            Prev
          </Button>

          <div className="flex flex-1 items-center justify-center gap-2.5">
            <span className="font-mono text-[11px] tabular-nums tracking-tight text-foreground">
              {padIndex(activeSlide + 1)}
            </span>
            <div
              role="group"
              aria-label="Slide navigation"
              className="flex max-w-[60%] flex-1 items-center gap-0.5 overflow-x-auto"
            >
              {slides.map((s, i) => {
                const isActive = i === activeSlide
                const hasCover = slides[0]?.kind === "cover"
                const label =
                  s.kind === "cover"
                    ? "Cover"
                    : `Slide ${hasCover ? i : i + 1}`
                return (
                  <button
                    key={i}
                    type="button"
                    aria-current={isActive ? "true" : undefined}
                    aria-label={label}
                    onClick={() => setActiveSlide(i)}
                    // Hit target is the full button (≥24px tall via py-2.5);
                    // the visible pill stays editorial-thin via the inner span.
                    className="group flex flex-1 min-w-[28px] max-w-[56px] cursor-pointer items-center justify-center px-0.5 py-2.5 focus-visible:outline-none"
                  >
                    <span className="sr-only">{label}</span>
                    <span
                      aria-hidden
                      className={`block h-1 w-full rounded-full transition-colors ${
                        isActive
                          ? "bg-[color:var(--deck-accent)]"
                          : "bg-border group-hover:bg-muted-foreground/40 group-focus-visible:bg-muted-foreground/40"
                      }`}
                    />
                  </button>
                )
              })}
            </div>
            <span className="font-mono text-[11px] tabular-nums tracking-tight text-muted-foreground">
              {padIndex(total)}
            </span>
          </div>

          <Separator orientation="vertical" className="!h-5" />

          <Button
            variant="ghost"
            size="xs"
            onClick={() => setActiveSlide((i) => Math.min(total - 1, i + 1))}
            disabled={activeSlide === total - 1}
            aria-label="Next slide"
          >
            Next
            <ChevronRight />
          </Button>
        </footer>
      )}

      {/* Deck-owned brand accent (workspace overrides --accent to neutral in
          dark, which would mute editorial cues). Plus slide-enter animation,
          honoring prefers-reduced-motion. */}
      <style>{`
        .deck-root { --deck-accent: oklch(0.62 0.14 65); }
        .dark .deck-root { --deck-accent: oklch(0.76 0.16 68); }
        .slide-canvas {
          animation: slide-enter 240ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @keyframes slide-enter {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .slide-canvas { animation: none; }
        }
      `}</style>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Slide views                                                                */
/* -------------------------------------------------------------------------- */

function CoverSlideView({
  title,
  fileName,
  total,
}: {
  title: string
  fileName: string
  total: number
}) {
  return (
    <div className="relative flex min-h-[min(60vh,560px)] flex-col justify-between px-6 py-7 sm:px-10 sm:py-10">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[color:var(--deck-accent)]">
          Macro · Deck
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70">
          {fileName}
        </span>
      </div>

      <div className="flex flex-1 items-center">
        <h1
          className="max-w-[18ch] text-balance font-light leading-[0.98] tracking-[-0.03em] text-foreground"
          style={{
            fontSize: "clamp(2rem, 13cqw, 5.5rem)",
            wordBreak: "break-word",
            hyphens: "auto",
          }}
        >
          {title}
        </h1>
      </div>

      <div className="flex items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <span aria-hidden className="h-px w-10 bg-[color:var(--deck-accent)]" />
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            {total} {total === 1 ? "slide" : "slides"}
          </span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70">
          ← →  to navigate
        </span>
      </div>
    </div>
  )
}

function BodySlideView({
  markdown,
  eyebrow,
  slideNumber,
}: {
  markdown: string
  eyebrow: string
  slideNumber: number
}) {
  const segments = useMemo(() => tokenize(markdown), [markdown])
  return (
    <div className="relative flex min-h-[min(60vh,560px)] flex-col gap-5 px-6 py-6 sm:px-10 sm:py-8">
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-3">
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--deck-accent)]"
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            {eyebrow}
          </span>
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70">
          {padIndex(slideNumber)}
        </span>
      </div>

      <div className="deck-prose flex-1">
        {segments.map((seg, i) =>
          seg.type === "text" ? (
            <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>
              {seg.value}
            </ReactMarkdown>
          ) : (
            <MiniTimeSeries key={i} ids={seg.ids} title={seg.title} />
          ),
        )}
      </div>

      <style>{`
        .deck-prose { color: var(--foreground); }
        .deck-prose > * + * { margin-top: 1.05rem; }
        .deck-prose figure { max-width: none; width: 100%; }
        .deck-prose h1 {
          font-size: clamp(1.5rem, 6cqw, 3.5rem);
          font-weight: 300;
          line-height: 1.04;
          letter-spacing: -0.025em;
          margin: 0 0 1.5rem;
          max-width: 22ch;
          text-wrap: balance;
        }
        .deck-prose h2 {
          font-size: 1.5rem;
          font-weight: 500;
          letter-spacing: -0.015em;
          line-height: 1.2;
          margin: 1.75rem 0 0.5rem;
        }
        .deck-prose h3 {
          font-size: 1.125rem;
          font-weight: 500;
          letter-spacing: -0.01em;
          margin: 1.25rem 0 0.4rem;
        }
        .deck-prose p {
          font-size: 1.0625rem;
          line-height: 1.65;
          color: oklch(from var(--foreground) l c h / 0.86);
          max-width: 70ch;
        }
        .deck-prose ul, .deck-prose ol {
          padding-left: 1.25rem;
          font-size: 1.0625rem;
          line-height: 1.65;
          color: oklch(from var(--foreground) l c h / 0.86);
        }
        .deck-prose ul { list-style: none; padding-left: 0; }
        .deck-prose ul > li {
          position: relative;
          padding-left: 1.25rem;
          margin: 0.4rem 0;
        }
        .deck-prose ul > li::before {
          content: "";
          position: absolute;
          left: 0;
          top: 0.7em;
          width: 0.4rem;
          height: 1px;
          background: var(--deck-accent);
        }
        .deck-prose ol { list-style: decimal; }
        .deck-prose ol > li::marker {
          color: var(--muted-foreground);
          font-variant-numeric: tabular-nums;
          font-feature-settings: "tnum";
        }
        .deck-prose strong { font-weight: 600; }
        .deck-prose em { font-style: italic; color: oklch(from var(--foreground) l c h / 0.92); }
        .deck-prose code {
          font-family: var(--font-mono);
          font-size: 0.88em;
          padding: 0.08em 0.35em;
          border-radius: 4px;
          background: oklch(from var(--foreground) l c h / 0.06);
          color: var(--foreground);
        }
        .deck-prose pre {
          font-family: var(--font-mono);
          font-size: 0.85em;
          line-height: 1.6;
          background: oklch(from var(--foreground) l c h / 0.04);
          border: 1px solid oklch(from var(--border) l c h / 0.6);
          border-radius: 8px;
          padding: 0.9rem 1rem;
          overflow-x: auto;
          margin: 1.25rem 0;
        }
        .deck-prose pre code { background: transparent; padding: 0; font-size: inherit; }
        .deck-prose blockquote {
          margin: 1.5rem 0;
          padding: 0;
          color: oklch(from var(--foreground) l c h / 0.78);
          font-style: italic;
          font-size: 1.15rem;
          line-height: 1.55;
          letter-spacing: -0.005em;
        }
        .deck-prose blockquote::before {
          content: "“";
          display: block;
          font-style: normal;
          font-size: 2.25rem;
          line-height: 0.6;
          color: var(--deck-accent);
          margin-bottom: 0.4rem;
        }
        .deck-prose a {
          color: var(--foreground);
          text-decoration: underline;
          text-decoration-color: var(--deck-accent);
          text-decoration-thickness: 1px;
          text-underline-offset: 3px;
        }
        .deck-prose hr {
          border: none;
          margin: 1.75rem 0;
          height: 1px;
          background: oklch(from var(--border) l c h / 0.7);
        }
        .deck-prose table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.95rem;
          margin: 1.25rem 0;
        }
        .deck-prose th, .deck-prose td {
          border-bottom: 1px solid oklch(from var(--border) l c h / 0.7);
          padding: 0.55rem 0.75rem;
          text-align: left;
        }
        .deck-prose th {
          font-weight: 500;
          color: var(--muted-foreground);
          font-size: 0.78rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
      `}</style>
    </div>
  )
}
