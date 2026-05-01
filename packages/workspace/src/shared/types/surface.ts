export const WORKSPACE_OPEN_PATH_SURFACE_KIND = "workspace.open.path"

export interface SurfaceOpenRequest {
  kind: string
  target: string
  meta?: Record<string, unknown>
}

export interface SurfacePanelResolution {
  component: string
  id?: string
  title?: string
  params?: Record<string, unknown>
  score?: number
}

export interface SurfaceResolverConfig {
  id: string
  resolve: (request: SurfaceOpenRequest) => SurfacePanelResolution | undefined
  source?: string
  pluginId?: string
}

export type SurfaceResolverRegistration = Omit<SurfaceResolverConfig, "id">
