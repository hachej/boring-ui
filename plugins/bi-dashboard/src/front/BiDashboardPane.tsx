import { useEffect, useMemo, useState } from "react"
import { BarChart3, Database, ExternalLink, Gauge, RefreshCcw, SlidersHorizontal, Table2 } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  IconButton,
  Toolbar,
  ToolbarGroup,
} from "@hachej/boring-ui-kit"
import { useApiBaseUrl, useWorkspaceRequestId } from "@hachej/boring-workspace"
import type { PaneProps } from "@hachej/boring-workspace/plugin"
import { defineGeneratedPaneProfile, GeneratedPaneRenderer } from "@hachej/boring-generated-pane/front"
import { parseDashboardSpec } from "../shared"
import type { BslDashboardSpec } from "../shared"
import { sampleBiDashboardSpec } from "./sampleSpec"
import { useDashboardQueryData, type DashboardQueryResult } from "./dashboardData"
import {
  bslChartPropsSchema,
  bslFilterPropsSchema,
  bslMetricPropsSchema,
  bslPerspectiveViewerPropsSchema,
  bslTextPropsSchema,
  dashboardGridPropsSchema,
} from "../shared/schemas"

export interface BiDashboardPaneParams {
  path?: string
  spec?: BslDashboardSpec
}

interface LoadedDashboardFile {
  spec: unknown
  error?: string
  loading: boolean
}

export function BiDashboardPane({ params }: PaneProps<BiDashboardPaneParams>) {
  const apiBaseUrl = useApiBaseUrl()
  const workspaceId = useWorkspaceRequestId()
  const [loadedFile, setLoadedFile] = useState<LoadedDashboardFile>({ spec: null, loading: false })
  const [controllerValues, setControllerValues] = useState<Record<string, string>>({})
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!params?.path || params.spec) {
      setLoadedFile({ spec: null, loading: false })
      return
    }

    const controller = new AbortController()
    setLoadedFile({ spec: null, loading: true })
    void fetch(`${apiBaseUrl}/api/v1/files/raw?path=${encodeURIComponent(params.path)}`, {
      signal: controller.signal,
      credentials: "include",
      headers: workspaceId ? { "x-boring-workspace-id": workspaceId } : {},
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Failed to load ${params.path}: HTTP ${response.status}`)
        return await response.text()
      })
      .then((text) => {
        try {
          setLoadedFile({ spec: JSON.parse(text), loading: false })
        } catch (error) {
          setLoadedFile({
            spec: null,
            loading: false,
            error: error instanceof Error ? error.message : "Dashboard file is not valid JSON",
          })
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setLoadedFile({
          spec: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        })
      })

    return () => controller.abort()
  }, [apiBaseUrl, params?.path, params?.spec, refreshKey, workspaceId])

  const rawSpec = loadedFile.loading || loadedFile.error ? null : (params?.spec ?? loadedFile.spec ?? sampleBiDashboardSpec)
  const parsed = rawSpec ? parseDashboardSpec(rawSpec) : { spec: null, errors: [] }
  const spec = useMemo(() => parsed.spec ? applyControllerFilters(parsed.spec, controllerValues) : null, [controllerValues, parsed.spec])
  const queryData = useDashboardQueryData(spec, apiBaseUrl, workspaceId ?? undefined)

  if (loadedFile.loading) {
    return (
      <div className="flex h-full min-h-0 min-w-0 items-center justify-center bg-background p-6 text-foreground">
        <EmptyState title="Loading BI dashboard" description={params?.path} />
      </div>
    )
  }

  if (loadedFile.error) {
    return (
      <div className="flex h-full min-h-0 min-w-0 items-center justify-center bg-background p-6 text-foreground">
        <EmptyState title="Could not load BI dashboard" description={loadedFile.error} />
      </div>
    )
  }

  if (!parsed.spec) {
    return (
      <div className="flex h-full min-h-0 min-w-0 items-center justify-center bg-background p-6 text-foreground">
        <EmptyState
          title="Invalid BI dashboard spec"
          description={parsed.errors.slice(0, 5).join(" • ")}
        />
      </div>
    )
  }

  if (!spec) {
    return (
      <div className="flex h-full min-h-0 min-w-0 items-center justify-center bg-background p-6 text-foreground">
        <EmptyState title="Invalid BI dashboard spec" description="Dashboard could not be prepared" />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground">
      <Toolbar className="border-b border-border bg-background/95 px-3 py-2">
        <ToolbarGroup>
          <span className="text-xs font-medium text-muted-foreground">BI dashboard</span>
        </ToolbarGroup>
        <ToolbarGroup className="ml-auto">
          <IconButton
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setRefreshKey((value) => value + 1)}
            aria-label="Refresh dashboard"
            title="Refresh dashboard"
            disabled={!params?.path || loadedFile.loading}
          >
            <RefreshCcw className={`h-3.5 w-3.5 ${loadedFile.loading ? "animate-spin" : ""}`} strokeWidth={1.75} />
          </IconButton>
          {params?.path ? (
            <IconButton
              asChild
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
              aria-label="Open raw dashboard in new tab"
              title="Open raw dashboard in new tab"
            >
              <a href={`${apiBaseUrl}/api/v1/files/raw?path=${encodeURIComponent(params.path)}`} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
              </a>
            </IconButton>
          ) : null}
        </ToolbarGroup>
      </Toolbar>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-background p-4">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight">{spec.title}</h1>
          {spec.description ? <p className="mt-1 text-sm text-muted-foreground">{spec.description}</p> : null}
        </div>

        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-4">
            <GeneratedPaneRenderer spec={spec} profile={createBiDashboardPaneProfile(queryData, controllerValues, setControllerValues)} />
          </div>
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Database className="h-4 w-4" /> Query manifest
              </CardTitle>
              <CardDescription>
                The agent should generate this neutral BSL dashboard contract; the plugin maps it to BSL, ECharts, and Perspective runtime calls.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="max-h-[520px] overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                {JSON.stringify({ queries: spec.queries }, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function gridColumnsClass(columns: number | undefined): string {
  switch (columns) {
    case 1:
      return "grid-cols-1"
    case 2:
      return "lg:grid-cols-2"
    case 3:
      return "lg:grid-cols-3"
    case 4:
      return "lg:grid-cols-4"
    case 6:
      return "lg:grid-cols-6"
    case 12:
      return "lg:grid-cols-2 xl:grid-cols-4"
    default:
      return "lg:grid-cols-2"
  }
}

function formatMetricValue(value: unknown, format: "number" | "currency" | "percent" | undefined): string {
  const number = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(number)) return value == null ? "—" : String(value)
  if (format === "currency") return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(number)
  if (format === "percent") return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(number)
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(number)
}

function applyControllerFilters(spec: BslDashboardSpec, controllerValues: Record<string, string>): BslDashboardSpec {
  const elements = Object.values(spec.elements)
  const filtersByQuery = new Map<string, Array<{ field: string; value: string }>>()
  for (const element of elements) {
    if (element.type !== "BSLFilter") continue
    const props = element.props as Record<string, unknown> | undefined
    const id = typeof props?.id === "string" ? props.id : undefined
    const field = typeof props?.field === "string" ? props.field : undefined
    const value = id ? controllerValues[id] : undefined
    if (!id || !field || !value || value === "__all") continue
    const targets = Array.isArray(props?.targetQueries) ? props.targetQueries.filter((item): item is string => typeof item === "string") : []
    for (const queryId of targets) {
      const existing = filtersByQuery.get(queryId) ?? []
      existing.push({ field, value })
      filtersByQuery.set(queryId, existing)
    }
  }
  if (filtersByQuery.size === 0) return spec
  return {
    ...spec,
    queries: Object.fromEntries(Object.entries(spec.queries).map(([queryId, query]) => {
      const filters = filtersByQuery.get(queryId)
      if (!filters?.length) return [queryId, query]
      return [queryId, {
        ...query,
        filters: [
          ...(query.filters ?? []),
          ...filters.map((filter) => ({ field: filter.field, op: "eq" as const, value: filter.value })),
        ],
      }]
    })),
  }
}

function ChartPreview({ data, x, y, chartType }: { data?: DashboardQueryResult; x?: string; y?: string | string[]; chartType: string }) {
  if (!data) return <Placeholder text="No live data source configured yet" />
  if (data.loading) return <Placeholder text="Loading data…" />
  if (data.error) return <Placeholder text={data.error} destructive />
  const yField = Array.isArray(y) ? y[0] : y
  if (!x || !yField || data.rows.length === 0) return <Placeholder text="No chartable rows" />
  const values = data.rows.map((row) => Number(row[yField])).filter(Number.isFinite)
  const max = Math.max(1, ...values)
  return (
    <div className="h-56 rounded-lg border border-border bg-card p-3 text-foreground">
      <svg viewBox="0 0 640 210" className="h-full w-full overflow-visible" role="img" aria-label={`${chartType} chart`}> 
        {data.rows.map((row, index) => {
          const value = Number(row[yField])
          const label = String(row[x] ?? index + 1)
          const width = 560 / Math.max(1, data.rows.length)
          const height = Number.isFinite(value) ? Math.max(3, (value / max) * 150) : 3
          const left = 55 + index * width
          if (chartType === "line" || chartType === "area") return null
          return (
            <g key={index}>
              <rect x={left} y={165 - height} width={Math.max(8, width - 8)} height={height} rx="4" fill="var(--boring-primary, var(--primary))" opacity="0.9" />
              <text x={left + width / 2} y="190" textAnchor="middle" className="fill-current text-[10px] text-muted-foreground">{label.slice(0, 10)}</text>
            </g>
          )
        })}
        {(chartType === "line" || chartType === "area") && (
          <polyline
            fill="none"
            stroke="var(--boring-primary, var(--primary))"
            strokeWidth="3"
            points={data.rows.map((row, index) => {
              const value = Number(row[yField])
              const xPos = 65 + index * (540 / Math.max(1, data.rows.length - 1))
              const yPos = 165 - ((Number.isFinite(value) ? value : 0) / max) * 150
              return `${xPos},${yPos}`
            }).join(" ")}
          />
        )}
      </svg>
    </div>
  )
}

function DataTable({ data, columns }: { data?: DashboardQueryResult; columns?: string[] }) {
  if (!data) return <Placeholder text="No live data source configured yet" />
  if (data.loading) return <Placeholder text="Loading data…" />
  if (data.error) return <Placeholder text={data.error} destructive />
  const visibleColumns = columns?.length ? columns : data.columns.map((column) => column.name)
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-muted">
          <tr>{visibleColumns.map((column) => <th key={column} className="border-b border-border px-2 py-1.5 text-left font-medium">{column}</th>)}</tr>
        </thead>
        <tbody>
          {data.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="odd:bg-muted/20">
              {visibleColumns.map((column) => <td key={column} className="border-b border-border/50 px-2 py-1.5 text-muted-foreground">{String(row[column] ?? "")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Placeholder({ text, destructive }: { text: string; destructive?: boolean }) {
  return <div className={`flex h-52 items-center justify-center rounded-lg border border-dashed border-border bg-card text-sm ${destructive ? "text-destructive" : "text-muted-foreground"}`}>{text}</div>
}

function createBiDashboardPaneProfile(
  queryData: Record<string, DashboardQueryResult>,
  controllerValues: Record<string, string>,
  setControllerValues: (updater: (previous: Record<string, string>) => Record<string, string>) => void,
) {
  return defineGeneratedPaneProfile({
    id: "bi-dashboard",
    label: "BI Dashboard",
    components: {
      DashboardGrid: {
        description: "Responsive dashboard grid for chart, table, metric, filter, and text widgets.",
        slots: ["default"],
        props: dashboardGridPropsSchema,
        component: ({ props, children }) => <div className={`grid min-w-0 gap-4 ${gridColumnsClass(props.columns as number | undefined)}`}>{children}</div>,
      },
      BSLMetric: {
        description: "Metric card bound to a BI query result field.",
        props: bslMetricPropsSchema,
        component: ({ props }) => {
          const queryId = String(props.queryId)
          const valueField = String(props.valueField)
          const data = queryData[queryId]
          const value = data?.rows[0]?.[valueField]
          return (
            <Card className="min-w-0">
              <CardHeader className="pb-2">
                <CardDescription>{String(props.label)}</CardDescription>
                <CardTitle className="flex items-center gap-2 text-3xl">
                  <Gauge className="h-5 w-5 text-muted-foreground" /> {data?.loading ? "…" : formatMetricValue(value, props.format as "number" | "currency" | "percent" | undefined)}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {data?.error ? <span className="text-destructive">{data.error}</span> : <>query <code>{queryId}</code> · field <code>{valueField}</code>{data?.source ? <> · {data.source}</> : null}</>}
              </CardContent>
            </Card>
          )
        },
      },
      BSLChart: {
        description: "Chart preview bound to a BI query result.",
        props: bslChartPropsSchema,
        component: ({ props }) => {
          const queryId = String(props.queryId)
          const data = queryData[queryId]
          return (
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="h-4 w-4" /> {typeof props.title === "string" ? props.title : queryId}</CardTitle>
                <CardDescription>{String(props.renderer ?? "echarts")} · {String(props.chartType)} · query <code>{queryId}</code>{data?.source ? <> · {data.source}</> : null}</CardDescription>
              </CardHeader>
              <CardContent><ChartPreview data={data} x={props.x as string | undefined} y={props.y as string | string[] | undefined} chartType={String(props.chartType)} /></CardContent>
            </Card>
          )
        },
      },
      BSLPerspectiveViewer: {
        description: "Table/Perspective-style viewer bound to a BI query result.",
        props: bslPerspectiveViewerPropsSchema,
        component: ({ props }) => {
          const queryId = String(props.queryId)
          const data = queryData[queryId]
          return (
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Table2 className="h-4 w-4" /> {typeof props.title === "string" ? props.title : queryId}</CardTitle>
                <CardDescription>Perspective {String(props.plugin ?? "Datagrid")} · query <code>{queryId}</code>{data?.source ? <> · {data.source}</> : null}</CardDescription>
              </CardHeader>
              <CardContent><DataTable data={data} columns={props.columns as string[] | undefined} /></CardContent>
            </Card>
          )
        },
      },
      BSLFilter: {
        description: "Dashboard filter control placeholder for target queries.",
        props: bslFilterPropsSchema,
        component: ({ props }) => {
          const id = String(props.id)
          const field = String(props.field)
          const targets = props.targetQueries as string[]
          const options = [...new Set(targets.flatMap((queryId) => queryData[queryId]?.rows.map((row) => row[field]).filter((value) => value != null).map(String) ?? []))].sort((a, b) => a.localeCompare(b))
          return (
            <Card className="min-w-0 border-primary/25 bg-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><SlidersHorizontal className="h-4 w-4 text-primary" /> {String(props.label ?? props.field)}</CardTitle>
                <CardDescription>{String(props.controlType)} controller · targets {targets.join(", ")}</CardDescription>
              </CardHeader>
              <CardContent>
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none focus:ring-2 focus:ring-ring/40"
                  value={controllerValues[id] ?? "__all"}
                  onChange={(event) => setControllerValues((previous) => ({ ...previous, [id]: event.target.value }))}
                >
                  <option value="__all">All {field}</option>
                  {options.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </CardContent>
            </Card>
          )
        },
      },
      BSLText: {
        description: "Text/markdown explanation block for dashboard context.",
        props: bslTextPropsSchema,
        component: ({ props }) => <Card className="min-w-0"><CardContent className="p-4 text-sm text-muted-foreground">{String(props.markdown)}</CardContent></Card>,
      },
    },
  })
}
