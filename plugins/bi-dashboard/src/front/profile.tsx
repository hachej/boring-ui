import { Component, type ErrorInfo, type ReactNode } from "react"
import { BarChart3, Gauge, Table2 } from "lucide-react"
import {
  AreaChart,
  BarChart,
  HorizontalBarChart,
  LineChart,
  PieChart,
  RadarChart,
  RadialChart,
  ScatterChart,
} from "@openuidev/react-ui"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@hachej/boring-ui-kit"
import { defineGeneratedPaneProfile } from "@hachej/boring-generated-pane/front"
import { biDashboardVocabulary } from "../shared/schemas"
import { useBiDashboardRenderContext } from "./renderContext"
import { chartPerspectiveFields, perspectiveFiltersForQuery, perspectivePluginForChartType, PerspectiveTable } from "./perspective"

function gridTemplateForColumns(columns: number | undefined): string {
  if (!columns || columns <= 1) return "minmax(0, 1fr)"
  const clamped = Math.max(2, Math.min(5, Math.trunc(columns)))
  return `repeat(${clamped}, minmax(0, 1fr))`
}

const OPENUI_CHART_PALETTE = [
  "var(--chart-1, var(--accent, var(--primary)))",
  "var(--chart-2, oklch(from var(--accent, var(--primary)) calc(l + 0.08) c h))",
  "var(--chart-3, oklch(from var(--accent, var(--primary)) calc(l - 0.08) c h))",
  "var(--chart-4, oklch(from var(--accent, var(--primary)) l calc(c * 0.7) h))",
  "var(--chart-5, var(--primary))",
  "var(--chart-6, oklch(from var(--primary) l c h / 0.72))",
  "var(--chart-7, var(--success, var(--accent, var(--primary))))",
  "var(--chart-8, var(--muted-foreground))",
]

function fallbackRandomUuid(): `${string}-${string}-${string}-${string}-${string}` {
  const bytes = new Uint8Array(16)
  const browserCrypto = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto
  if (typeof browserCrypto?.getRandomValues === "function") {
    browserCrypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function ensureCryptoRandomUuid(): void {
  const target = globalThis as { crypto?: { randomUUID?: () => `${string}-${string}-${string}-${string}-${string}` } }
  if (typeof target.crypto?.randomUUID === "function") return
  try {
    if (target.crypto) {
      Object.defineProperty(target.crypto, "randomUUID", { value: fallbackRandomUuid, configurable: true })
      return
    }
    Object.defineProperty(globalThis, "crypto", { value: { randomUUID: fallbackRandomUuid }, configurable: true })
  } catch {
    // Some locked-down browsers expose an immutable crypto object. In that case
    // the chart error boundary will surface the problem instead of hiding it.
  }
}

ensureCryptoRandomUuid()

function renderInlineMarkdown(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>
    return <span key={index}>{part}</span>
  })
}

function MarkdownBlock({ markdown }: { markdown: string }) {
  const lines = markdown.split(/\r?\n/)
  return (
    <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
      {lines.map((line, index) => {
        const trimmed = line.trim()
        if (!trimmed) return null
        if (trimmed.startsWith("## ")) return <h2 key={index} className="text-base font-semibold tracking-tight text-foreground">{renderInlineMarkdown(trimmed.slice(3))}</h2>
        if (trimmed.startsWith("# ")) return <h1 key={index} className="text-lg font-semibold tracking-tight text-foreground">{renderInlineMarkdown(trimmed.slice(2))}</h1>
        return <p key={index}>{renderInlineMarkdown(trimmed)}</p>
      })}
    </div>
  )
}

function formatMetricValue(value: unknown, format: "number" | "currency" | "percent" | undefined): string {
  const number = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(number)) return value == null ? "—" : String(value)
  if (format === "currency") return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(number)
  if (format === "percent") return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(number)
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(number)
}

function chartRows(rows: Record<string, unknown>[], x: unknown, y: unknown): Array<Record<string, string | number>> {
  const xField = typeof x === "string" && x.length > 0 ? x : "category"
  const yFields = Array.isArray(y)
    ? y.filter((value): value is string => typeof value === "string" && value.length > 0)
    : typeof y === "string" && y.length > 0
      ? [y]
      : []
  return rows.map((row, index) => {
    const output: Record<string, string | number> = { [xField]: row[xField] == null ? String(index + 1) : String(row[xField]) }
    for (const field of yFields) {
      const number = Number(row[field])
      output[field] = Number.isFinite(number) ? number : 0
    }
    return output
  })
}

function firstMeasure(y: unknown): string | undefined {
  return Array.isArray(y) ? y.find((value): value is string => typeof value === "string" && value.length > 0) : typeof y === "string" && y.length > 0 ? y : undefined
}

function scatterDatasets(rows: Record<string, unknown>[], x: unknown, y: unknown, color: unknown): Array<{ name: string; data: Array<{ x: number; y: number; label?: string }> }> {
  const xField = typeof x === "string" && x.length > 0 ? x : undefined
  const yField = firstMeasure(y)
  if (!xField || !yField) return []
  const colorField = typeof color === "string" && color.length > 0 ? color : undefined
  const groups = new Map<string, Array<{ x: number; y: number; label?: string }>>()
  for (const row of rows) {
    const xValue = Number(row[xField])
    const yValue = Number(row[yField])
    if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) continue
    const group = colorField && row[colorField] != null ? String(row[colorField]) : yField
    const data = groups.get(group) ?? []
    data.push({ x: xValue, y: yValue, label: row[colorField ?? xField] == null ? undefined : String(row[colorField ?? xField]) })
    groups.set(group, data)
  }
  return [...groups.entries()].map(([name, data]) => ({ name, data }))
}

class ChartErrorBoundary extends Component<{ chartType: string; children: ReactNode }, { error: string | null }> {
  state = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`[bi-dashboard] ${this.props.chartType} chart render failed`, error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return <div className="flex h-52 items-center justify-center rounded-lg border border-dashed border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{this.props.chartType} chart render failed: {this.state.error}</div>
    }
    return this.props.children
  }
}

function OpenUiDashboardChart({ chartType, rows, x, y, color }: { chartType: string; rows: Record<string, unknown>[]; x: unknown; y: unknown; color?: unknown }) {
  const categoryKey = typeof x === "string" && x.length > 0 ? x : "category"
  const data = chartRows(rows, x, y)
  const dataKey = firstMeasure(y)
  if (data.length === 0 || !dataKey) return <div className="flex h-52 items-center justify-center rounded-lg border border-dashed border-border bg-card text-sm text-muted-foreground">No chart data</div>
  const common = { data, categoryKey, customPalette: OPENUI_CHART_PALETTE, legend: true, grid: true, isAnimationActive: false, height: 300 }
  switch (chartType) {
    case "line":
      return <LineChart {...common} variant="natural" />
    case "area":
      return <AreaChart {...common} variant="natural" />
    case "scatter": {
      const scatterData = scatterDatasets(rows, x, y, color)
      return scatterData.length > 0
        ? <ScatterChart data={scatterData} customPalette={OPENUI_CHART_PALETTE} xAxisDataKey="x" yAxisDataKey="y" xAxisLabel={typeof x === "string" ? x : undefined} yAxisLabel={dataKey} legend grid isAnimationActive={false} height={300} />
        : <div className="flex h-52 items-center justify-center rounded-lg border border-dashed border-border bg-card text-sm text-muted-foreground">Scatter requires numeric x/y fields</div>
    }
    case "radar":
      return <RadarChart {...common} variant="area" />
    case "radial":
      return <RadialChart data={data} categoryKey={categoryKey} dataKey={dataKey} customPalette={OPENUI_CHART_PALETTE} legend grid isAnimationActive={false} height={300} />
    case "pie":
    case "donut":
      return <PieChart data={data} categoryKey={categoryKey} dataKey={dataKey} variant={chartType === "donut" ? "donut" : "pie"} customPalette={OPENUI_CHART_PALETTE} legend isAnimationActive={false} height={300} />
    case "bar":
      return <BarChart {...common} variant="grouped" />
    default:
      return <HorizontalBarChart data={data} categoryKey={categoryKey} customPalette={OPENUI_CHART_PALETTE} legend grid isAnimationActive={false} height={300} />
  }
}

export const biDashboardGeneratedPaneProfile = defineGeneratedPaneProfile({
  vocabulary: biDashboardVocabulary,
  components: {
    DashboardGrid: {
      component: ({ props, children }) => <div className="grid min-w-0 gap-4" style={{ gridTemplateColumns: gridTemplateForColumns(props.columns as number | undefined) }}>{children}</div>,
    },
    BSLMetric: {
      component: ({ props }) => {
        const { queryData } = useBiDashboardRenderContext()
        const queryId = String(props.queryId)
        const valueField = String(props.valueField)
        const data = queryData[queryId]
        const value = data?.rows[0]?.[valueField]
        return (
          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="pb-2">
              <CardDescription className="truncate">{String(props.label)}</CardDescription>
              <CardTitle className="flex min-w-0 items-center gap-2 text-3xl">
                <Gauge className="h-5 w-5 text-muted-foreground" /> {data?.loading ? "…" : formatMetricValue(value, props.format as "number" | "currency" | "percent" | undefined)}
              </CardTitle>
            </CardHeader>
            <CardContent className="break-words text-xs text-muted-foreground">
              {data?.error ? <span className="text-destructive">{data.error}</span> : <>query <code>{queryId}</code> · field <code>{valueField}</code>{data?.source ? <> · {data.source}</> : null}</>}
            </CardContent>
          </Card>
        )
      },
    },
    BSLChart: {
      component: ({ props }) => {
        const { apiBaseUrl, workspaceId, spec, refreshKey, queryData, controllerValues } = useBiDashboardRenderContext()
        const queryId = String(props.queryId)
        const data = queryData[queryId]
        const renderer = String(props.renderer ?? "native")
        const chartType = String(props.chartType)
        const fields = chartPerspectiveFields(props.x, props.y)
        const filters = perspectiveFiltersForQuery(spec, controllerValues, queryId)
        const usePerspective = renderer === "perspective" || ["heatmap", "treemap", "sunburst", "table"].includes(chartType)
        return (
          <Card className="min-w-0 overflow-hidden">
            <CardHeader>
              <CardTitle className="flex min-w-0 items-center gap-2 text-lg"><BarChart3 className="h-4 w-4 shrink-0" /> <span className="truncate">{typeof props.title === "string" ? props.title : queryId}</span></CardTitle>
              <CardDescription className="truncate">{usePerspective ? `Perspective · ${perspectivePluginForChartType(chartType)}` : `OpenUI · ${chartType}`} · query <code>{queryId}</code>{data?.source ? <> · {data.source}</> : null}</CardDescription>
            </CardHeader>
            <CardContent>
              {usePerspective ? (
                <PerspectiveTable
                  apiBaseUrl={apiBaseUrl}
                  workspaceId={workspaceId}
                  queryId={queryId}
                  query={spec.queries[queryId]}
                  plugin={perspectivePluginForChartType(chartType)}
                  columns={fields.columns}
                  groupBy={fields.groupBy}
                  filters={filters}
                  refreshKey={refreshKey}
                />
              ) : data?.loading ? (
                <div className="flex h-52 items-center justify-center rounded-lg border border-dashed border-border bg-card text-sm text-muted-foreground">Loading chart…</div>
              ) : data?.error ? (
                <div className="flex h-52 items-center justify-center rounded-lg border border-dashed border-border bg-card text-sm text-destructive">{data.error}</div>
              ) : (
                <ChartErrorBoundary key={`${queryId}:${chartType}:${String(props.x ?? "")}:${JSON.stringify(props.y ?? "")}`} chartType={chartType}>
                  <OpenUiDashboardChart chartType={chartType} rows={data?.rows ?? []} x={props.x} y={props.y} color={props.color} />
                </ChartErrorBoundary>
              )}
            </CardContent>
          </Card>
        )
      },
    },
    BSLPerspectiveViewer: {
      component: ({ props }) => {
        const { apiBaseUrl, workspaceId, spec, refreshKey, queryData, controllerValues } = useBiDashboardRenderContext()
        const queryId = String(props.queryId)
        const data = queryData[queryId]
        return (
          <Card className="min-w-0 overflow-hidden">
            <CardHeader>
              <CardTitle className="flex min-w-0 items-center gap-2 text-base"><Table2 className="h-4 w-4 shrink-0" /> <span className="truncate">{typeof props.title === "string" ? props.title : queryId}</span></CardTitle>
              <CardDescription className="truncate">Perspective {String(props.plugin ?? "Datagrid")} · query <code>{queryId}</code>{data?.source ? <> · {data.source}</> : null}</CardDescription>
            </CardHeader>
            <CardContent>
              <PerspectiveTable
                apiBaseUrl={apiBaseUrl}
                workspaceId={workspaceId}
                queryId={queryId}
                query={spec.queries[queryId]}
                plugin={props.plugin as string | undefined}
                columns={props.columns as string[] | undefined}
                groupBy={props.groupBy as string[] | undefined}
                splitBy={props.splitBy as string[] | undefined}
                sort={props.sort as Array<[string, "asc" | "desc"]> | undefined}
                filters={perspectiveFiltersForQuery(spec, controllerValues, queryId)}
                refreshKey={refreshKey}
              />
            </CardContent>
          </Card>
        )
      },
    },
    BSLFilter: {
      component: () => null,
    },
    BSLText: {
      component: ({ props }) => <Card className="min-w-0"><CardContent className="p-4"><MarkdownBlock markdown={String(props.markdown)} /></CardContent></Card>,
    },
  },
})
