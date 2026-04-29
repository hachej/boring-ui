import type { CatalogConfig } from "../../shared/plugin/types"

export interface CatalogRegistryOptions {
  warnOnDuplicate?: boolean
}

function defaultWarnOnDuplicate(): boolean {
  return Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV)
}

export class CatalogRegistry {
  private catalogs = new Map<string, CatalogConfig>()
  private listeners = new Set<() => void>()
  private snapshotCache: readonly CatalogConfig[] | null = null
  private warnOnDuplicate: boolean

  constructor(options: CatalogRegistryOptions = {}) {
    this.warnOnDuplicate = options.warnOnDuplicate ?? defaultWarnOnDuplicate()
  }

  register(config: CatalogConfig, sourcePluginId: string): void {
    if (this.catalogs.has(config.id) && this.warnOnDuplicate) {
      console.warn(
        `[CatalogRegistry] catalog "${config.id}" registered by "${sourcePluginId}" overrides previous registration`,
      )
    }
    this.catalogs.set(config.id, { ...config, pluginId: sourcePluginId })
    this.emit()
  }

  unregister(id: string): void {
    if (this.catalogs.delete(id)) this.emit()
  }

  unregisterByPluginId(pluginId: string): void {
    let changed = false
    for (const [id, catalog] of this.catalogs) {
      if (catalog.pluginId === pluginId) {
        this.catalogs.delete(id)
        changed = true
      }
    }
    if (changed) this.emit()
  }

  list(): readonly CatalogConfig[] {
    return this.getSnapshot()
  }

  get(id: string): CatalogConfig | undefined {
    return this.catalogs.get(id)
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  getSnapshot = (): readonly CatalogConfig[] => {
    if (!this.snapshotCache) {
      this.snapshotCache = Array.from(this.catalogs.values())
    }
    return this.snapshotCache
  }

  private emit(): void {
    this.snapshotCache = null
    for (const cb of [...this.listeners]) cb()
  }
}
