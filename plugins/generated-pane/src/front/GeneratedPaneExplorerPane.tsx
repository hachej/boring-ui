import { useEffect, useMemo, useState } from "react"
import { FileJson2, PanelTop, RefreshCw } from "lucide-react"
import { Badge, EmptyState, IconButton } from "@hachej/boring-ui-kit"
import { useApiBaseUrl, useWorkspaceRequestId } from "@hachej/boring-workspace"
import type { PaneProps } from "@hachej/boring-workspace/plugin"
import { GENERATED_PANE_PANEL_ID } from "./constants"

export interface GeneratedPaneExplorerConfig {
  title?: string
  patterns?: string[]
  panelId?: string
  itemLabel?: string
  emptyTitle?: string
  emptyDescription?: string
}

interface PaneSearchState {
  loading: boolean
  error?: string
  paths: string[]
}

interface PaneSearchResponse {
  results?: string[]
}

const DEFAULT_PATTERNS = ["**/*.pane.json"]

function titleFromPath(path: string): string {
  const file = path.split("/").pop() ?? path
  return file
    .replace(/\.(pane|dashboard)\.json$/i, "")
    .replace(/[-_]+/g, " ")
}

function matchesQuery(path: string, query: string | undefined): boolean {
  const value = query?.trim().toLowerCase()
  if (!value) return true
  return path.toLowerCase().includes(value) || titleFromPath(path).toLowerCase().includes(value)
}

function dedupeAndSort(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}

export function createGeneratedPaneExplorerPane(config: GeneratedPaneExplorerConfig = {}) {
  return function GeneratedPaneExplorerPaneWithConfig(props: PaneProps<{ searchQuery?: string }>) {
    return <GeneratedPaneExplorerPane {...props} config={config} />
  }
}

export function GeneratedPaneExplorerPane({ params, containerApi, config = {} }: PaneProps<{ searchQuery?: string }> & { config?: GeneratedPaneExplorerConfig }) {
  const apiBaseUrl = useApiBaseUrl()
  const workspaceId = useWorkspaceRequestId()
  const patterns = config.patterns?.length ? config.patterns : DEFAULT_PATTERNS
  const panelId = config.panelId ?? GENERATED_PANE_PANEL_ID
  const title = config.title ?? "Panes"
  const itemLabel = config.itemLabel ?? "Generated pane"
  const [state, setState] = useState<PaneSearchState>({ loading: true, paths: [] })
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setState((prev) => ({ ...prev, loading: true, error: undefined }))
    void Promise.all(patterns.map(async (pattern) => {
      const response = await fetch(`${apiBaseUrl}/api/v1/files/search?q=${encodeURIComponent(pattern)}&limit=500`, {
        signal: controller.signal,
        credentials: "include",
        headers: workspaceId ? { "x-boring-workspace-id": workspaceId } : {},
      })
      if (!response.ok) throw new Error(`Pane search failed for ${pattern} with HTTP ${response.status}`)
      const body = await response.json() as PaneSearchResponse
      return body.results ?? []
    }))
      .then((groups) => {
        setState({ loading: false, paths: dedupeAndSort(groups.flat()) })
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setState({ loading: false, paths: [], error: error instanceof Error ? error.message : String(error) })
      })
    return () => controller.abort()
  }, [apiBaseUrl, patterns.join("\n"), refreshKey, workspaceId])

  const paths = useMemo(
    () => state.paths.filter((path) => matchesQuery(path, params?.searchQuery)),
    [params?.searchQuery, state.paths],
  )

  const openPane = (path: string) => {
    containerApi.addPanel({
      id: `${panelId}:${path}`,
      component: panelId,
      title: titleFromPath(path),
      params: { path },
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col text-sm">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <PanelTop className="h-4 w-4 text-muted-foreground" />
          <span className="truncate font-medium">{title}</span>
          <Badge variant="secondary">{state.paths.length}</Badge>
        </div>
        <IconButton
          type="button"
          aria-label={`Refresh ${title.toLowerCase()}`}
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
          <EmptyState title={`Could not list ${title.toLowerCase()}`} description={state.error} />
        ) : state.loading ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">Scanning {title.toLowerCase()}…</div>
        ) : paths.length === 0 ? (
          <EmptyState
            title={config.emptyTitle ?? `No ${title.toLowerCase()} found`}
            description={config.emptyDescription ?? `Create ${patterns.join(" or ")} files to list them here.`}
          />
        ) : (
          <div className="space-y-1">
            {paths.map((path) => (
              <button
                key={path}
                type="button"
                onClick={() => openPane(path)}
                className="flex w-full min-w-0 items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-background/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <FileJson2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground">{titleFromPath(path)}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{path}</span>
                </span>
                <Badge variant="outline" className="mt-0.5 shrink-0 text-[10px]">{itemLabel}</Badge>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
