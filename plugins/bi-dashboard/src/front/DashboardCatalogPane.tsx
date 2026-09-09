import { useEffect, useRef, useState } from "react"
import { FileJson2, LayoutDashboard, RefreshCw } from "lucide-react"
import { Badge, EmptyState, IconButton } from "@hachej/boring-ui-kit"
import type { WorkspaceSourceOpenPanelConfig, WorkspaceSourceProps } from "@hachej/boring-workspace/plugin"
import { BI_DASHBOARD_PANEL_ID } from "./constants"

export interface DashboardCatalogSearchArgs {
  query: string
  limit: number
  offset: number
  signal?: AbortSignal
}

export interface DashboardCatalogBadge {
  label: string
}

export interface DashboardCatalogRow {
  id: string
  title: string
  subtitle?: string
  group?: string
  badges?: DashboardCatalogBadge[]
  params: Record<string, unknown>
  panelTitle?: string
}

export interface DashboardCatalogSearchResult {
  items: DashboardCatalogRow[]
  total: number
  hasMore: boolean
}

export interface DashboardCatalogAdapter {
  search(args: DashboardCatalogSearchArgs): Promise<DashboardCatalogSearchResult>
}

export interface DashboardCatalogPaneProps extends WorkspaceSourceProps<{ searchQuery?: string }> {
  adapter: DashboardCatalogAdapter
  emptyDescription?: string
  label?: string
  pageSize?: number
  resolvePanel?: (row: DashboardCatalogRow) => WorkspaceSourceOpenPanelConfig | Promise<WorkspaceSourceOpenPanelConfig>
}

type CatalogState = {
  loading: boolean
  loadingMore: boolean
  rows: DashboardCatalogRow[]
  total: number
  hasMore: boolean
  error?: string
}

export function dashboardPanelForRow(row: DashboardCatalogRow): WorkspaceSourceOpenPanelConfig {
  return {
    id: `${BI_DASHBOARD_PANEL_ID}:${row.id}`,
    component: BI_DASHBOARD_PANEL_ID,
    title: row.panelTitle ?? row.title,
    params: row.params,
  }
}

export function DashboardCatalogPane({
  adapter,
  className,
  emptyDescription = "No matching items were found.",
  label = "Dashboards",
  openPanel,
  pageSize = 50,
  params,
  resolvePanel = dashboardPanelForRow,
}: DashboardCatalogPaneProps) {
  const query = params?.searchQuery?.trim() ?? ""
  const [refreshKey, setRefreshKey] = useState(0)
  const [state, setState] = useState<CatalogState>({ loading: true, loadingMore: false, rows: [], total: 0, hasMore: false })
  const [resultTotal, setResultTotal] = useState(0)
  const [pageVersion, setPageVersion] = useState(0)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const requestVersion = useRef(0)
  const nextOffset = useRef(0)
  const paginationInFlight = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    const version = ++requestVersion.current
    setState({ loading: true, loadingMore: false, rows: [], total: 0, hasMore: false })
    void adapter.search({ query, limit: pageSize, offset: 0, signal: controller.signal })
      .then((result) => {
        if (version !== requestVersion.current) return
        nextOffset.current = result.items.length
        setResultTotal(result.total)
        setState({ loading: false, loadingMore: false, rows: result.items, total: result.total, hasMore: result.hasMore })
      })
      .catch((error) => {
        if (controller.signal.aborted || version !== requestVersion.current) return
        setState({ loading: false, loadingMore: false, rows: [], total: 0, hasMore: false, error: error instanceof Error ? error.message : String(error) })
      })
    return () => controller.abort()
  }, [adapter, pageSize, query, refreshKey])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !state.hasMore || state.loading || state.loadingMore) return
    const controller = new AbortController()
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || paginationInFlight.current) return
      paginationInFlight.current = true
      observer.disconnect()
      const version = requestVersion.current
      setState((previous) => ({ ...previous, loadingMore: true }))
      void adapter.search({ query, limit: pageSize, offset: nextOffset.current, signal: controller.signal })
        .then((result) => {
          if (version !== requestVersion.current) return
          nextOffset.current += result.items.length
          setPageVersion((value) => value + 1)
          setState((previous) => {
            const rows = new Map(previous.rows.map((row) => [row.id, row]))
            for (const row of result.items) rows.set(row.id, row)
            return { loading: false, loadingMore: false, rows: [...rows.values()], total: result.total, hasMore: result.hasMore }
          })
        })
        .catch((error) => {
          if (controller.signal.aborted || version !== requestVersion.current) return
          setState((previous) => ({ ...previous, loadingMore: false, hasMore: false, error: error instanceof Error ? error.message : String(error) }))
        })
        .finally(() => {
          paginationInFlight.current = false
        })
    }, { rootMargin: "160px" })
    observer.observe(sentinel)
    return () => {
      controller.abort()
      observer.disconnect()
    }
  }, [adapter, pageSize, pageVersion, query, state.hasMore, state.loading, state.rows.length])

  const groups = groupRows(state.rows)
  const selectRow = async (row: DashboardCatalogRow) => openPanel?.(await resolvePanel(row))

  return (
    <div className={`flex h-full min-h-0 flex-col text-sm ${className ?? ""}`}>
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
          <span className="truncate font-medium">{label}</span>
          <Badge variant="secondary">{resultTotal}</Badge>
        </div>
        <IconButton type="button" aria-label={`Refresh ${label.toLowerCase()}`} variant="ghost" size="icon-xs" onClick={() => setRefreshKey((value) => value + 1)} disabled={state.loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${state.loading ? "animate-spin" : ""}`} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {state.error ? <EmptyState title={`Could not list ${label.toLowerCase()}`} description={state.error} />
          : state.loading ? <div className="px-2 py-3 text-xs text-muted-foreground">Scanning {label.toLowerCase()}…</div>
          : state.rows.length === 0 ? <EmptyState title={`No ${label.toLowerCase()} found`} description={emptyDescription} />
          : groups.map((group) => (
            <section key={group.label} className="mb-2">
              {group.label ? <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</div> : null}
              {group.rows.map((row) => (
                <button key={row.id} type="button" onClick={() => void selectRow(row)} className="flex w-full min-w-0 items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-background/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                  <FileJson2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-foreground">{row.title}</span>
                    {row.subtitle ? <span className="block truncate text-[11px] text-muted-foreground">{row.subtitle}</span> : null}
                  </span>
                  {row.badges?.map((badge) => <Badge key={badge.label} variant="secondary">{badge.label}</Badge>)}
                </button>
              ))}
            </section>
          ))}
        <div ref={sentinelRef} className="h-px" aria-hidden="true" />
        {state.loadingMore ? <div className="px-2 py-3 text-center text-xs text-muted-foreground">Loading more…</div> : null}
      </div>
    </div>
  )
}

function groupRows(rows: DashboardCatalogRow[]) {
  const groups = new Map<string, DashboardCatalogRow[]>()
  for (const row of rows) {
    const group = row.group ?? ""
    groups.set(group, [...(groups.get(group) ?? []), row])
  }
  return [...groups].map(([label, groupedRows]) => ({ label, rows: groupedRows }))
}
