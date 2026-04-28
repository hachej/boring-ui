import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

interface PanelApi {
  onDidParametersChange(
    cb: (e: { params?: Record<string, unknown> }) => void,
  ): { dispose(): void }
}

interface Observation {
  date: string
  value: number | null
}

interface SeriesMetadata {
  id: string
  title: string
  units?: string | null
  frequency?: string | null
  source?: string | null
  seasonal_adjustment?: string | null
  observation_start?: string | null
  observation_end?: string | null
  observation_count?: number | null
  transform_name?: string | null
  transform_file?: string | null
  notes?: string | null
}

interface SeriesPayload {
  observations: Observation[]
  metadata: SeriesMetadata | null
}

interface ChartParams {
  seriesId?: string
}

interface ChartCanvasPaneProps {
  params?: ChartParams
  panelApi?: PanelApi
}

const SERIES_CACHE = new Map<string, SeriesPayload>()
const SERIES_REQUESTS = new Map<string, Promise<SeriesPayload>>()

const COLORS = [
  "#ff6600", "#3b82f6", "#10b981", "#8b5cf6", "#ef4444",
  "#f59e0b", "#06b6d4", "#ec4899", "#84cc16", "#6366f1",
]

type TabId = "chart" | "table" | "metadata" | "lineage"

async function loadSeries(seriesId: string): Promise<SeriesPayload> {
  const cached = SERIES_CACHE.get(seriesId)
  if (cached) return cached
  let pending = SERIES_REQUESTS.get(seriesId)
  if (!pending) {
    pending = (async () => {
      const res = await fetch(`/api/macro/series/${encodeURIComponent(seriesId)}`)
      if (!res.ok) throw new Error(`series ${seriesId}: ${res.status}`)
      const data = (await res.json()) as SeriesPayload
      SERIES_CACHE.set(seriesId, data)
      return data
    })()
      .finally(() => {
        SERIES_REQUESTS.delete(seriesId)
      })
    SERIES_REQUESTS.set(seriesId, pending)
  }
  return pending
}

function formatValue(v: number | null | undefined): string {
  if (v == null) return "N/A"
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + "M"
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + "K"
  return v.toFixed(2)
}

interface MergedRow {
  date: string
  [key: string]: string | number | null
}

function zScoreNormalize(obs: Observation[]): Observation[] {
  const vals = obs.map((o) => o.value).filter((v): v is number => v != null)
  if (vals.length === 0) return obs
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length
  const std = Math.sqrt(variance) || 1
  return obs.map((o) => ({
    ...o,
    value: o.value != null ? (o.value - mean) / std : null,
  }))
}

interface AxisStrategy {
  mode: "shared" | "dual" | "zscore"
  /** unit → series ids in that group */
  unitGroups: Record<string, string[]>
  /** unit ordering (left axis = first, right axis = second when mode=dual) */
  axisUnits: string[]
}

function computeAxisStrategy(
  primary: { id: string; meta: SeriesMetadata | null },
  overlays: Array<{ id: string; meta: SeriesMetadata | null }>,
): AxisStrategy {
  const unitGroups: Record<string, string[]> = {}
  const all = [primary, ...overlays]
  for (const s of all) {
    const u = s.meta?.units || "Unknown"
    if (!unitGroups[u]) unitGroups[u] = []
    unitGroups[u].push(s.id)
  }
  const axisUnits = Object.keys(unitGroups)
  if (axisUnits.length <= 1) return { mode: "shared", unitGroups, axisUnits }
  if (axisUnits.length === 2) return { mode: "dual", unitGroups, axisUnits }
  return { mode: "zscore", unitGroups, axisUnits }
}

function mergeSeries(
  primary: { id: string; data: Observation[] },
  overlays: Array<{ id: string; data: Observation[] }>,
  mode: AxisStrategy["mode"],
): MergedRow[] {
  const dateMap = new Map<string, MergedRow>()
  const add = (id: string, obs: Observation[]) => {
    const norm = mode === "zscore" ? zScoreNormalize(obs) : obs
    for (const o of norm) {
      let row = dateMap.get(o.date)
      if (!row) {
        row = { date: o.date }
        dateMap.set(o.date, row)
      }
      row[id] = o.value
    }
  }
  add(primary.id, primary.data)
  for (const ov of overlays) add(ov.id, ov.data)
  return [...dateMap.values()].sort((a, b) => a.date.localeCompare(b.date))
}

interface LineagePayload {
  series_id: string
  nodes: Array<{
    series_id: string
    title?: string
    source_type?: string
    transform_name?: string | null
  }>
  edges: Array<{
    from: string
    to: string
    transform_name?: string | null
  }>
}

const LINEAGE_CACHE = new Map<string, LineagePayload | null>()

async function loadLineage(seriesId: string): Promise<LineagePayload | null> {
  if (LINEAGE_CACHE.has(seriesId)) return LINEAGE_CACHE.get(seriesId) ?? null
  const res = await fetch(`/api/macro/series/${encodeURIComponent(seriesId)}/lineage`)
  if (!res.ok) {
    LINEAGE_CACHE.set(seriesId, null)
    return null
  }
  const data = (await res.json()) as LineagePayload
  LINEAGE_CACHE.set(seriesId, data)
  return data
}

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "chart", label: "Chart" },
  { id: "table", label: "Table" },
  { id: "metadata", label: "Metadata" },
  { id: "lineage", label: "Lineage" },
]

export function ChartCanvasPane({ params: initial, panelApi }: ChartCanvasPaneProps) {
  const [params, setParams] = useState<ChartParams>(initial ?? {})
  const seriesId = params.seriesId

  const [primary, setPrimary] = useState<SeriesPayload | null>(null)
  const [overlays, setOverlays] = useState<Array<{ id: string; payload: SeriesPayload }>>([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>("chart")
  const [zoomRange, setZoomRange] = useState<{ start: string; end: string } | null>(null)
  const [zoomStart, setZoomStart] = useState<string | null>(null)
  const [zoomEnd, setZoomEnd] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!panelApi) return
    const sub = panelApi.onDidParametersChange((e) => {
      const next = (e.params ?? {}) as ChartParams
      setParams({ ...next })
    })
    return () => sub.dispose()
  }, [panelApi])

  useEffect(() => {
    if (!seriesId) {
      setPrimary(null)
      return
    }
    let cancelled = false
    setLoading(true)
    loadSeries(seriesId)
      .then((p) => {
        if (!cancelled) setPrimary(p)
      })
      .catch((err) => console.error("series fetch failed", err))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [seriesId])

  useEffect(() => {
    setOverlays([])
    setZoomRange(null)
  }, [seriesId])

  const addOverlay = useCallback(
    (overlayId: string) => {
      if (!overlayId || overlayId === seriesId) return
      loadSeries(overlayId)
        .then((p) => {
          setOverlays((prev) =>
            prev.some((o) => o.id === overlayId) ? prev : [...prev, { id: overlayId, payload: p }],
          )
        })
        .catch((err) => console.error("overlay fetch failed", err))
    },
    [seriesId],
  )

  const removeOverlay = useCallback((overlayId: string) => {
    setOverlays((prev) => prev.filter((o) => o.id !== overlayId))
  }, [])

  const isSeriesDrag = (dt: DataTransfer | null): boolean =>
    !!dt && Array.from(dt.types).includes("text/series-id")

  const handleDragOver = (e: React.DragEvent) => {
    if (!isSeriesDrag(e.dataTransfer)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
    setDragOver(true)
  }
  const handleDragLeave = () => setDragOver(false)
  const handleDrop = (e: React.DragEvent) => {
    if (!isSeriesDrag(e.dataTransfer)) return
    e.preventDefault()
    setDragOver(false)
    const id = e.dataTransfer.getData("text/series-id").trim()
    if (id) addOverlay(id)
  }

  const axisStrategy = useMemo<AxisStrategy>(() => {
    if (!seriesId) return { mode: "shared", unitGroups: {}, axisUnits: [] }
    return computeAxisStrategy(
      { id: seriesId, meta: primary?.metadata ?? null },
      overlays.map((o) => ({ id: o.id, meta: o.payload.metadata })),
    )
  }, [seriesId, primary, overlays])

  const merged = useMemo<MergedRow[]>(() => {
    if (!primary || !seriesId) return []
    return mergeSeries(
      { id: seriesId, data: primary.observations },
      overlays.map((o) => ({ id: o.id, data: o.payload.observations })),
      axisStrategy.mode,
    )
  }, [primary, overlays, seriesId, axisStrategy.mode])

  const visibleData = useMemo<MergedRow[]>(() => {
    if (!zoomRange) return merged
    return merged.filter((row) => row.date >= zoomRange.start && row.date <= zoomRange.end)
  }, [merged, zoomRange])

  if (!seriesId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Drop a series here, or click one in the Data tab.
      </div>
    )
  }

  const allIds = [seriesId, ...overlays.map((o) => o.id)]
  const colorFor = (id: string) => COLORS[allIds.indexOf(id) % COLORS.length]

  // Map each series id to its yAxisId for dual-axis mode.
  const axisIdFor = (id: string): string | undefined => {
    if (axisStrategy.mode !== "dual") return undefined
    const u = primary?.metadata?.units && id === seriesId
      ? primary.metadata.units
      : overlays.find((o) => o.id === id)?.payload.metadata?.units
    if (u == null) return "left"
    return axisStrategy.axisUnits[0] === u ? "left" : "right"
  }

  const modeHint =
    axisStrategy.mode === "dual"
      ? "Dual axis"
      : axisStrategy.mode === "zscore"
        ? "Z-score normalized"
        : null

  return (
    <div
      ref={containerRef}
      className={`flex h-full flex-col ${dragOver ? "ring-2 ring-orange-500" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="flex min-w-0 flex-col">
          <h2 className="truncate text-sm font-semibold">{primary?.metadata?.title ?? seriesId}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {seriesId}
            {primary?.metadata?.units ? ` · ${primary.metadata.units}` : ""}
            {primary?.metadata?.frequency ? ` · ${primary.metadata.frequency}` : ""}
            {modeHint && overlays.length > 0 ? ` · ${modeHint}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {activeTab === "chart" && zoomRange && (
            <button
              type="button"
              onClick={() => setZoomRange(null)}
              className="text-xs text-orange-600 hover:underline"
            >
              Reset zoom
            </button>
          )}
          <div className="flex items-center gap-0.5 rounded border border-border bg-muted/50 p-0.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`rounded px-2 py-0.5 text-xs ${
                  activeTab === t.id
                    ? "bg-background font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {overlays.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-border px-3 py-1.5">
          {overlays.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => removeOverlay(o.id)}
              className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs hover:bg-muted/70"
              style={{ color: colorFor(o.id) }}
            >
              <span>{o.id}</span>
              <span className="text-muted-foreground">×</span>
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {loading && !primary ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
        ) : activeTab === "chart" ? (
          <div className="h-full px-2 pb-2 pt-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={visibleData}
                onMouseDown={(e) => {
                  const lbl = e?.activeLabel as string | undefined
                  if (!lbl) return
                  setZoomStart(lbl)
                  setZoomEnd(lbl)
                }}
                onMouseMove={(e) => {
                  if (!zoomStart) return
                  const lbl = e?.activeLabel as string | undefined
                  if (!lbl) return
                  setZoomEnd(lbl)
                }}
                onMouseUp={() => {
                  if (!zoomStart || !zoomEnd) {
                    setZoomStart(null)
                    setZoomEnd(null)
                    return
                  }
                  const start = zoomStart <= zoomEnd ? zoomStart : zoomEnd
                  const end = zoomStart <= zoomEnd ? zoomEnd : zoomStart
                  if (start !== end) setZoomRange({ start, end })
                  setZoomStart(null)
                  setZoomEnd(null)
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                {axisStrategy.mode === "dual" ? (
                  <>
                    <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickFormatter={formatValue} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickFormatter={formatValue} />
                  </>
                ) : (
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={formatValue} />
                )}
                <Tooltip formatter={(v) => formatValue(Number(v))} />
                {allIds.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
                {allIds.map((id) => {
                  const axisId = axisIdFor(id)
                  const axisProps = axisId ? { yAxisId: axisId } : {}
                  return (
                    <Line
                      key={id}
                      type="monotone"
                      dataKey={id}
                      stroke={colorFor(id)}
                      {...axisProps}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls
                    />
                  )
                })}
                {zoomStart && zoomEnd && zoomStart !== zoomEnd && (
                  <ReferenceArea x1={zoomStart} x2={zoomEnd} fill="#ff660033" />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : activeTab === "table" ? (
          <TableTab rows={visibleData} ids={allIds} colorFor={colorFor} />
        ) : activeTab === "metadata" ? (
          <MetadataTab primary={primary?.metadata ?? null} overlays={overlays} />
        ) : (
          <LineageTab seriesId={seriesId} />
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Table tab
// ──────────────────────────────────────────────────────────────────────────

function TableTab({
  rows,
  ids,
  colorFor,
}: {
  rows: MergedRow[]
  ids: string[]
  colorFor: (id: string) => string
}) {
  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-xs tabular-nums">
        <thead className="sticky top-0 bg-background">
          <tr className="border-b border-border">
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Date</th>
            {ids.map((id) => (
              <th
                key={id}
                className="px-3 py-2 text-right font-medium"
                style={{ color: colorFor(id) }}
              >
                {id}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={1 + ids.length} className="px-3 py-4 text-center text-muted-foreground">
                No observations.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.date as string} className="border-b border-border/40 hover:bg-muted/30">
                <td className="px-3 py-1 text-left font-mono">{row.date}</td>
                {ids.map((id) => {
                  const v = row[id]
                  return (
                    <td key={id} className="px-3 py-1 text-right">
                      {typeof v === "number" ? v.toFixed(4) : "—"}
                    </td>
                  )
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Metadata tab
// ──────────────────────────────────────────────────────────────────────────

const META_FIELDS: Array<[keyof SeriesMetadata, string]> = [
  ["id", "Series ID"],
  ["title", "Title"],
  ["source", "Source"],
  ["frequency", "Frequency"],
  ["units", "Units"],
  ["seasonal_adjustment", "Seasonal Adjustment"],
  ["observation_start", "Start Date"],
  ["observation_end", "End Date"],
  ["observation_count", "Observations"],
  ["transform_name", "Transform"],
  ["transform_file", "Transform File"],
  ["notes", "Notes"],
]

function MetadataRow({ meta }: { meta: SeriesMetadata }) {
  return (
    <dl className="grid grid-cols-[160px_1fr] gap-y-1 text-xs">
      {META_FIELDS.map(([key, label]) => {
        const v = meta[key]
        if (v == null || v === "") return null
        return (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-words">{String(v)}</dd>
          </div>
        )
      })}
    </dl>
  )
}

function MetadataTab({
  primary,
  overlays,
}: {
  primary: SeriesMetadata | null
  overlays: Array<{ id: string; payload: SeriesPayload }>
}) {
  return (
    <div className="h-full overflow-auto px-4 py-3 space-y-4">
      {primary ? (
        <section>
          <h3 className="mb-2 text-sm font-semibold">{primary.id}</h3>
          <MetadataRow meta={primary} />
        </section>
      ) : (
        <p className="text-xs text-muted-foreground">No metadata.</p>
      )}
      {overlays.map((o) =>
        o.payload.metadata ? (
          <section key={o.id} className="border-t border-border pt-3">
            <h3 className="mb-2 text-sm font-semibold">Overlay · {o.id}</h3>
            <MetadataRow meta={o.payload.metadata} />
          </section>
        ) : null,
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Lineage tab
// ──────────────────────────────────────────────────────────────────────────

function LineageTab({ seriesId }: { seriesId: string }) {
  const [data, setData] = useState<LineagePayload | null | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    setData(undefined)
    loadLineage(seriesId).then((d) => {
      if (!cancelled) setData(d)
    })
    return () => {
      cancelled = true
    }
  }, [seriesId])

  const openSeriesPane = useCallback((targetId: string) => {
    if (!targetId || targetId === seriesId) return
    // Same bridge route the agent's open_series tool uses — works for any
    // child of ChatCenteredShell because the workspace SSE poller picks
    // it up and dispatches surface.openPanel.
    void fetch("/api/v1/ui/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "openPanel",
        params: {
          id: `chart:${targetId}`,
          component: "chart-canvas",
          params: { seriesId: targetId },
        },
      }),
    })
  }, [seriesId])

  if (data === undefined) {
    return <div className="p-4 text-xs text-muted-foreground">Loading lineage…</div>
  }
  if (data === null) {
    return <div className="p-4 text-xs text-muted-foreground">No lineage data.</div>
  }

  const upstream = data.edges.filter((e) => e.to === seriesId)
  const downstream = data.edges.filter((e) => e.from === seriesId)
  const nodeFor = (id: string) => data.nodes.find((n) => n.series_id === id)

  const Pill = ({ id }: { id: string }) => {
    const n = nodeFor(id)
    return (
      <button
        type="button"
        onClick={() => openSeriesPane(id)}
        className="inline-flex max-w-full items-center gap-1.5 rounded border border-border px-2 py-1 text-xs hover:bg-muted/50"
      >
        <span className="font-mono">{id}</span>
        {n?.title && <span className="truncate text-muted-foreground">{n.title}</span>}
      </button>
    )
  }

  return (
    <div className="h-full overflow-auto px-4 py-3 space-y-4 text-xs">
      <section>
        <h3 className="mb-2 text-sm font-semibold">Upstream sources</h3>
        {upstream.length === 0 ? (
          <p className="text-muted-foreground">— (root series)</p>
        ) : (
          <ul className="space-y-1">
            {upstream.map((e) => (
              <li key={`${e.from}->${e.to}`} className="flex items-center gap-2">
                <Pill id={e.from} />
                {e.transform_name && (
                  <span className="text-muted-foreground">via {e.transform_name}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Downstream derived</h3>
        {downstream.length === 0 ? (
          <p className="text-muted-foreground">— (no derived series)</p>
        ) : (
          <ul className="space-y-1">
            {downstream.map((e) => (
              <li key={`${e.from}->${e.to}`} className="flex items-center gap-2">
                <Pill id={e.to} />
                {e.transform_name && (
                  <span className="text-muted-foreground">via {e.transform_name}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
