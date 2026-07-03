import { useEffect, useRef, useState } from "react"
import { applyBoringPerspectiveTheme, boringPerspectiveThemeName } from "@hachej/boring-ui-kit"
import type { BslDashboardSpec } from "../shared"
import { fetchArrowDataBridgeQuery, type DashboardArrowQueryResult } from "./dashboardData"

export type PerspectiveFilter = [string, "==", string]

export function perspectiveFiltersForQuery(spec: BslDashboardSpec, controllerValues: Record<string, string>, queryId: string): PerspectiveFilter[] {
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

export function perspectivePluginForChartType(chartType: string): string {
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

export function chartPerspectiveFields(x?: unknown, y?: unknown): { columns?: string[]; groupBy?: string[] } {
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

export function PerspectiveTable({
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
