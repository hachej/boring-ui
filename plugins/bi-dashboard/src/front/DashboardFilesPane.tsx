import { useMemo } from "react"
import { useApiBaseUrl, useWorkspaceRequestId } from "@hachej/boring-workspace"
import type { WorkspaceSourceProps } from "@hachej/boring-workspace/plugin"
import {
  DashboardCatalogPane,
  type DashboardCatalogAdapter,
  type DashboardCatalogSearchResult,
} from "./DashboardCatalogPane"

interface DashboardSearchResponse {
  resources?: Array<{ filesystem: string; path: string }>
  results?: string[]
}

function titleFromPath(path: string): string {
  const file = path.split("/").pop() ?? path
  return file.replace(/\.dashboard\.json$/i, "").replace(/[-_]+/g, " ")
}

function isWorkspaceDashboardPath(path: string): boolean {
  return path.startsWith("dashboards/") && path.endsWith(".dashboard.json")
}

type DashboardFilesPaneProps = WorkspaceSourceProps<{ searchQuery?: string }>

type DashboardSearchClient = (limit: number, signal?: AbortSignal) => Promise<DashboardSearchResponse>

export function createDashboardFilesAdapter(searchFiles: DashboardSearchClient): DashboardCatalogAdapter {
  return {
    async search({ query, limit, signal }): Promise<DashboardCatalogSearchResult> {
      const body = await searchFiles(limit, signal)
      const resources = body.resources?.filter((resource) => resource.filesystem === "user").map((resource) => resource.path)
        ?? body.results
        ?? []
      const normalizedQuery = query.toLowerCase()
      const dashboardPaths = [...new Set(resources)].filter(isWorkspaceDashboardPath)
      const paths = dashboardPaths
        .filter((path) => !normalizedQuery || path.toLowerCase().includes(normalizedQuery) || titleFromPath(path).toLowerCase().includes(normalizedQuery))
        .sort((left, right) => left.localeCompare(right))
      return {
        items: paths.map((path) => ({ id: path, title: titleFromPath(path), subtitle: path, params: { path } })),
        total: dashboardPaths.length,
        hasMore: false,
      }
    },
  }
}

export function DashboardFilesPane(props: DashboardFilesPaneProps) {
  const apiBaseUrl = useApiBaseUrl()
  const workspaceId = useWorkspaceRequestId()
  const adapter = useMemo(() => createDashboardFilesAdapter(async (limit, signal) => {
    const response = await fetch(`${apiBaseUrl}/api/v1/files/search?q=**%2F*.dashboard.json&limit=${limit}`, {
      signal,
      credentials: "include",
      headers: workspaceId ? { "x-boring-workspace-id": workspaceId } : {},
    })
    if (!response.ok) throw new Error(`Dashboard search failed with HTTP ${response.status}`)
    return await response.json() as DashboardSearchResponse
  }), [apiBaseUrl, workspaceId])

  return <DashboardCatalogPane {...props} adapter={adapter} pageSize={500} emptyDescription="Create files under dashboards/*.dashboard.json to list them here." />
}
