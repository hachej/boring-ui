import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"
import { RegistryProvider } from "../../../registry/RegistryProvider"
import { PanelRegistry } from "../../../registry/PanelRegistry"
import { CommandRegistry } from "../../../../shared/plugins/CommandRegistry"
import { SurfaceResolverRegistry } from "../../../../shared/plugins/SurfaceResolverRegistry"
import type { PaneProps } from "../../../registry/types"
import { WorkbenchLeftPane } from "../WorkbenchLeftPane"
import { useWorkspaceLeftPaneActions, type WorkspaceLeftPaneOpenPanelConfig } from "../useWorkspaceLeftPaneActions"

function LeftTabWithButton({ containerApi }: PaneProps) {
  return (
    <button
      type="button"
      onClick={() => containerApi.addPanel({
        id: "demo-instance",
        component: "demo.panel",
        title: "Demo Panel",
        params: { from: "left-tab" },
      })}
    >
      Open demo panel
    </button>
  )
}

function HostExplorer({ onOpenPanel }: { onOpenPanel: (config: WorkspaceLeftPaneOpenPanelConfig) => void }) {
  const actions = useWorkspaceLeftPaneActions({ onOpenPanel })
  return (
    <aside aria-label="Host explorer">
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          aria-label={`Host ${action.title}`}
          aria-current={action.active ? "page" : undefined}
          onClick={action.select}
        >
          {action.icon}
          {action.title}
        </button>
      ))}
    </aside>
  )
}

describe("WorkbenchLeftPane", () => {
  test("left-tab panels can open center panels through containerApi.addPanel", () => {
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("demo.left", {
      title: "Demo",
      placement: "left-tab",
      component: LeftTabWithButton,
    })
    const onOpenPanel = vi.fn()

    render(
      <RegistryProvider
        panelRegistry={panelRegistry}
        commandRegistry={new CommandRegistry()}
        surfaceResolverRegistry={new SurfaceResolverRegistry()}
      >
        <WorkbenchLeftPane onOpenPanel={onOpenPanel} />
      </RegistryProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Open demo panel" }))

    expect(onOpenPanel).toHaveBeenCalledWith({
      id: "demo-instance",
      component: "demo.panel",
      title: "Demo Panel",
      params: { from: "left-tab" },
    })
  })

  test("selecting a category opens its associated default center panel", () => {
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("data.panel", {
      title: "Data Panel",
      placement: "center",
      component: () => <div>data center</div>,
    })
    panelRegistry.register("data.tab", {
      title: "Data",
      placement: "left-tab",
      defaultPanelId: "data.panel",
      component: () => <div>data body</div>,
    })
    const onOpenPanel = vi.fn()

    render(
      <RegistryProvider
        panelRegistry={panelRegistry}
        commandRegistry={new CommandRegistry()}
        surfaceResolverRegistry={new SurfaceResolverRegistry()}
      >
        <WorkbenchLeftPane onOpenPanel={onOpenPanel} />
      </RegistryProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Data" }))

    expect(onOpenPanel).toHaveBeenCalledWith({
      id: "data.panel",
      component: "data.panel",
      title: "Data Panel",
    })
  })

  test("host explorers can render category actions without mounting the default left pane", () => {
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("files", {
      title: "Files",
      placement: "left-tab",
      component: () => <div>files body</div>,
    })
    panelRegistry.register("data.panel", {
      title: "Data Panel",
      placement: "center",
      component: () => <div>data center</div>,
    })
    panelRegistry.register("data", {
      title: "Data",
      placement: "left-tab",
      defaultPanelId: "data.panel",
      component: () => <div>data body</div>,
    })
    const onOpenPanel = vi.fn()

    render(
      <RegistryProvider
        panelRegistry={panelRegistry}
        commandRegistry={new CommandRegistry()}
        surfaceResolverRegistry={new SurfaceResolverRegistry()}
      >
        <HostExplorer onOpenPanel={onOpenPanel} />
      </RegistryProvider>,
    )

    expect(screen.getByRole("complementary", { name: "Host explorer" })).toBeInTheDocument()
    expect(screen.queryByRole("navigation", { name: "Workspace categories" })).not.toBeInTheDocument()
    const filesButton = screen.getByRole("button", { name: "Host Files" })
    const dataButton = screen.getByRole("button", { name: "Host Data" })
    expect(filesButton).toHaveAttribute("aria-current", "page")
    expect(dataButton).not.toHaveAttribute("aria-current")

    fireEvent.click(dataButton)

    expect(dataButton).toHaveAttribute("aria-current", "page")
    expect(onOpenPanel).toHaveBeenCalledWith({
      id: "data.panel",
      component: "data.panel",
      title: "Data Panel",
    })
  })

  test("right-clicking a category reloads agent plugins", () => {
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("data.tab", {
      title: "Data",
      placement: "left-tab",
      component: () => <div>data body</div>,
    })
    const onReloadAgentPlugins = vi.fn()

    render(
      <RegistryProvider
        panelRegistry={panelRegistry}
        commandRegistry={new CommandRegistry()}
        surfaceResolverRegistry={new SurfaceResolverRegistry()}
      >
        <WorkbenchLeftPane onReloadAgentPlugins={onReloadAgentPlugins} />
      </RegistryProvider>,
    )

    fireEvent.contextMenu(screen.getByRole("button", { name: "Data" }))

    expect(onReloadAgentPlugins).toHaveBeenCalledTimes(1)
  })

  test("categories render as a rail with a calm active state and menu collapse", () => {
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("files", {
      title: "Files",
      placement: "left-tab",
      component: () => <div>files body</div>,
    })
    panelRegistry.register("data", {
      title: "Data",
      placement: "left-tab",
      component: () => <div>data body</div>,
    })
    const onCollapse = vi.fn()

    render(
      <RegistryProvider
        panelRegistry={panelRegistry}
        commandRegistry={new CommandRegistry()}
        surfaceResolverRegistry={new SurfaceResolverRegistry()}
      >
        <WorkbenchLeftPane defaultTab="files" onCollapse={onCollapse} />
      </RegistryProvider>,
    )

    const rail = screen.getByRole("navigation", { name: "Workspace categories" })
    expect(rail).toBeInTheDocument()
    const filesButton = screen.getByRole("button", { name: "Files" })
    const dataButton = screen.getByRole("button", { name: "Data" })
    expect(filesButton).toHaveAttribute("aria-pressed", "true")
    expect(dataButton).toHaveAttribute("aria-pressed", "false")
    // No accent stripe: the active state is the shared grey surface.
    expect(filesButton.className).not.toContain("accent")

    fireEvent.click(dataButton)
    expect(dataButton).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("data body")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Hide workspace menu" }))
    expect(onCollapse).toHaveBeenCalled()
  })

  test("icon-less categories fall back to an initial-letter glyph", () => {
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("files", {
      title: "Files",
      placement: "left-tab",
      component: () => <div>files body</div>,
    })
    panelRegistry.register("data", {
      title: "Data",
      placement: "left-tab",
      component: () => <div>data body</div>,
    })

    render(
      <RegistryProvider
        panelRegistry={panelRegistry}
        commandRegistry={new CommandRegistry()}
        surfaceResolverRegistry={new SurfaceResolverRegistry()}
      >
        <WorkbenchLeftPane defaultTab="files" />
      </RegistryProvider>,
    )

    // Neither panel registers an icon: each rail button shows its own
    // initial instead of a shared generic glyph.
    const filesButton = screen.getByRole("button", { name: "Files" })
    const dataButton = screen.getByRole("button", { name: "Data" })
    expect(filesButton.querySelector('[data-boring-workspace-part="category-initial"]')?.textContent).toBe("F")
    expect(dataButton.querySelector('[data-boring-workspace-part="category-initial"]')?.textContent).toBe("D")
  })
})
