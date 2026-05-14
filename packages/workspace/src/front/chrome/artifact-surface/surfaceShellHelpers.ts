import type { DockviewApi } from "dockview-react"
import type {
  SurfaceOpenRequest,
  SurfacePanelResolution,
  SurfaceResolverConfig,
} from "../../../shared/types/surface"
import { WORKSPACE_OPEN_PATH_SURFACE_KIND } from "../../../shared/types/surface"

export function resolvePanelForPath(
  path: string,
  registry: { resolve: SurfaceResolverConfig["resolve"] },
): SurfacePanelResolution | undefined {
  return registry.resolve({ kind: WORKSPACE_OPEN_PATH_SURFACE_KIND, target: path })
}

export function normalizeWorkbenchPath(path: string): string {
  const trimmed = path.trim().replace(/\\/g, "/")
  const noLeadingDot = trimmed.replace(/^\.\//, "")
  const normalized = noLeadingDot.replace(/\/+/g, "/")
  // Security: reject path traversal attempts
  if (normalized.includes("..")) {
    throw new Error(`Invalid path: path traversal not allowed`)
  }
  return normalized
}

export function findOpenFilePanel(api: DockviewApi, path: string) {
  const panelId = `file:${path}`
  return api.getPanel(panelId)
    ?? api.panels.find((panel) =>
      (panel.params as Record<string, unknown> | undefined)?.path === path
    )
}

export function normalizeSurfaceOpenRequest(
  request: SurfaceOpenRequest,
): SurfaceOpenRequest {
  if (request.kind !== WORKSPACE_OPEN_PATH_SURFACE_KIND) return request
  return {
    ...request,
    target: normalizeWorkbenchPath(request.target),
  }
}

export function surfacePanelId(
  request: SurfaceOpenRequest,
  resolved: SurfacePanelResolution,
): string {
  return resolved.id ?? `surface:${request.kind}:${request.target}`
}
