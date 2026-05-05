import { createElement, lazy, Suspense, type ComponentType } from "react"
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
    // Auto-detect lazy: factories are zero-arg arrow functions (() => import(...));
    // panel components always take a props argument, so .length >= 1.
    const isFactory = typeof config.component === "function" && config.component.length === 0
    const existed = this.panels.has(id)
    this.panels.set(id, { ...config, id, lazy: config.lazy ?? isFactory } as PanelConfig)
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
      // biome-ignore lint/suspicious/noExplicitAny: see comment above
      let Inner: ComponentType<any>
      if (panel.lazy) {
        Inner = lazy(
          panel.component as () => Promise<{ default: ComponentType<unknown> }>,
        )
      } else {
        Inner = panel.component as ComponentType<any>
      }
      const pluginId = panel.pluginId ?? panel.id
      const panelId = panel.id
      const isLazy = panel.lazy
      // biome-ignore lint/suspicious/noExplicitAny: dockview props passthrough
      result[panel.id] = function WrappedPanel(props: any) {
        const inner = createElement(Inner, props)
        return createElement(
          PluginErrorBoundary,
          { pluginId, contributionKind: "panel" as const, contributionId: panelId },
          isLazy
            ? createElement(Suspense, { fallback: createElement(PanelLoadingFallback) }, inner)
            : inner,
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

function PanelLoadingFallback() {
  return createElement("div", {
    style: { display: "flex", height: "100%", alignItems: "center", justifyContent: "center" },
    className: "text-sm text-muted-foreground animate-pulse",
  }, "Loading…")
}
