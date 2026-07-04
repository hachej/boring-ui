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

export interface SurfaceResolverExample {
  target: string
  label?: string
  meta?: Record<string, unknown>
}

export interface SurfaceResolverMetadata {
  kind?: string
  title?: string
  description?: string
  targetHint?: string
  examples?: SurfaceResolverExample[]
  metaSchema?: Record<string, unknown>
}

export interface SurfaceResolverDescriptor extends SurfaceResolverMetadata {
  id: string
  kind: string
  source?: string
  pluginId?: string
}

export interface SurfaceResolverConfig extends SurfaceResolverMetadata {
  id: string
  resolve: (request: SurfaceOpenRequest) => SurfacePanelResolution | undefined
  source?: string
  pluginId?: string
}

export type SurfaceResolverRegistration = Omit<SurfaceResolverConfig, "id">

export function surfaceResolverDescriptor(resolver: SurfaceResolverConfig): SurfaceResolverDescriptor | null {
  if (typeof resolver.kind !== "string" || resolver.kind.length === 0) return null
  return {
    id: resolver.id,
    kind: resolver.kind,
    ...(resolver.title !== undefined ? { title: resolver.title } : {}),
    ...(resolver.description !== undefined ? { description: resolver.description } : {}),
    ...(resolver.targetHint !== undefined ? { targetHint: resolver.targetHint } : {}),
    ...(resolver.examples !== undefined ? { examples: resolver.examples } : {}),
    ...(resolver.metaSchema !== undefined ? { metaSchema: resolver.metaSchema } : {}),
    ...(resolver.source !== undefined ? { source: resolver.source } : {}),
    ...(resolver.pluginId !== undefined ? { pluginId: resolver.pluginId } : {}),
  }
}
