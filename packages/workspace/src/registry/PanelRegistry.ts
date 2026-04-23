import { lazy, type ComponentType } from "react"
import type { PanelConfig, PanelRegistration } from "./types"

export class PanelRegistry {
  private panels = new Map<string, PanelConfig>()
  private registrationOrder: string[] = []
  private capabilities: Set<string>

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

  getComponents(): Record<string, ComponentType<unknown>> {
    const result: Record<string, ComponentType<unknown>> = {}
    for (const panel of this.filteredPanels()) {
      if (panel.lazy) {
        result[panel.id] = lazy(
          panel.component as () => Promise<{ default: ComponentType<unknown> }>
        )
      } else {
        result[panel.id] = panel.component as ComponentType<unknown>
      }
    }
    return result
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
  return filename === pattern
}
