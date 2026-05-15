import { Suspense, createElement, lazy, useMemo, useSyncExternalStore, type ComponentType } from "react"
import type { PanelConfig, PanelRegistration } from "./types"
import { PluginErrorBoundary } from "../plugin/PluginErrorBoundary"

export class PanelRegistry {
  private panels = new Map<string, PanelConfig>()
  private registrationOrder: string[] = []
  private capabilities: Set<string>
  private listeners = new Set<() => void>()
  private snapshotCache: readonly PanelConfig[] | null = null
  // React.lazy types must be stable across initial Suspense retries. If a
  // lazy type is created inside a render that suspends before commit, React
  // can retry by calling the wrapper again and lose hook memo state, creating
  // a fresh lazy type and re-suspending forever. Cache by panel id + importer.
  // Hot reload still swaps because replacement registrations get a new
  // importer function reference.
  private lazyComponentCache = new Map<string, { importer: unknown; component: ComponentType<any> }>()
  private wrapperComponentCache = new Map<string, ComponentType<any>>()

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
        this.lazyComponentCache.delete(id)
        this.wrapperComponentCache.delete(id)
        this.registrationOrder = this.registrationOrder.filter((oid) => oid !== id)
        changed = true
      }
    }
    if (changed) this.emit()
  }

  unregister(id: string): void {
    if (!this.panels.delete(id)) return
    this.lazyComponentCache.delete(id)
    this.wrapperComponentCache.delete(id)
    this.registrationOrder = this.registrationOrder.filter((oid) => oid !== id)
    this.emit()
  }

  /**
   * Atomic replace: unregister all panels owned by `pluginId`, then register
   * the new set, in one emit cycle. Subscribers see exactly one intermediate
   * state — never an empty registry between unregister and re-register.
   *
   * Collision policy: a new registration whose id is already owned by a
   * DIFFERENT pluginId is skipped with a warning. Preserves cross-plugin
   * isolation during reload — a renamed plugin can't silently steal another
   * plugin's panel id.
   *
   * Pi parity (`core/agent-session.js:1896` reload): teardown + rebuild as a
   * single observable transition. Used by Phase 5 reload wiring.
   */
  replaceByPluginId(pluginId: string, panels: PanelConfig[]): void {
    const ownedIds = new Set<string>()
    for (const [id, panel] of this.panels) {
      if (panel.pluginId === pluginId) ownedIds.add(id)
    }
    if (ownedIds.size === 0 && panels.length === 0) return

    for (const id of ownedIds) {
      this.panels.delete(id)
      this.lazyComponentCache.delete(id)
      this.wrapperComponentCache.delete(id)
    }
    if (ownedIds.size > 0) {
      this.registrationOrder = this.registrationOrder.filter((oid) => this.panels.has(oid))
    }
    for (const config of panels) {
      const id = config.id
      if (!id) continue
      const existing = this.panels.get(id)
      if (existing && existing.pluginId && existing.pluginId !== pluginId) {
        // eslint-disable-next-line no-console
        console.warn(
          `[PanelRegistry] plugin "${pluginId}" tried to register panel "${id}" already owned by "${existing.pluginId}" — skipped`,
        )
        continue
      }
      this.panels.set(id, { ...config, id, pluginId })
      if (!this.registrationOrder.includes(id)) this.registrationOrder.push(id)
    }
    this.emit()
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

  listAll(): PanelConfig[] {
    return this.registrationOrder.map((id) => this.panels.get(id)!)
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
      result[panel.id] = this.getWrappedComponent(panel.id)
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

  private getWrappedComponent(panelId: string): ComponentType<any> {
    const cached = this.wrapperComponentCache.get(panelId)
    if (cached) return cached
    const registry = this
    // biome-ignore lint/suspicious/noExplicitAny: dockview props passthrough
    const WrappedPanel = function WrappedPanel(props: any) {
      useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot)
      const current = registry.get(panelId)
      // biome-ignore lint/suspicious/noExplicitAny: see comment above
      const Inner: ComponentType<any> = useMemo(() => {
        if (!current || !registry.satisfiesCapabilities(current)) return () => null
        if (current.lazy) return registry.getLazyComponent(panelId, current.component)
        return current.component as ComponentType<any>
      }, [current?.component, current?.lazy, current?.requiresCapabilities])
      const pluginId = current?.pluginId ?? current?.id ?? panelId
      return createElement(
        PluginErrorBoundary,
        {
          pluginId,
          contributionKind: "panel" as const,
          contributionId: panelId,
          children: createElement(
            Suspense,
            {
              fallback: createElement(
                "div",
                { className: "flex h-full items-center justify-center text-sm text-muted-foreground" },
                "Loading…",
              ),
              children: createElement(Inner, props),
            },
          ),
        },
      )
    }
    this.wrapperComponentCache.set(panelId, WrappedPanel)
    return WrappedPanel
  }

  private getLazyComponent(
    panelId: string,
    importer: PanelConfig["component"],
  ): ComponentType<any> {
    const cached = this.lazyComponentCache.get(panelId)
    if (cached?.importer === importer) return cached.component
    const component = lazy(
      importer as () => Promise<{ default: ComponentType<unknown> }>,
    ) as ComponentType<any>
    this.lazyComponentCache.set(panelId, { importer, component })
    return component
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
