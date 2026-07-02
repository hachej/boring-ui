import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react"
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
  applyBoringPerspectiveTheme,
  boringPerspectiveThemeName,
} from "@hachej/boring-ui-kit"
import { useApiBaseUrl, useWorkspaceRequestId } from "@hachej/boring-workspace"
import type { PaneProps } from "@hachej/boring-workspace/plugin"
import { defineGeneratedPaneProfile, GeneratedPaneRenderer } from "@hachej/boring-generated-pane/front"
import { parseDashboardSpec } from "../shared"
import type { BslDashboardSpec } from "../shared"
import { sampleBiDashboardSpec } from "./sampleSpec"
import { fetchArrowDataBridgeQuery, useDashboardQueryData, type DashboardArrowQueryResult, type DashboardQueryResult } from "./dashboardData"
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
  const parsed = useMemo(() => rawSpec ? parseDashboardSpec(rawSpec) : { spec: null, errors: [] }, [rawSpec])
  const parsedSpec = parsed.spec ?? null
  const queryData = useDashboardQueryData(parsedSpec, apiBaseUrl, workspaceId ?? undefined, refreshKey, jsonQueryIdsForDashboard(parsedSpec))

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

  if (!parsedSpec) {
    return (
      <div className="flex h-full min-h-0 min-w-0 items-center justify-center bg-background p-6 text-foreground">
        <EmptyState
          title="Invalid BI dashboard spec"
          description={parsed.errors.slice(0, 5).join(" • ")}
        />
      </div>
    )
  }

  const spec = parsedSpec

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
            disabled={loadedFile.loading}
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

        <div className="min-w-0 space-y-4">
          <DashboardFiltersBar spec={spec} queryData={queryData} controllerValues={controllerValues} setControllerValues={setControllerValues} />
          <BiDashboardRenderContext.Provider value={{ apiBaseUrl, workspaceId: workspaceId ?? undefined, spec, refreshKey, queryData, controllerValues, setControllerValues }}>
            <GeneratedPaneRenderer spec={spec} profile={biDashboardPaneProfile} />
          </BiDashboardRenderContext.Provider>
          <details className="group rounded-xl border border-border bg-card">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-foreground marker:hidden">
              <Database className="h-4 w-4" /> Query manifest
              <span className="ml-auto text-xs text-muted-foreground">debug</span>
            </summary>
            <div className="border-t border-border px-4 py-3">
              <p className="mb-3 text-sm text-muted-foreground">
                The agent should generate this neutral BSL dashboard contract; the plugin maps it to BSL, ECharts, and Perspective runtime calls.
              </p>
              <pre className="max-h-[420px] overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                {JSON.stringify({ queries: spec.queries }, null, 2)}
              </pre>
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}

function gridTemplateForColumns(columns: number | undefined): string {
  if (columns === 1) return "minmax(0, 1fr)"
  const minWidth = columns && columns >= 6 ? "320px" : "360px"
  return `repeat(auto-fit, minmax(min(100%, ${minWidth}), 1fr))`
}

function formatMetricValue(value: unknown, format: "number" | "currency" | "percent" | undefined): string {
  const number = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(number)) return value == null ? "—" : String(value)
  if (format === "currency") return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(number)
  if (format === "percent") return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(number)
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(number)
}

type PerspectiveFilter = [string, "==", string]

function perspectiveFiltersForQuery(spec: BslDashboardSpec, controllerValues: Record<string, string>, queryId: string): PerspectiveFilter[] {
  const filters: PerspectiveFilter[] = []
  for (const element of Object.values(spec.elements)) {
    if (element.type !== "BSLFilter") continue
    const id = String(element.props.id ?? "")
    const value = controllerValues[id]
    if (!id || !value || value === "__all") continue
    const field = String(element.props.field ?? "")
    const targets = Array.isArray(element.props.targetQueries) ? element.props.targetQueries.map(String) : []
    if (!field || !targets.includes(queryId)) continue
    filters.push([field, "==", value])
  }
  return filters
}

function perspectivePluginForChartType(chartType: string): string {
  switch (chartType.toLowerCase()) {
    case "bar":
      return "Y Bar"
    case "line":
      return "Y Line"
    case "area":
      return "Y Area"
    case "scatter":
      return "Y Scatter"
    case "heatmap":
      return "Heatmap"
    case "treemap":
      return "Treemap"
    case "sunburst":
      return "Sunburst"
    case "table":
      return "Datagrid"
    default:
      return "Y Bar"
  }
}

function chartPerspectiveFields(x?: unknown, y?: unknown): { columns?: string[]; groupBy?: string[] } {
  const xField = typeof x === "string" && x.length > 0 ? x : undefined
  const yFields = Array.isArray(y)
    ? y.filter((value): value is string => typeof value === "string" && value.length > 0)
    : typeof y === "string" && y.length > 0
      ? [y]
      : []
  return {
    columns: [...(xField ? [xField] : []), ...yFields],
    groupBy: xField ? [xField] : undefined,
  }
}

function jsonQueryIdsForDashboard(spec: BslDashboardSpec | null): string[] {
  if (!spec) return []
  const ids = new Set<string>()
  for (const element of Object.values(spec.elements)) {
    if (element.type === "BSLMetric") ids.add(String(element.props.queryId))
    if (element.type === "BSLFilter") {
      for (const queryId of element.props.targetQueries) ids.add(String(queryId))
    }
  }
  return [...ids]
}

function DashboardFiltersBar({
  spec,
  queryData,
  controllerValues,
  setControllerValues,
}: {
  spec: BslDashboardSpec
  queryData: Record<string, DashboardQueryResult>
  controllerValues: Record<string, string>
  setControllerValues: (updater: (previous: Record<string, string>) => Record<string, string>) => void
}) {
  const filters = Object.values(spec.elements).filter((element) => element.type === "BSLFilter")
  if (filters.length === 0) return null
  return (
    <Card className="min-w-0 border-primary/20 bg-card/95 shadow-sm">
      <CardContent className="flex min-w-0 flex-wrap items-end gap-3 p-3">
        <div className="mr-1 flex min-w-[140px] items-center gap-2 pb-2 text-sm font-medium text-foreground">
          <SlidersHorizontal className="h-4 w-4 text-primary" /> Controls
        </div>
        {filters.map((element) => {
          const props = element.props
          const id = String(props.id)
          const field = String(props.field)
          const targets = props.targetQueries as string[]
          const options = [...new Set(targets.flatMap((queryId) => queryData[queryId]?.rows.map((row) => row[field]).filter((value) => value != null).map(String) ?? []))].sort((a, b) => a.localeCompare(b))
          return (
            <label key={id} className="min-w-[180px] flex-1 text-xs font-medium text-muted-foreground sm:max-w-[260px]">
              <span className="mb-1 block truncate">{String(props.label ?? props.field)}</span>
              <select
                className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm font-normal text-foreground shadow-sm outline-none focus:ring-2 focus:ring-ring/40"
                value={controllerValues[id] ?? "__all"}
                onChange={(event) => setControllerValues((previous) => ({ ...previous, [id]: event.target.value }))}
              >
                <option value="__all">All {field}</option>
                {options.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          )
        })}
      </CardContent>
    </Card>
  )
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = window.atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

let perspectiveRuntimePromise: Promise<typeof import("@perspective-dev/client")> | undefined

function ensurePerspectiveRuntime(): Promise<typeof import("@perspective-dev/client")> {
  perspectiveRuntimePromise ??= (async () => {
    const viewerModule = await import("@perspective-dev/viewer")
    // @ts-expect-error Vite URL import for Perspective wasm asset.
    const viewerWasm = await import("@perspective-dev/viewer/dist/wasm/perspective-viewer.wasm?url")
    if (!customElements.get("perspective-viewer")) {
      await viewerModule.default.init_client(fetch(viewerWasm.default))
    }
    await import("@perspective-dev/viewer-datagrid")
    await import("@perspective-dev/viewer-d3fc")
    await customElements.whenDefined("perspective-viewer")
    const perspective = await import("@perspective-dev/client")
    // @ts-expect-error Vite URL import for Perspective wasm asset.
    const serverWasm = await import("@perspective-dev/server/dist/wasm/perspective-server.wasm?url")
    await perspective.default.init_server(fetch(serverWasm.default))
    return perspective
  })().catch((error) => {
    perspectiveRuntimePromise = undefined
    throw error
  })
  return perspectiveRuntimePromise
}

function isNumericColumnType(type: string | undefined): boolean {
  return typeof type === "string" && /int|float|double|decimal|number|uint/i.test(type)
}

function perspectiveRestoreConfig(options: {
  plugin?: string
  columns?: string[]
  groupBy?: string[]
  splitBy?: string[]
  sort?: Array<[string, "asc" | "desc"]>
  filters?: PerspectiveFilter[]
  snapshot: DashboardArrowQueryResult
}) {
  const plugin = options.plugin ?? "Datagrid"
  const columns = options.columns
  const base = { plugin, theme: boringPerspectiveThemeName(), settings: false, split_by: options.splitBy, sort: options.sort, filter: options.filters }
  if (/datagrid/i.test(plugin)) {
    return { ...base, columns, group_by: options.groupBy }
  }
  const columnMeta = options.snapshot.columns ?? []
  const groupBy = options.groupBy?.length
    ? options.groupBy
    : columns?.filter((column) => !isNumericColumnType(columnMeta.find((meta) => meta.name === column)?.type)).slice(0, 1)
  const groupSet = new Set(groupBy ?? [])
  const measureColumns = columns?.filter((column) => !groupSet.has(column))
  const numericMeasureColumns = measureColumns?.filter((column) => isNumericColumnType(columnMeta.find((meta) => meta.name === column)?.type))
  return {
    ...base,
    columns: numericMeasureColumns?.length ? numericMeasureColumns : measureColumns,
    group_by: groupBy,
  }
}

function PerspectiveTable({
  apiBaseUrl,
  workspaceId,
  queryId,
  query,
  plugin,
  columns,
  groupBy,
  splitBy,
  sort,
  filters,
  refreshKey,
}: {
  apiBaseUrl: string
  workspaceId: string | undefined
  queryId: string
  query: BslDashboardSpec["queries"][string] | undefined
  plugin?: string
  columns?: string[]
  groupBy?: string[]
  splitBy?: string[]
  sort?: Array<[string, "asc" | "desc"]>
  filters?: PerspectiveFilter[]
  refreshKey: number
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<{ loading: boolean; error?: string; snapshot?: DashboardArrowQueryResult }>({ loading: true })
  const viewerRef = useRef<(HTMLElement & { restore?: (config: unknown) => Promise<void>; notifyResize?: (force?: boolean) => Promise<void> }) | null>(null)
  const columnsKey = JSON.stringify(columns ?? [])
  const groupByKey = JSON.stringify(groupBy ?? [])
  const splitByKey = JSON.stringify(splitBy ?? [])
  const sortKey = JSON.stringify(sort ?? [])
  const filterKey = JSON.stringify(filters ?? [])

  useEffect(() => {
    let cancelled = false
    let cleanup: (() => void) | undefined
    async function loadPerspective() {
      if (!query) {
        setState({ loading: false, error: `Unknown query ${queryId}` })
        return
      }
      const host = hostRef.current
      if (!host) return
      setState({ loading: true })
      try {
        const perspective = await ensurePerspectiveRuntime()
        const snapshot = await fetchArrowDataBridgeQuery({ apiBaseUrl, workspaceId, queryId, query })
        if (cancelled) return
        const arrow = base64ToArrayBuffer(snapshot.arrowBase64)
        const worker = await perspective.default.worker()
        const clientTable = await worker.table(arrow)
        const tableWithMeta = clientTable as typeof clientTable & {
          size?: () => Promise<number>
          schema?: () => Promise<Record<string, string>>
        }
        const [tableRowCount, tableSchema] = await Promise.all([
          tableWithMeta.size?.().catch(() => undefined),
          tableWithMeta.schema?.().catch(() => undefined),
        ])
        const snapshotWithTableMeta: DashboardArrowQueryResult = {
          ...snapshot,
          rowCount: typeof tableRowCount === "number" ? tableRowCount : snapshot.rowCount,
          columns: tableSchema
            ? Object.entries(tableSchema).map(([name, type]) => ({ name, type }))
            : snapshot.columns,
        }
        if (cancelled) {
          void clientTable.delete({ lazy: true }).catch(() => undefined)
          worker.free()
          return
        }
        host.replaceChildren()
        const viewer = document.createElement("perspective-viewer") as HTMLElement & {
          load?: (table: unknown) => Promise<void>
          restore?: (config: unknown) => Promise<void>
          delete?: () => Promise<void>
          notifyResize?: (force?: boolean) => Promise<void>
        }
        const isDatagrid = /datagrid/i.test(plugin ?? "Datagrid")
        const height = isDatagrid ? "22rem" : "28rem"
        viewer.className = "bi-perspective-viewer block w-full overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-sm"
        viewer.style.display = "block"
        viewer.style.width = "100%"
        viewer.style.height = height
        viewer.style.minHeight = height
        applyBoringPerspectiveTheme(viewer, { hideAxisLabels: true, chartTicksUseSans: true })
        host.appendChild(viewer)
        if (typeof viewer.load !== "function") throw new Error("Perspective viewer custom element did not initialize")
        await viewer.load(clientTable)
        await viewer.restore?.(perspectiveRestoreConfig({ plugin, columns, groupBy, splitBy, sort, filters, snapshot: snapshotWithTableMeta }))
        // Perspective theme restore can rewrite some plugin CSS vars; re-apply
        // boring-ui tokens after restore so d3fc bars/tooltips inherit them.
        applyBoringPerspectiveTheme(viewer, { hideAxisLabels: true, chartTicksUseSans: true })
        await viewer.notifyResize?.(true)
        if (cancelled) {
          void viewer.delete?.().catch(() => undefined)
          void clientTable.delete({ lazy: true }).catch(() => undefined)
          worker.free()
          return
        }
        viewerRef.current = viewer
        const resizeObserver = typeof ResizeObserver !== "undefined"
          ? new ResizeObserver(() => { void viewer.notifyResize?.(true).catch(() => undefined) })
          : null
        resizeObserver?.observe(viewer)
        cleanup = () => {
          resizeObserver?.disconnect()
          void viewer.delete?.().catch(() => undefined)
          void clientTable.delete({ lazy: true }).catch(() => undefined)
          worker.free()
        }
        setState({ loading: false, snapshot: snapshotWithTableMeta })
      } catch (error) {
        if (!cancelled) setState({ loading: false, error: error instanceof Error ? error.message : String(error) })
      }
    }
    void loadPerspective()
    return () => {
      cancelled = true
      cleanup?.()
      viewerRef.current = null
    }
  }, [apiBaseUrl, columnsKey, groupByKey, plugin, query, queryId, refreshKey, sortKey, splitByKey, workspaceId])

  useEffect(() => {
    const viewer = viewerRef.current
    const snapshot = state.snapshot
    if (!viewer || !snapshot) return
    void viewer.restore?.(perspectiveRestoreConfig({ plugin, columns, groupBy, splitBy, sort, filters, snapshot }))
      .then(() => {
        applyBoringPerspectiveTheme(viewer, { hideAxisLabels: true, chartTicksUseSans: true })
        return viewer.notifyResize?.(true)
      })
      .catch((error) => setState((previous) => ({ ...previous, error: error instanceof Error ? error.message : String(error) })))
  }, [columnsKey, filterKey, groupByKey, plugin, sortKey, splitByKey, state.snapshot])

  return (
    <div className="min-w-0 overflow-hidden">
      {state.loading ? <Placeholder text="Loading chart…" /> : null}
      {state.error ? <Placeholder text={state.error} destructive /> : null}
      <div ref={hostRef} className={state.loading || state.error ? "hidden" : "block overflow-hidden rounded-xl"} />
      {state.snapshot && !state.error ? <p className="mt-2 truncate text-[11px] text-muted-foreground">{typeof state.snapshot.rowCount === "number" ? `${state.snapshot.rowCount.toLocaleString()} rows · ` : ""}Arrow snapshot</p> : null}
    </div>
  )
}

function Placeholder({ text, destructive }: { text: string; destructive?: boolean }) {
  return <div className={`flex h-52 items-center justify-center rounded-lg border border-dashed border-border bg-card text-sm ${destructive ? "text-destructive" : "text-muted-foreground"}`}>{text}</div>
}

interface BiDashboardRenderState {
  apiBaseUrl: string
  workspaceId: string | undefined
  spec: BslDashboardSpec
  queryData: Record<string, DashboardQueryResult>
  refreshKey: number
  controllerValues: Record<string, string>
  setControllerValues: (updater: (previous: Record<string, string>) => Record<string, string>) => void
}

const BiDashboardRenderContext = createContext<BiDashboardRenderState | null>(null)

function useBiDashboardRenderContext(): BiDashboardRenderState {
  const context = useContext(BiDashboardRenderContext)
  if (!context) throw new Error("BI dashboard render context is missing")
  return context
}

const biDashboardPaneProfile = defineGeneratedPaneProfile({
    id: "bi-dashboard",
    label: "BI Dashboard",
    components: {
      DashboardGrid: {
        description: "Responsive dashboard grid for chart, table, metric, filter, and text widgets.",
        slots: ["default"],
        props: dashboardGridPropsSchema,
        component: ({ props, children }) => <div className="grid min-w-0 gap-4" style={{ gridTemplateColumns: gridTemplateForColumns(props.columns as number | undefined) }}>{children}</div>,
      },
      BSLMetric: {
        description: "Metric card bound to a BI query result field.",
        props: bslMetricPropsSchema,
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
        description: "Chart preview bound to a BI query result.",
        props: bslChartPropsSchema,
        component: ({ props }) => {
          const { apiBaseUrl, workspaceId, spec, refreshKey, queryData, controllerValues } = useBiDashboardRenderContext()
          const queryId = String(props.queryId)
          const data = queryData[queryId]
          return (
            <Card className="min-w-0 overflow-hidden">
              <CardHeader>
                <CardTitle className="flex min-w-0 items-center gap-2 text-lg"><BarChart3 className="h-4 w-4 shrink-0" /> <span className="truncate">{typeof props.title === "string" ? props.title : queryId}</span></CardTitle>
                <CardDescription className="truncate">Perspective · {perspectivePluginForChartType(String(props.chartType))} · query <code>{queryId}</code>{data?.source ? <> · {data.source}</> : null}</CardDescription>
              </CardHeader>
              <CardContent>
                {(() => {
                  const fields = chartPerspectiveFields(props.x, props.y)
                  const filters = perspectiveFiltersForQuery(spec, controllerValues, queryId)
                  return (
                    <PerspectiveTable
                      apiBaseUrl={apiBaseUrl}
                      workspaceId={workspaceId}
                      queryId={queryId}
                      query={spec.queries[queryId]}
                      plugin={perspectivePluginForChartType(String(props.chartType))}
                      columns={fields.columns}
                      groupBy={fields.groupBy}
                      filters={filters}
                      refreshKey={refreshKey}
                    />
                  )
                })()}
              </CardContent>
            </Card>
          )
        },
      },
      BSLPerspectiveViewer: {
        description: "Table/Perspective-style viewer bound to a BI query result.",
        props: bslPerspectiveViewerPropsSchema,
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
        description: "Dashboard filter control placeholder for target queries.",
        props: bslFilterPropsSchema,
        component: () => null,
      },
      BSLText: {
        description: "Text/markdown explanation block for dashboard context.",
        props: bslTextPropsSchema,
        component: ({ props }) => <Card className="min-w-0"><CardContent className="p-4 text-sm text-muted-foreground">{String(props.markdown)}</CardContent></Card>,
      },
    },
})
