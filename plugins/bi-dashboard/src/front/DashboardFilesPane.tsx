import { useEffect, useMemo, useState } from "react"
import { FileJson2, LayoutDashboard, RefreshCw } from "lucide-react"
import { Badge, EmptyState, IconButton } from "@hachej/boring-ui-kit"
import { useApiBaseUrl, useWorkspaceRequestId } from "@hachej/boring-workspace"
import type { WorkspaceSourceProps } from "@hachej/boring-workspace/plugin"
import { BI_DASHBOARD_PANEL_ID } from "./constants"

interface DashboardSearchState {
  loading: boolean
  error?: string
  paths: string[]
}

interface DashboardSearchResponse {
  results?: string[]
}

function titleFromPath(path: string): string {
  const file = path.split("/").pop() ?? path
  return file.replace(/\.dashboard\.json$/i, "").replace(/[-_]+/g, " ")
}

function matchesQuery(path: string, query: string | undefined): boolean {
  const value = query?.trim().toLowerCase()
  if (!value) return true
  return path.toLowerCase().includes(value) || titleFromPath(path).toLowerCase().includes(value)
}

type DashboardFilesPaneProps = WorkspaceSourceProps<{ searchQuery?: string }>

export function DashboardFilesPane({ params, openPanel }: DashboardFilesPaneProps) {
  const apiBaseUrl = useApiBaseUrl()
  const workspaceId = useWorkspaceRequestId()
  const [state, setState] = useState<DashboardSearchState>({ loading: true, paths: [] })
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setState((prev) => ({ ...prev, loading: true, error: undefined }))
    void fetch(`${apiBaseUrl}/api/v1/files/search?q=**%2F*.dashboard.json&limit=500`, {
      signal: controller.signal,
      credentials: "include",
      headers: workspaceId ? { "x-boring-workspace-id": workspaceId } : {},
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Dashboard search failed with HTTP ${response.status}`)
        return await response.json() as DashboardSearchResponse
      })
      .then((body) => {
        setState({
          loading: false,
          paths: [...new Set(body.results ?? [])].sort((a, b) => a.localeCompare(b)),
        })
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setState({ loading: false, paths: [], error: error instanceof Error ? error.message : String(error) })
      })
    return () => controller.abort()
  }, [apiBaseUrl, refreshKey, workspaceId])

  const paths = useMemo(
    () => state.paths.filter((path) => matchesQuery(path, params?.searchQuery)),
    [params?.searchQuery, state.paths],
  )

  const openDashboard = (path: string) => {
    const panel = {
      id: `${BI_DASHBOARD_PANEL_ID}:${path}`,
      component: BI_DASHBOARD_PANEL_ID,
      title: titleFromPath(path),
      params: { path },
    }
    openPanel?.(panel)
  }

  return (
    <div className="flex h-full min-h-0 flex-col text-sm">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
          <span className="truncate font-medium">Dashboards</span>
          <Badge variant="secondary">{state.paths.length}</Badge>
        </div>
        <IconButton
          type="button"
          aria-label="Refresh dashboards"
          variant="ghost"
          size="icon-xs"
          onClick={() => setRefreshKey((value) => value + 1)}
          disabled={state.loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${state.loading ? "animate-spin" : ""}`} />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {state.error ? (
          <EmptyState title="Could not list dashboards" description={state.error} />
        ) : state.loading ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">Scanning dashboards…</div>
        ) : paths.length === 0 ? (
          <EmptyState
            title="No dashboards found"
            description="Create files under dashboards/*.dashboard.json to list them here."
          />
        ) : (
          <div className="space-y-1">
            {paths.map((path) => (
              <button
                key={path}
                type="button"
                onClick={() => openDashboard(path)}
                className="flex w-full min-w-0 items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-background/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <FileJson2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground">{titleFromPath(path)}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{path}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
