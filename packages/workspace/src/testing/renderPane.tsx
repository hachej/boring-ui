import { cloneElement, isValidElement, type ReactElement } from "react"
import { render, type RenderOptions, type RenderResult } from "@testing-library/react"
import type { PanelRegistry } from "../registry/PanelRegistry"
import { TestWorkspaceProvider } from "./TestWorkspaceProvider"
import { createMockBridge, type MockWorkspaceBridge } from "./createMockBridge"
import { createMockRegistry } from "./createMockRegistry"
import type { MockDataFixtures } from "./mockApi"

export interface RenderPaneOptions extends Omit<RenderOptions, "wrapper"> {
  fixtures?: MockDataFixtures
  bridge?: MockWorkspaceBridge
  registry?: PanelRegistry
  apiBaseUrl?: string
  authHeaders?: Record<string, string>
  defaultTheme?: "light" | "dark"
  injectBridgeProp?: boolean
}

export type RenderPaneResult = RenderResult & {
  bridge: MockWorkspaceBridge
  registry: PanelRegistry
}

export function renderPane(
  ui: ReactElement,
  options: RenderPaneOptions = {},
): RenderPaneResult {
  const {
    fixtures,
    bridge = createMockBridge(),
    registry = createMockRegistry(),
    apiBaseUrl,
    authHeaders,
    defaultTheme,
    injectBridgeProp = true,
    ...renderOptions
  } = options

  const wrapped =
    injectBridgeProp
    && isValidElement(ui)
    && typeof ui.type !== "string"
    && !(ui.props as Record<string, unknown>).bridge
      ? cloneElement(ui, { bridge } as Record<string, unknown>)
      : ui

  const result = render(
    <TestWorkspaceProvider
      fixtures={fixtures}
      bridge={bridge}
      registry={registry}
      apiBaseUrl={apiBaseUrl}
      authHeaders={authHeaders}
      defaultTheme={defaultTheme}
    >
      {wrapped}
    </TestWorkspaceProvider>,
    renderOptions,
  )

  return Object.assign(result, { bridge, registry })
}
