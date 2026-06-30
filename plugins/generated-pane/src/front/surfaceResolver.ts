import {
  WORKSPACE_OPEN_PATH_SURFACE_KIND,
  type BoringFrontSurfaceResolverRegistration,
} from "@hachej/boring-workspace/plugin"
import { GENERATED_PANE_PANEL_ID } from "./constants"

export function isGeneratedPanePath(path: string): boolean {
  return /(^|\/)panes\/[^/].*\.pane\.json$/i.test(path) || /\.pane\.json$/i.test(path)
}

function titleFromPath(path: string): string {
  const file = path.split("/").pop() ?? path
  return file.replace(/\.pane\.json$/i, "").replace(/[-_]+/g, " ")
}

export const generatedPaneSurfaceResolver: BoringFrontSurfaceResolverRegistration = {
  id: "generated-pane.open-path",
  kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
  source: "app",
  resolve: (request) => {
    if (request.kind !== WORKSPACE_OPEN_PATH_SURFACE_KIND) return null
    const target = String(request.target ?? "")
    if (!isGeneratedPanePath(target)) return null
    return {
      component: GENERATED_PANE_PANEL_ID,
      title: titleFromPath(target),
      params: { path: target },
      score: 110,
    }
  },
}
