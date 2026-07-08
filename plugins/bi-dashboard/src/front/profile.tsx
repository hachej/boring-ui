import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from "react"
import { BarChart3, Gauge, Info, Table2 } from "lucide-react"
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
import { chartPerspectiveFields, perspectiveFiltersForQuery, perspectivePluginForChartType, PerspectiveTable, type PerspectiveFilter } from "./perspective"
import type { DashboardQueryResult } from "./dashboardData"

type MetricFormat = "number" | "currency" | "percent"
type FieldLabels = Record<string, string>
type FieldFormats = Record<string, MetricFormat>

const NATIVE_TABLE_RENDER_ROWS = 250
const DASHBOARD_GRID_GAP_PX = 16

function gridTemplateForColumns(columns: number | undefined): string {
  if (!Number.isFinite(columns) || !columns || columns <= 1) return "minmax(0, 1fr)"
  const columnCount = Math.max(2, Math.min(12, Math.trunc(columns)))
  const minTrackWidth = columnCount <= 2 ? 360 : columnCount <= 4 ? 280 : columnCount <= 6 ? 220 : 160
  const totalGap = (columnCount - 1) * DASHBOARD_GRID_GAP_PX
  return `repeat(auto-fit, minmax(min(100%, max(${minTrackWidth}px, calc((100% - ${totalGap}px) / ${columnCount}))), 1fr))`
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

const OPENUI_CHART_THEME_CSS = `
.bi-dashboard-chart :is(.recharts-cartesian-axis-tick-value, .recharts-label, .openui-chart-svg-x-axis-tick, .openui-chart-y-axis-tick, text, tspan) {
  fill: var(--muted-foreground) !important;
  color: var(--muted-foreground) !important;
}
.bi-dashboard-chart :is(.recharts-legend-item-text, .openui-default-legend-label, .openui-chart-legend-item-label) {
  fill: var(--foreground) !important;
  color: var(--foreground) !important;
}
`

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

function WidgetInfo({ description }: { description: unknown }) {
  if (typeof description !== "string" || description.trim().length === 0) return null
  return (
    <span
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      title={description}
      aria-label={description}
    >
      <Info className="h-3.5 w-3.5" strokeWidth={1.75} />
    </span>
  )
}

function humanizeFieldName(field: string): string {
  const cleaned = field.replace(/_label$/u, "").replace(/_/gu, " ").trim()
  if (!cleaned) return field
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

function fieldLabel(field: string, labels?: FieldLabels): string {
  const explicit = labels?.[field]?.trim()
  return explicit && explicit.length > 0 ? explicit : humanizeFieldName(field)
}

function fieldFormat(field: string, formats?: FieldFormats): MetricFormat | undefined {
  return formats?.[field]
}

function formatMetricValue(value: unknown, format: MetricFormat | undefined): string {
  const number = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(number)) return value == null ? "—" : String(value)
  if (format === "currency") return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(number)
  if (format === "percent") return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(number)
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(number)
}

function chartNumber(value: unknown, format: MetricFormat | undefined): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return format === "percent" ? number * 100 : number
}

function filterRows(rows: Record<string, unknown>[], filters: PerspectiveFilter[] | undefined): Record<string, unknown>[] {
  const filtersToApply = filters ?? []
  if (filtersToApply.length === 0) return rows
  return rows.filter((row) => filtersToApply.every(([field, operator, value]) => operator === "==" ? String(row[field] ?? "") === value : true))
}

function chartRows(rows: Record<string, unknown>[], x: unknown, y: unknown, color?: unknown, chartType?: string, labels?: FieldLabels, formats?: FieldFormats): Array<Record<string, string | number>> {
  const xField = typeof x === "string" && x.length > 0 ? x : "category"
  const categoryKey = fieldLabel(xField, labels)
  const yFields = Array.isArray(y)
    ? y.filter((value): value is string => typeof value === "string" && value.length > 0)
    : typeof y === "string" && y.length > 0
      ? [y]
      : []
  const colorField = typeof color === "string" && color.length > 0 ? color : undefined
  const canPivotColorSeries = ["area", "bar", "line", "radar"].includes(String(chartType ?? "").toLowerCase())
  if (canPivotColorSeries && colorField && yFields.length === 1) {
    const measureField = yFields[0]
    const grouped = new Map<string, Record<string, string | number>>()
    const seriesNames = new Set<string>()
    for (const row of rows) {
      const category = row[xField] == null ? String(grouped.size + 1) : String(row[xField])
      const series = row[colorField] == null ? fieldLabel(measureField, labels) : humanizeFieldName(String(row[colorField]))
      seriesNames.add(series)
      const output = grouped.get(category) ?? { [categoryKey]: category }
      output[series] = chartNumber(row[measureField], fieldFormat(measureField, formats))
      grouped.set(category, output)
    }
    return [...grouped.values()].map((row) => {
      for (const series of seriesNames) row[series] ??= 0
      return row
    })
  }
  return rows.map((row, index) => {
    const output: Record<string, string | number> = { [categoryKey]: row[xField] == null ? String(index + 1) : String(row[xField]) }
    for (const field of yFields) {
      output[fieldLabel(field, labels)] = chartNumber(row[field], fieldFormat(field, formats))
    }
    return output
  })
}

function firstMeasure(y: unknown): string | undefined {
  return Array.isArray(y) ? y.find((value): value is string => typeof value === "string" && value.length > 0) : typeof y === "string" && y.length > 0 ? y : undefined
}

function dashboardTableColumns(data: DashboardQueryResult | undefined, requestedColumns: unknown): string[] {
  if (Array.isArray(requestedColumns)) {
    const columns = requestedColumns.filter((value): value is string => typeof value === "string" && value.length > 0)
    if (columns.length > 0) return columns
  }
  return data?.columns.map((column) => column.name) ?? Object.keys(data?.rows[0] ?? {})
}

function formatTableValue(value: unknown, format?: MetricFormat): string {
  if (value == null) return "—"
  if (format) return formatMetricValue(value, format)
  if (typeof value === "number") return Number.isFinite(value) ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value) : String(value)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === "boolean") return value ? "Yes" : "No"
  return String(value)
}

function compareTableValues(left: unknown, right: unknown): number {
  if (left == null && right == null) return 0
  if (left == null) return -1
  if (right == null) return 1
  const leftNumber = Number(left)
  const rightNumber = Number(right)
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" })
}

function tableRows(data: DashboardQueryResult | undefined, filters: PerspectiveFilter[] | undefined, sort: unknown): Record<string, unknown>[] {
  const sortedRows = filterRows(data?.rows ?? [], filters).slice()
  if (Array.isArray(sort)) {
    const sortEntries = sort.filter((entry): entry is [string, "asc" | "desc"] => Array.isArray(entry) && typeof entry[0] === "string" && (entry[1] === "asc" || entry[1] === "desc"))
    sortedRows.sort((left, right) => {
      for (const [field, direction] of sortEntries) {
        const comparison = compareTableValues(left[field], right[field])
        if (comparison !== 0) return direction === "asc" ? comparison : -comparison
      }
      return 0
    })
  }
  return sortedRows
}

function NativeDashboardTable({ data, columns: requestedColumns, filters, sort, fieldLabels, fieldFormats }: { data: DashboardQueryResult | undefined; columns: unknown; filters?: PerspectiveFilter[]; sort?: unknown; fieldLabels?: FieldLabels; fieldFormats?: FieldFormats }) {
  if (!data || data.loading) return <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-border bg-card text-sm text-muted-foreground">Loading table…</div>
  if (data?.error) return <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-border bg-card text-sm text-destructive">{data.error}</div>
  const rows = tableRows(data, filters, sort)
  const visibleRows = rows.slice(0, NATIVE_TABLE_RENDER_ROWS)
  const columns = dashboardTableColumns(data, requestedColumns)
  const numericColumns = new Set(columns.filter((column) => visibleRows.some((row) => typeof row[column] === "number" || (row[column] !== null && row[column] !== "" && Number.isFinite(Number(row[column]))))))
  if (rows.length === 0 || columns.length === 0) return <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-border bg-card text-sm text-muted-foreground">No table data</div>

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border/80">
      <div className="max-h-[18rem] overflow-auto">
        <table className="w-full min-w-max border-collapse text-left text-sm">
          <thead className="sticky top-0 bg-muted/80 text-xs font-medium text-muted-foreground backdrop-blur">
            <tr>
              {columns.map((column) => {
                const isNumeric = numericColumns.has(column)
                return <th key={column} scope="col" className={`border-b border-border px-3 py-2 ${isNumeric ? "text-right tabular-nums" : ""}`}>{fieldLabel(column, fieldLabels)}</th>
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visibleRows.map((row, rowIndex) => (
              <tr key={rowIndex} className="bg-card even:bg-muted/20">
                {columns.map((column) => {
                  const isNumeric = numericColumns.has(column)
                  return <td key={column} className={`whitespace-nowrap px-3 py-2 text-muted-foreground ${isNumeric ? "text-right tabular-nums" : ""}`}>{formatTableValue(row[column], fieldFormat(column, fieldFormats))}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">{visibleRows.length < rows.length ? `Showing ${visibleRows.length.toLocaleString()} of ${rows.length.toLocaleString()} rows` : `${rows.length.toLocaleString()} rows`}</p>
    </div>
  )
}

function scatterDatasets(rows: Record<string, unknown>[], x: unknown, y: unknown, color: unknown, labels?: FieldLabels, formats?: FieldFormats): Array<{ name: string; data: Array<{ x: number; y: number; label?: string }> }> {
  const xField = typeof x === "string" && x.length > 0 ? x : undefined
  const yField = firstMeasure(y)
  if (!xField || !yField) return []
  const colorField = typeof color === "string" && color.length > 0 ? color : undefined
  const groups = new Map<string, Array<{ x: number; y: number; label?: string }>>()
  for (const row of rows) {
    const xValue = chartNumber(row[xField], fieldFormat(xField, formats))
    const yValue = chartNumber(row[yField], fieldFormat(yField, formats))
    if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) continue
    const group = colorField && row[colorField] != null ? humanizeFieldName(String(row[colorField])) : fieldLabel(yField, labels)
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

function explicitAxisLabel(explicit: unknown): string | undefined {
  if (typeof explicit === "string" && explicit.trim().length > 0) return explicit
  return undefined
}

function OpenUiDashboardChart({ chartType, rows, x, y, color, fieldLabels, fieldFormats, xAxisLabel, yAxisLabel }: { chartType: string; rows: Record<string, unknown>[]; x: unknown; y: unknown; color?: unknown; fieldLabels?: FieldLabels; fieldFormats?: FieldFormats; xAxisLabel?: unknown; yAxisLabel?: unknown }) {
  const rawCategoryKey = typeof x === "string" && x.length > 0 ? x : "category"
  const categoryKey = fieldLabel(rawCategoryKey, fieldLabels)
  const data = chartRows(rows, x, y, color, chartType, fieldLabels, fieldFormats)
  const rawDataKey = firstMeasure(y)
  const dataKey = rawDataKey ? fieldLabel(rawDataKey, fieldLabels) : undefined
  if (data.length === 0 || !dataKey) return <div className="flex h-44 items-center justify-center rounded-md border border-dashed border-border bg-card text-sm text-muted-foreground">No chart data</div>
  const common = { data, categoryKey, customPalette: OPENUI_CHART_PALETTE, legend: true, grid: true, isAnimationActive: false, height: 280, xAxisLabel: explicitAxisLabel(xAxisLabel), yAxisLabel: explicitAxisLabel(yAxisLabel) }
  const chartStyle = {
    "--openui-text-neutral-primary": "var(--foreground)",
    "--openui-text-neutral-secondary": "var(--muted-foreground)",
    "--openui-foreground": "var(--foreground)",
    "--openui-background": "var(--background)",
  } as CSSProperties
  const chart = (() => {
    switch (chartType) {
      case "line":
        return <LineChart {...common} variant="natural" />
      case "area":
        return <AreaChart {...common} variant="natural" />
      case "scatter": {
        const scatterData = scatterDatasets(rows, x, y, color, fieldLabels, fieldFormats)
        return scatterData.length > 0
          ? <ScatterChart data={scatterData} customPalette={OPENUI_CHART_PALETTE} xAxisDataKey="x" yAxisDataKey="y" xAxisLabel={explicitAxisLabel(xAxisLabel)} yAxisLabel={explicitAxisLabel(yAxisLabel)} legend grid isAnimationActive={false} height={280} />
          : <div className="flex h-44 items-center justify-center rounded-md border border-dashed border-border bg-card text-sm text-muted-foreground">Scatter requires numeric x/y fields</div>
      }
      case "radar":
        return <RadarChart {...common} variant="area" />
      case "radial":
        return <RadialChart data={data} categoryKey={categoryKey} dataKey={dataKey} customPalette={OPENUI_CHART_PALETTE} legend grid isAnimationActive={false} height={280} />
      case "pie":
      case "donut":
        return <PieChart data={data} categoryKey={categoryKey} dataKey={dataKey} variant={chartType === "donut" ? "donut" : "pie"} customPalette={OPENUI_CHART_PALETTE} legend isAnimationActive={false} height={280} />
      case "bar":
        return <BarChart {...common} variant="grouped" />
      default:
        return <HorizontalBarChart data={data} categoryKey={categoryKey} customPalette={OPENUI_CHART_PALETTE} legend grid isAnimationActive={false} height={280} />
    }
  })()
  return (
    <div className="bi-dashboard-chart min-w-0 text-foreground" style={chartStyle}>
      <style>{OPENUI_CHART_THEME_CSS}</style>
      {chart}
    </div>
  )
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
        const showMeta = props.showMeta === true
        return (
          <Card className="min-w-0 overflow-hidden border-border/70 shadow-sm">
            <CardHeader className="space-y-1.5 px-4 py-3">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <CardDescription className="truncate text-[13px]">{String(props.label)}</CardDescription>
                <WidgetInfo description={props.description} />
              </div>
              <CardTitle className="flex min-w-0 items-baseline gap-2 text-2xl tabular-nums">
                <Gauge className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> {!data || data.loading ? "…" : formatMetricValue(value, props.format as MetricFormat | undefined)}
              </CardTitle>
            </CardHeader>
            {data?.error || showMeta ? (
              <CardContent className="break-words px-4 pb-3 pt-0 text-xs text-muted-foreground">
                {data?.error ? <span className="text-destructive">{data.error}</span> : <>query <code>{queryId}</code> · field <code>{valueField}</code>{data?.source ? <> · {data.source}</> : null}</>}
              </CardContent>
            ) : null}
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
        const filteredRows = filterRows(data?.rows ?? [], filters)
        const usePerspective = renderer === "perspective" || ["heatmap", "treemap", "sunburst", "table"].includes(chartType)
        const showMeta = props.showMeta === true
        return (
          <Card className="min-w-0 overflow-hidden border-border/70 shadow-sm">
            <CardHeader className="space-y-1 px-4 py-3">
              <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                <BarChart3 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{typeof props.title === "string" ? props.title : queryId}</span>
                <WidgetInfo description={props.description} />
              </CardTitle>
              {showMeta ? <CardDescription className="truncate">{usePerspective ? `Perspective · ${perspectivePluginForChartType(chartType)}` : `OpenUI · ${chartType}`} · query <code>{queryId}</code>{data?.source ? <> · {data.source}</> : null}</CardDescription> : null}
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
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
                  showMeta={showMeta}
                />
              ) : !data || data.loading ? (
                <div className="flex h-44 items-center justify-center rounded-md border border-dashed border-border bg-card text-sm text-muted-foreground">Loading chart…</div>
              ) : data?.error ? (
                <div className="flex h-44 items-center justify-center rounded-md border border-dashed border-border bg-card text-sm text-destructive">{data.error}</div>
              ) : (
                <ChartErrorBoundary key={`${queryId}:${chartType}:${String(props.x ?? "")}:${JSON.stringify(props.y ?? "")}`} chartType={chartType}>
                  <OpenUiDashboardChart chartType={chartType} rows={filteredRows} x={props.x} y={props.y} color={props.color} fieldLabels={props.fieldLabels as FieldLabels | undefined} fieldFormats={props.fieldFormats as FieldFormats | undefined} xAxisLabel={props.xAxisLabel} yAxisLabel={props.yAxisLabel} />
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
        const showMeta = props.showMeta === true
        return (
          <Card className="min-w-0 overflow-hidden border-border/70 shadow-sm">
            <CardHeader className="space-y-1 px-4 py-3">
              <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                <Table2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{typeof props.title === "string" ? props.title : queryId}</span>
                <WidgetInfo description={props.description} />
              </CardTitle>
              {showMeta ? <CardDescription className="truncate">Perspective {String(props.plugin ?? "Datagrid")} · query <code>{queryId}</code>{data?.source ? <> · {data.source}</> : null}</CardDescription> : null}
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
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
                showMeta={showMeta}
              />
            </CardContent>
          </Card>
        )
      },
    },
    BSLTable: {
      component: ({ props }) => {
        const { spec, queryData, controllerValues } = useBiDashboardRenderContext()
        const queryId = String(props.queryId)
        const data = queryData[queryId]
        const showMeta = props.showMeta === true
        return (
          <Card className="min-w-0 overflow-hidden border-border/70 shadow-sm">
            <CardHeader className="space-y-1 px-4 py-3">
              <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                <Table2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{typeof props.title === "string" ? props.title : queryId}</span>
                <WidgetInfo description={props.description} />
              </CardTitle>
              {showMeta ? <CardDescription className="truncate">Table · query <code>{queryId}</code>{data?.source ? <> · {data.source}</> : null}</CardDescription> : null}
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <NativeDashboardTable
                data={data}
                columns={props.columns}
                filters={perspectiveFiltersForQuery(spec, controllerValues, queryId)}
                sort={props.sort}
                fieldLabels={props.fieldLabels as FieldLabels | undefined}
                fieldFormats={props.fieldFormats as FieldFormats | undefined}
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
      component: ({ props }) => <Card className="min-w-0 border-border/70 shadow-sm"><CardContent className="p-4"><MarkdownBlock markdown={String(props.markdown)} /></CardContent></Card>,
    },
  },
})
