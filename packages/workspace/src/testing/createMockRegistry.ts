import { createElement } from "react"
import { PanelRegistry } from "../front/registry/PanelRegistry"
import { definePanel, type PanelConfig } from "../front/registry/types"

function DefaultMockPanel() {
  return createElement(
    "div",
    { "data-testid": "workspace-testing-default-panel" },
    "workspace-testing-default-panel",
  )
}

const DEFAULT_PANELS: PanelConfig[] = [
  definePanel({
    id: "workspace-testing-default-panel",
    title: "Workspace Test Panel",
    component: DefaultMockPanel,
    source: "app",
    placement: "center",
  }),
]

export interface CreateMockRegistryOptions {
  panels?: PanelConfig[]
  capabilities?: Record<string, boolean>
}

export function createMockRegistry(options: CreateMockRegistryOptions = {}): PanelRegistry {
  const registry = new PanelRegistry(options.capabilities)
  const panels = options.panels ?? DEFAULT_PANELS

  for (const panel of panels) {
    const { id, ...config } = panel
    registry.register(id, config)
  }

  return registry
}
