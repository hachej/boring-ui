/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ComponentType } from "react"
import type { BoringFrontAPI, BoringFrontPanelRegistration, PaneProps } from "@hachej/boring-workspace/plugin"
import { BORING_MCP_SOURCES_PANEL_ID, type McpSourceStatusPayload } from "../shared"
import { createBoringMcpPlugin, type CreateBoringMcpPluginOptions } from "../front"

function renderSourcesPanel(options: CreateBoringMcpPluginOptions = {}) {
  const panels: BoringFrontPanelRegistration<any>[] = []
  const api: BoringFrontAPI = {
    registerPanel: (panel) => { panels.push(panel) },
    registerPanelCommand: vi.fn(),
    registerProvider: vi.fn(),
    registerBinding: vi.fn(),
    registerCatalog: vi.fn(),
    registerWorkspaceSource: vi.fn(),
    registerSurfaceResolver: vi.fn(),
    registerToolRenderer: vi.fn(),
  }
  createBoringMcpPlugin({ enabledProviderIds: ["notion"], ...options })(api)
  const panel = panels.find((item) => item.id === BORING_MCP_SOURCES_PANEL_ID)
  if (!panel || typeof panel.component !== "function") throw new Error("Sources panel was not registered")
  const Component = panel.component as ComponentType<PaneProps>
  return render(<Component api={{} as PaneProps["api"]} containerApi={{} as PaneProps["containerApi"]} params={undefined} />)
}

const connectedNotion: McpSourceStatusPayload = {
  source: {
    id: "source:notion:user-1",
    provider: "notion",
    displayName: "Notion",
    status: "connected",
    ownerKind: "user",
    credentialProvider: "composio-managed",
    providerAccountLabel: "demo@example.com",
    lastVerifiedAt: "2026-07-01T05:00:00.000Z",
    connectorRef: { provider: "notion", toolkitId: "notion" },
  },
  connectable: false,
  canProbe: true,
  canDisconnect: true,
}

afterEach(() => cleanup())

describe("boring-mcp front sources panel", () => {
  it("shows admin setup required instead of a dead connect placeholder when actions are not wired", () => {
    renderSourcesPanel({ connectionUnavailableMessage: "Source API is not wired yet." })

    expect(screen.getByText("Notion")).toBeInTheDocument()
    expect(screen.getByText("No account connected yet.")).toBeInTheDocument()
    expect(screen.getByText("Source API is not wired yet.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Admin setup required" })).toBeDisabled()
    expect(screen.queryByRole("button", { name: "Connect through app backend" })).not.toBeInTheDocument()
  })

  it("shows Connect for unconnected providers and calls the host connect action", () => {
    const onConnect = vi.fn()
    renderSourcesPanel({ sourceActions: { onConnect } })

    fireEvent.click(screen.getByRole("button", { name: "Connect" }))

    expect(onConnect).toHaveBeenCalledWith("notion")
  })

  it("updates rendered source status when a refresh action returns fresh status", async () => {
    const unconfiguredNotion: McpSourceStatusPayload = {
      ...connectedNotion,
      source: { ...connectedNotion.source, status: "unconfigured", providerAccountLabel: undefined, lastVerifiedAt: undefined },
      connectable: true,
      canProbe: false,
    }
    const onRefreshStatus = vi.fn(async () => connectedNotion)
    renderSourcesPanel({ sourceStatuses: [unconfiguredNotion], sourceActions: { onRefreshStatus } })

    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }))

    expect(await screen.findByText("Connected")).toBeInTheDocument()
    expect(screen.getByText(/demo@example\.com/)).toBeInTheDocument()
  })

  it("surfaces action failures without leaving the user at a silent dead button", async () => {
    const onConnect = vi.fn(() => { throw new Error("OAuth popup blocked") })
    renderSourcesPanel({ sourceActions: { onConnect } })

    fireEvent.click(screen.getByRole("button", { name: "Connect" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("OAuth popup blocked")
    expect(screen.getByRole("button", { name: "Connect" })).not.toBeDisabled()
  })

  it("honors connectable false from source status", () => {
    const expiredNotion: McpSourceStatusPayload = {
      ...connectedNotion,
      source: { ...connectedNotion.source, status: "expired" },
      connectable: false,
      canProbe: false,
    }
    renderSourcesPanel({ sourceStatuses: [expiredNotion], sourceActions: { onConnect: vi.fn() } })

    expect(screen.getByRole("button", { name: "Reconnect" })).toBeDisabled()
    expect(screen.getByText("This source cannot start a new connection in its current state. Refresh status or disconnect first.")).toBeInTheDocument()
  })

  it("shows connected account details with distinct view, refresh, and disconnect actions", () => {
    const onViewTools = vi.fn()
    const onRefreshStatus = vi.fn()
    const onDisconnect = vi.fn()
    renderSourcesPanel({
      sourceStatuses: [connectedNotion],
      sourceActions: { onViewTools, onRefreshStatus, onDisconnect },
    })

    expect(screen.getByText("Connected")).toBeInTheDocument()
    expect(screen.getByText(/demo@example\.com/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "View tools" }))
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }))
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }))

    expect(onViewTools).toHaveBeenCalledWith("source:notion:user-1", "notion")
    expect(onRefreshStatus).toHaveBeenCalledWith("source:notion:user-1", "notion")
    expect(onDisconnect).toHaveBeenCalledWith("source:notion:user-1", "notion")
  })
})
