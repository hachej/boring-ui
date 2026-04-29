import { createElement, lazy, type ComponentType } from "react"
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

  resolve(filename: string): PanelConfig | undefined {
    let bestMatch: PanelConfig | undefined
    let bestLength = -1

    for (const id of this.registrationOrder) {
      const panel = this.panels.get(id)!
      if (!panel.filePatterns) continue
      if (!this.satisfiesCapabilities(panel)) continue

      for (const pattern of panel.filePatterns) {
        if (matchGlob(pattern, filename)) {
          const suffixLen = pattern === "*" ? 0 : pattern.replace(/^\*/, "").length
          const dominated =
            suffixLen > bestLength ||
            (suffixLen === bestLength &&
              panel.source === "app" &&
              bestMatch?.source !== "app")
          if (dominated) {
            bestLength = suffixLen
            bestMatch = panel
          }
        }
      }
    }
    return bestMatch
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
        Inner = panel.component
      }
      const pluginId = panel.pluginId ?? panel.id
      const panelId = panel.id
      // biome-ignore lint/suspicious/noExplicitAny: dockview props passthrough
      result[panel.id] = function WrappedPanel(props: any) {
        return createElement(
          PluginErrorBoundary,
          { pluginId, contributionKind: "panel" as const, contributionId: panelId },
          createElement(Inner, props),
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


function matchGlob(pattern: string, filename: string): boolean {
  if (pattern === "*") return true
  if (pattern.startsWith("*")) {
    return filename.endsWith(pattern.slice(1))
  }
  const star = pattern.indexOf("*")
  if (star > 0) {
    const head = pattern.slice(0, star)
    const tail = pattern.slice(star + 1)
    if (!filename.startsWith(head)) return false
    if (!filename.endsWith(tail)) return false
    const middle = filename.slice(head.length, filename.length - tail.length)
    return !middle.includes("/")
  }
  return filename === pattern
}
