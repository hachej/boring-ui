import {
  WORKSPACE_OPEN_PATH_SURFACE_KIND,
  type BoringFrontSurfaceResolverRegistration,
} from "@hachej/boring-workspace/plugin"
import { BI_DASHBOARD_PANEL_ID } from "./constants"

export function isDashboardPath(path: string): boolean {
  return /(^|\/)dashboards\/[^/].*\.dashboard\.json$/i.test(path) || /\.dashboard\.json$/i.test(path)
}

function titleFromPath(path: string): string {
  const file = path.split("/").pop() ?? path
  return file.replace(/\.dashboard\.json$/i, "").replace(/[-_]+/g, " ")
}

export const biDashboardSurfaceResolver: BoringFrontSurfaceResolverRegistration = {
  id: "bi-dashboard.open-path",
  kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
  source: "app",
  resolve: (request) => {
    if (request.kind !== WORKSPACE_OPEN_PATH_SURFACE_KIND) return null
    const target = String(request.target ?? "")
    if (!isDashboardPath(target)) return null
    return {
      component: BI_DASHBOARD_PANEL_ID,
      title: titleFromPath(target),
      params: { path: target },
      score: 110,
    }
  },
}
