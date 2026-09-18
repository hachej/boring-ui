import {
  WORKSPACE_OPEN_PATH_SURFACE_KIND,
  type BoringFrontSurfaceResolverRegistration,
} from "@hachej/boring-workspace/plugin"
import { normalizeTldrawResourcePath } from "../shared"
import { TLDRAW_AGENT_PANEL_ID } from "./panels"

export function isTldrawPath(path: string): boolean {
  try { normalizeTldrawResourcePath(path); return true } catch { return false }
}

export const tldrawAgentSurfaceResolver: BoringFrontSurfaceResolverRegistration = {
  id: "tldraw-agent.open-file",
  kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
  source: "app",
  resolve(request) {
    if (request.kind !== WORKSPACE_OPEN_PATH_SURFACE_KIND || !isTldrawPath(request.target)) return undefined
    const filesystem = typeof request.filesystem === "string" && request.filesystem ? request.filesystem : undefined
    if (filesystem && filesystem !== "user") return undefined
    const path = normalizeTldrawResourcePath(request.target)
    return {
      id: `tldraw:user:${encodeURIComponent(path)}`,
      component: TLDRAW_AGENT_PANEL_ID,
      title: path.split("/").pop() || path,
      params: { path, filesystem: "user" },
      score: 1000,
    }
  },
}
