import { createElement, lazy, useMemo, useSyncExternalStore, type ComponentType } from "react"
import type { PanelConfig, PanelRegistration } from "./types"
import { PluginErrorBoundary } from "../plugin/PluginErrorBoundary"

export class PanelRegistry {
  private panels = new Map<string, PanelConfig>()
  private registrationOrder: string[] = []
  private capabilities: Set<string>
  private listeners = new Set<() => void>()
  private snapshotCache: readonly PanelConfig[] | null = null

  constructor(capabilities: Record<string, boolean> = {}) {
    this.capabilities = new Set(
      Object.entries(capabilities)
        .filter(([, v]) => v)
        .map(([k]) => k)
    )
  }

  register(id: string, config: PanelRegistration): void {
    const existed = this.panels.has(id)
    this.panels.set(id, { ...config, id } as PanelConfig)
    if (!existed) {
      this.registrationOrder.push(id)
    }
    this.emit()
  }

  unregisterByPluginId(pluginId: string): void {
    let changed = false
    for (const [id, panel] of this.panels) {
      if (panel.pluginId === pluginId) {
        this.panels.delete(id)
        this.registrationOrder = this.registrationOrder.filter((oid) => oid !== id)
        changed = true
      }
    }
    if (changed) this.emit()
  }

  get(id: string): PanelConfig | undefined {
    return this.panels.get(id)
  }

  has(id: string): boolean {
    return this.panels.has(id)
  }

  list(): PanelConfig[] {
    return this.filteredPanels()
  }

  // Loose return type: shells render panels via different paths (dockview
  // hands a typed envelope, sidebar layouts mount them naked). Type-safe
  // wiring happens at registration time via `definePanel<T>` — once a
  // panel is in the registry, the SHELL is responsible for handing it
  // the right props for its render context.
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  getComponents(): Record<string, ComponentType<any>> {
    // biome-ignore lint/suspicious/noExplicitAny: see comment above
    const result: Record<string, ComponentType<any>> = {}
    for (const panel of this.filteredPanels()) {
      const panelId = panel.id
      const registry = this
      // biome-ignore lint/suspicious/noExplicitAny: dockview props passthrough
      result[panel.id] = function WrappedPanel(props: any) {
        useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot)
        const current = registry.get(panelId)
        // biome-ignore lint/suspicious/noExplicitAny: see comment above
        const Inner: ComponentType<any> = useMemo(() => {
          if (!current) return () => null
          if (current.lazy) {
            return lazy(
              current.component as () => Promise<{ default: ComponentType<unknown> }>,
            )
          }
          return current.component as ComponentType<any>
        }, [current?.component, current?.lazy])
        const pluginId = current?.pluginId ?? current?.id ?? panelId
        return createElement(
          PluginErrorBoundary,
          { pluginId, contributionKind: "panel" as const, contributionId: panelId, children: createElement(Inner, props) },
        )
      }
    }
    return result
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  getSnapshot = (): readonly PanelConfig[] => {
    if (!this.snapshotCache) {
      this.snapshotCache = this.filteredPanels()
    }
    return this.snapshotCache
  }

  private emit(): void {
    this.snapshotCache = null
    for (const cb of [...this.listeners]) cb()
  }

  private filteredPanels(): PanelConfig[] {
    return this.registrationOrder
      .map((id) => this.panels.get(id)!)
      .filter((p) => this.satisfiesCapabilities(p))
  }

  private satisfiesCapabilities(panel: PanelConfig): boolean {
    if (!panel.requiresCapabilities?.length) return true
    return panel.requiresCapabilities.every((cap) => this.capabilities.has(cap))
  }
}
