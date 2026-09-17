import {
  WORKSPACE_OPEN_PATH_SURFACE_KIND,
  type BoringFrontSurfaceResolverRegistration,
} from "@hachej/boring-workspace/plugin"
import { TLDRAW_AGENT_PANEL_ID } from "./panels"

export function isTldrawPath(path: string): boolean {
  return /\.(?:tldraw|tldr)$/i.test(path)
}

export const tldrawAgentSurfaceResolver: BoringFrontSurfaceResolverRegistration = {
  id: "tldraw-agent.open-file",
  kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
  source: "app",
  resolve(request) {
    if (request.kind !== WORKSPACE_OPEN_PATH_SURFACE_KIND || !isTldrawPath(request.target)) return undefined
    const filesystem = typeof request.filesystem === "string" && request.filesystem ? request.filesystem : undefined
    if (filesystem && filesystem !== "user") return undefined
    return {
      id: `tldraw:${encodeURIComponent(filesystem ?? "user")}:${encodeURIComponent(request.target)}`,
      component: TLDRAW_AGENT_PANEL_ID,
      title: request.target.split("/").pop() || request.target,
      params: { path: request.target, ...(filesystem ? { filesystem } : {}) },
      score: 1000,
    }
  },
}
