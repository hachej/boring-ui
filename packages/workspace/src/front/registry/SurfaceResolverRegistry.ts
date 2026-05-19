import type {
  SurfaceOpenRequest,
  SurfacePanelResolution,
  SurfaceResolverConfig,
  SurfaceResolverRegistration,
} from "../../shared/types/surface"

export class SurfaceResolverRegistry {
  private resolvers = new Map<string, SurfaceResolverConfig>()
  private registrationOrder: string[] = []
  private listeners = new Set<() => void>()
  private snapshotCache: readonly SurfaceResolverConfig[] | null = null

  register(id: string, config: SurfaceResolverRegistration): void {
    const existed = this.resolvers.has(id)
    this.resolvers.set(id, { ...config, id })
    if (!existed) this.registrationOrder.push(id)
    this.emit()
  }

  unregister(id: string): void {
    if (!this.resolvers.delete(id)) return
    this.registrationOrder = this.registrationOrder.filter((oid) => oid !== id)
    this.emit()
  }

  /**
   * Atomic replace by pluginId: drop owned resolvers and register the new
   * set in one emit. Pi parity for reload semantics.
   *
   * Collision policy: a new resolver id already owned by a DIFFERENT
   * pluginId is skipped with a warning.
   */
  replaceByPluginId(pluginId: string, resolvers: SurfaceResolverConfig[]): void {
    const ownedIds = new Set<string>()
    for (const [id, resolver] of this.resolvers) {
      if (resolver.pluginId === pluginId) ownedIds.add(id)
    }
    if (ownedIds.size === 0 && resolvers.length === 0) return

    let changed = ownedIds.size > 0
    for (const id of ownedIds) this.resolvers.delete(id)
    if (ownedIds.size > 0) {
      this.registrationOrder = this.registrationOrder.filter((oid) => this.resolvers.has(oid))
    }
    for (const config of resolvers) {
      const id = config.id
      if (!id) continue
      const existing = this.resolvers.get(id)
      if (existing && existing.pluginId !== pluginId) {
        // eslint-disable-next-line no-console
        console.warn(
          `[SurfaceResolverRegistry] plugin "${pluginId}" tried to register resolver "${id}" already owned by "${existing.pluginId ?? 'system'}" — skipped`,
        )
        continue
      }
      this.resolvers.set(id, { ...config, id, pluginId })
      if (!this.registrationOrder.includes(id)) this.registrationOrder.push(id)
      changed = true
    }
    if (changed) this.emit()
  }

  get(id: string): SurfaceResolverConfig | undefined {
    return this.resolvers.get(id)
  }

  has(id: string): boolean {
    return this.resolvers.has(id)
  }

  list(): SurfaceResolverConfig[] {
    return this.registrationOrder.map((id) => this.resolvers.get(id)!)
  }

  resolve(request: SurfaceOpenRequest): SurfacePanelResolution | undefined {
    let best: SurfacePanelResolution | undefined
    let bestScore = -Infinity
    let bestIsApp = false
    let bestIndex = -1

    this.registrationOrder.forEach((id, index) => {
      const resolver = this.resolvers.get(id)!
      let resolution: SurfacePanelResolution | undefined
      try {
        resolution = resolver.resolve(request)
      } catch (error) {
        // Plugin resolvers are isolation boundaries: one bad contribution
        // should not block lower-priority fallbacks or unrelated plugins.
        console.warn(
          `[SurfaceResolverRegistry] resolver "${id}" failed:`,
          error instanceof Error ? error.message : error,
        )
        return
      }
      if (!resolution) return
      const score = resolution.score ?? 0
      const isApp = resolver.source === "app"
      if (
        score > bestScore ||
        (score === bestScore && isApp && !bestIsApp) ||
        (score === bestScore && isApp === bestIsApp && index >= bestIndex)
      ) {
        best = resolution
        bestScore = score
        bestIsApp = isApp
        bestIndex = index
      }
    })

    return best
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  getSnapshot = (): readonly SurfaceResolverConfig[] => {
    if (!this.snapshotCache) this.snapshotCache = this.list()
    return this.snapshotCache
  }

  private emit(): void {
    this.snapshotCache = null
    for (const cb of [...this.listeners]) cb()
  }
}
