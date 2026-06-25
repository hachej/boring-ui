import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"
import { RegistryProvider } from "../../../registry/RegistryProvider"
import { PanelRegistry } from "../../../registry/PanelRegistry"
import { WorkspaceSourceRegistry } from "../../../registry/WorkspaceSourceRegistry"
import { CommandRegistry } from "../../../../shared/plugins/CommandRegistry"
import { SurfaceResolverRegistry } from "../../../../shared/plugins/SurfaceResolverRegistry"
import type { WorkspaceSourceProps } from "../../../registry/types"
import { WorkbenchLeftPane } from "../WorkbenchLeftPane"

function SourceWithButton({ openPanel }: WorkspaceSourceProps) {
  return (
    <button
      type="button"
      onClick={() => openPanel?.({
        id: "demo-instance",
        component: "demo.panel",
        title: "Demo Panel",
        params: { from: "workspace-source" },
      })}
    >
      Open demo panel
    </button>
  )
}

describe("WorkbenchLeftPane", () => {
  test("workspace sources can open center panels through openPanel", () => {
    const panelRegistry = new PanelRegistry()
    const workspaceSourceRegistry = new WorkspaceSourceRegistry()
    workspaceSourceRegistry.register("demo.source", {
      title: "Demo",
      component: SourceWithButton,
    })
    const onOpenPanel = vi.fn()

    render(
      <RegistryProvider
        panelRegistry={panelRegistry}
        workspaceSourceRegistry={workspaceSourceRegistry}
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
      params: { from: "workspace-source" },
    })
  })

  test("selecting a category opens its associated default center panel", () => {
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("data.panel", {
      title: "Data Panel",
      placement: "center",
      component: () => <div>data center</div>,
    })
    const workspaceSourceRegistry = new WorkspaceSourceRegistry()
    workspaceSourceRegistry.register("data.source", {
      title: "Data",
      defaultPanelId: "data.panel",
      component: () => <div>data body</div>,
    })
    const onOpenPanel = vi.fn()

    render(
      <RegistryProvider
        panelRegistry={panelRegistry}
        workspaceSourceRegistry={workspaceSourceRegistry}
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

  test("right-clicking a category reloads agent plugins", () => {
    const panelRegistry = new PanelRegistry()
    const workspaceSourceRegistry = new WorkspaceSourceRegistry()
    workspaceSourceRegistry.register("data.source", {
      title: "Data",
      component: () => <div>data body</div>,
    })
    const onReloadAgentPlugins = vi.fn()

    render(
      <RegistryProvider
        panelRegistry={panelRegistry}
        workspaceSourceRegistry={workspaceSourceRegistry}
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
    const workspaceSourceRegistry = new WorkspaceSourceRegistry()
    workspaceSourceRegistry.register("files", {
      title: "Files",
      component: () => <div>files body</div>,
    })
    workspaceSourceRegistry.register("data", {
      title: "Data",
      component: () => <div>data body</div>,
    })
    const onCollapse = vi.fn()

    render(
      <RegistryProvider
        panelRegistry={panelRegistry}
        workspaceSourceRegistry={workspaceSourceRegistry}
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
    const workspaceSourceRegistry = new WorkspaceSourceRegistry()
    workspaceSourceRegistry.register("files", {
      title: "Files",
      component: () => <div>files body</div>,
    })
    workspaceSourceRegistry.register("data", {
      title: "Data",
      component: () => <div>data body</div>,
    })

    render(
      <RegistryProvider
        panelRegistry={panelRegistry}
        workspaceSourceRegistry={workspaceSourceRegistry}
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
