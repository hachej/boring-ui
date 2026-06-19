import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"
import { RegistryProvider } from "../../../registry/RegistryProvider"
import { PanelRegistry } from "../../../registry/PanelRegistry"
import { CommandRegistry } from "../../../../shared/plugins/CommandRegistry"
import { SurfaceResolverRegistry } from "../../../../shared/plugins/SurfaceResolverRegistry"
import type { PaneProps } from "../../../registry/types"
import { WorkbenchLeftPane } from "../WorkbenchLeftPane"

function WorkspaceSourceWithButton({ containerApi }: PaneProps) {
  return (
    <button
      type="button"
      onClick={() => containerApi.addPanel({
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

function WorkspaceSourceWithUnsafeAddPanel({ containerApi }: PaneProps) {
  containerApi.addPanel({
    id: "unsafe-instance",
    component: "unsafe.panel",
    title: "Unsafe Panel",
  })
  return <div>unsafe rendered</div>
}

describe("WorkbenchLeftPane", () => {
  test("workspace-source panels can open shared panels through containerApi.addPanel", () => {
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("demo.left", {
      title: "Demo",
      placement: "workspace-source",
      component: WorkspaceSourceWithButton,
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
      params: { from: "workspace-source" },
    })
  })

  test("workspace-source containerApi.addPanel fails loudly when the host omitted onOpenPanel", () => {
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("demo.left", {
      title: "Demo",
      placement: "workspace-source",
      component: WorkspaceSourceWithUnsafeAddPanel,
    })

    render(
      <RegistryProvider
        panelRegistry={panelRegistry}
        commandRegistry={new CommandRegistry()}
        surfaceResolverRegistry={new SurfaceResolverRegistry()}
      >
        <WorkbenchLeftPane />
      </RegistryProvider>,
    )

    expect(screen.getByText(/containerApi\.addPanel/)).toBeInTheDocument()
  })

  test("selecting a category opens its associated default center panel", () => {
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("files", {
      title: "Files",
      placement: "workspace-source",
      component: () => <div>files body</div>,
    })
    panelRegistry.register("data.panel", {
      title: "Data Panel",
      placement: "center",
      component: () => <div>data center</div>,
    })
    panelRegistry.register("data.tab", {
      title: "Data",
      placement: "workspace-source",
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
        <WorkbenchLeftPane defaultTab="files" onOpenPanel={onOpenPanel} />
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
    panelRegistry.register("data.tab", {
      title: "Data",
      placement: "workspace-source",
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
      placement: "workspace-source",
      component: () => <div>files body</div>,
    })
    panelRegistry.register("data", {
      title: "Data",
      placement: "workspace-source",
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

  test("workspace-page entries act as rail launchers while the Files icon owns the file tree", () => {
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("files", {
      title: "Files",
      placement: "workspace-source",
      component: () => <div>file tree body</div>,
    })
    panelRegistry.register("macro.page", {
      title: "Macro",
      placement: "workspace-page",
      component: () => <div>macro page body</div>,
    })
    const onOpenPanel = vi.fn()
    const onCollapse = vi.fn()
    const onExpand = vi.fn()
    const onCloseSourcePane = vi.fn()

    render(
      <RegistryProvider
        panelRegistry={panelRegistry}
        commandRegistry={new CommandRegistry()}
        surfaceResolverRegistry={new SurfaceResolverRegistry()}
      >
        <WorkbenchLeftPane defaultTab="files" onOpenPanel={onOpenPanel} onCollapse={onCollapse} onExpand={onExpand} onCloseSourcePane={onCloseSourcePane} />
      </RegistryProvider>,
    )

    expect(screen.getByText("file tree body")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Macro" }))

    expect(onOpenPanel).toHaveBeenCalledWith({
      id: "macro.page",
      component: "macro.page",
      title: "Macro",
    })
    expect(onCollapse).not.toHaveBeenCalled()
    expect(onCloseSourcePane).toHaveBeenCalledTimes(1)
    expect(screen.queryByText("file tree body")).not.toBeInTheDocument()
    expect(screen.queryByText("macro page body")).not.toBeInTheDocument()
    expect(screen.getByText("Opened in the workspace.")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Files" }))

    expect(onExpand).toHaveBeenCalledTimes(1)
    expect(screen.getByText("file tree body")).toBeInTheDocument()
  })

  test("clicking the active source icon untoggles the source pane", () => {
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("files", {
      title: "Files",
      placement: "workspace-source",
      component: () => <div>file tree body</div>,
    })
    const onCloseSourcePane = vi.fn()

    render(
      <RegistryProvider
        panelRegistry={panelRegistry}
        commandRegistry={new CommandRegistry()}
        surfaceResolverRegistry={new SurfaceResolverRegistry()}
      >
        <WorkbenchLeftPane defaultTab="files" onCloseSourcePane={onCloseSourcePane} />
      </RegistryProvider>,
    )

    expect(screen.getByText("file tree body")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Files" }))

    expect(onCloseSourcePane).toHaveBeenCalledTimes(1)
  })

  test("rail-only mode keeps plugin and Files icons visible without rendering the file tree", () => {
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("files", {
      title: "Files",
      placement: "workspace-source",
      component: () => <div>file tree body</div>,
    })
    panelRegistry.register("full.page", {
      title: "Full Page",
      placement: "workspace-page",
      component: () => <div>full page body</div>,
    })
    const onOpenPanel = vi.fn()
    const onCollapse = vi.fn()
    const onExpand = vi.fn()
    const onCloseSourcePane = vi.fn()

    render(
      <RegistryProvider
        panelRegistry={panelRegistry}
        commandRegistry={new CommandRegistry()}
        surfaceResolverRegistry={new SurfaceResolverRegistry()}
      >
        <WorkbenchLeftPane defaultTab="files" railOnly onOpenPanel={onOpenPanel} onCollapse={onCollapse} onExpand={onExpand} onCloseSourcePane={onCloseSourcePane} />
      </RegistryProvider>,
    )

    expect(screen.getByRole("button", { name: "Files" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Full Page" })).toBeInTheDocument()
    expect(screen.queryByText("file tree body")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Full Page" }))
    expect(onOpenPanel).toHaveBeenCalledWith({
      id: "full.page",
      component: "full.page",
      title: "Full Page",
    })
    expect(onCollapse).not.toHaveBeenCalled()
    expect(onCloseSourcePane).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole("button", { name: "Hide workspace menu" }))
    expect(onCollapse).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole("button", { name: "Files" }))
    expect(onExpand).toHaveBeenCalledTimes(1)
  })

  test("icon-less categories fall back to an initial-letter glyph", () => {
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("files", {
      title: "Files",
      placement: "workspace-source",
      component: () => <div>files body</div>,
    })
    panelRegistry.register("data", {
      title: "Data",
      placement: "workspace-source",
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
