import { lazy, type ComponentType } from "react"
import type { WorkspaceSourceConfig, WorkspaceSourceRegistration } from "./types"

export class WorkspaceSourceRegistry {
  private sources = new Map<string, WorkspaceSourceConfig>()
  private registrationOrder: string[] = []
  private capabilities: Set<string>
  private listeners = new Set<() => void>()
  private snapshotCache: readonly WorkspaceSourceConfig[] | null = null
  // React.lazy types must be stable across initial Suspense retries. Keep the
  // cache outside the suspending render path, mirroring PanelRegistry's lazy
  // wrapper cache for Dockview panels.
  private lazyComponentCache = new Map<string, { importer: unknown; revision?: number; component: ComponentType<any> }>()

  constructor(capabilities: Record<string, boolean> = {}) {
    this.capabilities = new Set(
      Object.entries(capabilities)
        .filter(([, v]) => v)
        .map(([k]) => k),
    )
  }

  register(id: string, config: WorkspaceSourceRegistration): void {
    const existed = this.sources.has(id)
    this.sources.set(id, { ...config, id } as WorkspaceSourceConfig)
    if (!existed) this.registrationOrder.push(id)
    this.emit()
  }

  unregister(id: string): void {
    if (!this.sources.delete(id)) return
    this.lazyComponentCache.delete(id)
    this.registrationOrder = this.registrationOrder.filter((oid) => oid !== id)
    this.emit()
  }

  replaceByPluginId(pluginId: string, sources: WorkspaceSourceConfig[]): void {
    const ownedIds = new Set<string>()
    for (const [id, source] of this.sources) {
      if (source.pluginId === pluginId) ownedIds.add(id)
    }
    if (ownedIds.size === 0 && sources.length === 0) return

    let changed = ownedIds.size > 0
    for (const id of ownedIds) {
      this.sources.delete(id)
      this.lazyComponentCache.delete(id)
    }
    if (ownedIds.size > 0) {
      this.registrationOrder = this.registrationOrder.filter((oid) => this.sources.has(oid))
    }
    for (const config of sources) {
      const id = config.id
      if (!id) continue
      const existing = this.sources.get(id)
      if (existing && existing.pluginId !== pluginId) {
        // eslint-disable-next-line no-console
        console.warn(
          `[WorkspaceSourceRegistry] plugin "${pluginId}" tried to register source "${id}" already owned by "${existing.pluginId ?? "system"}" — skipped`,
        )
        continue
      }
      this.sources.set(id, { ...config, id, pluginId })
      if (!this.registrationOrder.includes(id)) this.registrationOrder.push(id)
      changed = true
    }
    if (changed) this.emit()
  }

  get(id: string): WorkspaceSourceConfig | undefined {
    return this.sources.get(id)
  }

  has(id: string): boolean {
    return this.sources.has(id)
  }

  getComponent(sourceId: string): ComponentType<any> | undefined {
    const source = this.sources.get(sourceId)
    if (!source || !this.satisfiesCapabilities(source)) return undefined
    if (source.lazy) return this.getLazyComponent(source.id, source.component, source.pluginRevision)
    return source.component as ComponentType<any>
  }

  list(): WorkspaceSourceConfig[] {
    return this.filteredSources()
  }

  listAll(): WorkspaceSourceConfig[] {
    return this.registrationOrder.map((id) => this.sources.get(id)!)
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  getSnapshot = (): readonly WorkspaceSourceConfig[] => {
    if (!this.snapshotCache) this.snapshotCache = this.filteredSources()
    return this.snapshotCache
  }

  private getLazyComponent(
    sourceId: string,
    importer: WorkspaceSourceConfig["component"],
    revision: number | undefined,
  ): ComponentType<any> {
    const cached = this.lazyComponentCache.get(sourceId)
    if (cached?.importer === importer && cached.revision === revision) return cached.component
    const component = lazy(
      importer as () => Promise<{ default: ComponentType<unknown> }>,
    ) as ComponentType<any>
    this.lazyComponentCache.set(sourceId, { importer, revision, component })
    return component
  }

  private emit(): void {
    this.snapshotCache = null
    for (const cb of [...this.listeners]) cb()
  }

  private filteredSources(): WorkspaceSourceConfig[] {
    return this.registrationOrder
      .map((id) => this.sources.get(id)!)
      .filter((source) => this.satisfiesCapabilities(source))
  }

  private satisfiesCapabilities(source: WorkspaceSourceConfig): boolean {
    if (!source.requiresCapabilities?.length) return true
    return source.requiresCapabilities.every((cap) => this.capabilities.has(cap))
  }
}
