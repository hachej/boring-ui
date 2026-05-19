import type { CatalogConfig } from "../../shared/plugins/types"

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

  /**
   * Atomic replace by pluginId: drop owned catalogs and register the new
   * set in one emit. Pi parity for reload semantics.
   *
   * Collision policy: a new catalog id already owned by a DIFFERENT pluginId
   * is skipped with a warning — same posture as `register`'s warnOnDuplicate
   * but never silently overwriting another plugin's contribution.
   */
  replaceByPluginId(pluginId: string, catalogs: CatalogConfig[]): void {
    const ownedIds = new Set<string>()
    for (const [id, catalog] of this.catalogs) {
      if (catalog.pluginId === pluginId) ownedIds.add(id)
    }
    if (ownedIds.size === 0 && catalogs.length === 0) return

    let changed = ownedIds.size > 0
    for (const id of ownedIds) this.catalogs.delete(id)
    for (const config of catalogs) {
      const existing = this.catalogs.get(config.id)
      if (existing && existing.pluginId !== pluginId) {
        // eslint-disable-next-line no-console
        console.warn(
          `[CatalogRegistry] plugin "${pluginId}" tried to register catalog "${config.id}" already owned by "${existing.pluginId ?? 'system'}" — skipped`,
        )
        continue
      }
      this.catalogs.set(config.id, { ...config, pluginId })
      changed = true
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
