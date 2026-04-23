import { createElement, type ComponentType } from "react"
import { PanelRegistry } from "../registry/PanelRegistry"
import type { PanelConfig } from "../registry/types"

function DefaultMockPanel() {
  return createElement(
    "div",
    { "data-testid": "workspace-testing-default-panel" },
    "workspace-testing-default-panel",
  )
}

const DEFAULT_PANELS: PanelConfig[] = [
  {
    id: "workspace-testing-default-panel",
    title: "Workspace Test Panel",
    component: DefaultMockPanel as ComponentType<unknown>,
    source: "app",
    placement: "center",
  },
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
