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
import { useWorkspaceLeftPaneActions, type WorkspaceLeftPaneOpenPanelConfig } from "../useWorkspaceLeftPaneActions"

function renderLeftPane({
  panels = new PanelRegistry(),
  sources = new WorkspaceSourceRegistry(),
  children,
}: {
  panels?: PanelRegistry
  sources?: WorkspaceSourceRegistry
  children: React.ReactNode
}) {
  return render(
    <RegistryProvider
      panelRegistry={panels}
      workspaceSourceRegistry={sources}
      commandRegistry={new CommandRegistry()}
      surfaceResolverRegistry={new SurfaceResolverRegistry()}
    >
      {children}
    </RegistryProvider>,
  )
}

function WorkspaceSourceWithButton({ openPanel }: WorkspaceSourceProps) {
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
  test("workspace sources can open shared panels through explicit openPanel", () => {
    const sources = new WorkspaceSourceRegistry()
    sources.register("demo.left", {
      title: "Demo",
      component: WorkspaceSourceWithButton,
    })
    const onOpenPanel = vi.fn()

    renderLeftPane({ sources, children: <WorkbenchLeftPane onOpenPanel={onOpenPanel} /> })

    fireEvent.click(screen.getByRole("button", { name: "Open demo panel" }))

    expect(onOpenPanel).toHaveBeenCalledWith({
      id: "demo-instance",
      component: "demo.panel",
      title: "Demo Panel",
      params: { from: "workspace-source" },
    })
  })

  test("lazy workspace sources resolve with a stable lazy component", async () => {
    const sources = new WorkspaceSourceRegistry()
    const importer = vi.fn(async () => ({
      default: () => <div>lazy body</div>,
    }))
    sources.register("lazy.source", {
      title: "Lazy",
      component: importer,
      lazy: true,
    })

    renderLeftPane({ sources, children: <WorkbenchLeftPane /> })

    expect(await screen.findByText("lazy body")).toBeInTheDocument()
    expect(importer).toHaveBeenCalledTimes(1)
  })

  test("selecting a category opens its associated default center panel", () => {
    const panelRegistry = new PanelRegistry()
    const sources = new WorkspaceSourceRegistry()
    sources.register("files", {
      title: "Files",
      component: () => <div>files body</div>,
    })
    panelRegistry.register("data.panel", {
      title: "Data Panel",
      placement: "center",
      component: () => <div>data center</div>,
    })
    sources.register("data.tab", {
      title: "Data",
      defaultPanelId: "data.panel",
      component: () => <div>data body</div>,
    })
    const onOpenPanel = vi.fn()

    renderLeftPane({ panels: panelRegistry, sources, children: <WorkbenchLeftPane defaultTab="files" onOpenPanel={onOpenPanel} /> })

    fireEvent.click(screen.getByRole("button", { name: "Data" }))

    expect(onOpenPanel).toHaveBeenCalledWith({
      id: "data.panel",
      component: "data.panel",
      title: "Data Panel",
    })
  })

  test("host explorers can render category actions without mounting the default left pane", () => {
    const panelRegistry = new PanelRegistry()
    const sources = new WorkspaceSourceRegistry()
    sources.register("files", {
      title: "Files",
      component: () => <div>files body</div>,
    })
    panelRegistry.register("data.panel", {
      title: "Data Panel",
      placement: "center",
      component: () => <div>data center</div>,
    })
    sources.register("data", {
      title: "Data",
      defaultPanelId: "data.panel",
      component: () => <div>data body</div>,
    })
    const onOpenPanel = vi.fn()

    renderLeftPane({ panels: panelRegistry, sources, children: <HostExplorer onOpenPanel={onOpenPanel} /> })

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

    fireEvent.click(dataButton)
    expect(onOpenPanel).toHaveBeenCalledTimes(2)
  })

  test("right-clicking a category reloads agent plugins", () => {
    const sources = new WorkspaceSourceRegistry()
    sources.register("data.tab", {
      title: "Data",
      component: () => <div>data body</div>,
    })
    const onReloadAgentPlugins = vi.fn()

    renderLeftPane({ sources, children: <WorkbenchLeftPane onReloadAgentPlugins={onReloadAgentPlugins} /> })

    fireEvent.contextMenu(screen.getByRole("button", { name: "Data" }))

    expect(onReloadAgentPlugins).toHaveBeenCalledTimes(1)
  })

  test("categories render as a rail with a calm active state and menu collapse", () => {
    const sources = new WorkspaceSourceRegistry()
    sources.register("files", {
      title: "Files",
      component: () => <div>files body</div>,
    })
    sources.register("data", {
      title: "Data",
      component: () => <div>data body</div>,
    })
    const onCollapse = vi.fn()

    renderLeftPane({ sources, children: <WorkbenchLeftPane defaultTab="files" onCollapse={onCollapse} /> })

    const rail = screen.getByRole("navigation", { name: "Workspace categories" })
    expect(rail).toBeInTheDocument()
    const filesButton = screen.getByRole("button", { name: "Files" })
    const dataButton = screen.getByRole("button", { name: "Data" })
    expect(filesButton).toHaveAttribute("aria-pressed", "true")
    expect(dataButton).toHaveAttribute("aria-pressed", "false")
    expect(filesButton.className).not.toContain("accent")

    fireEvent.click(dataButton)
    expect(dataButton).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("data body")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Hide workspace menu" }))
    expect(onCollapse).toHaveBeenCalled()
  })

  test("workspace-page entries act as rail launchers while the Files icon owns the file tree", () => {
    const panelRegistry = new PanelRegistry()
    const sources = new WorkspaceSourceRegistry()
    sources.register("files", {
      title: "Files",
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

    renderLeftPane({
      panels: panelRegistry,
      sources,
      children: <WorkbenchLeftPane defaultTab="files" onOpenPanel={onOpenPanel} onCollapse={onCollapse} onExpand={onExpand} onCloseSourcePane={onCloseSourcePane} />,
    })

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

  test("workspace-page accent follows the active surface tab and stays mutually exclusive with an open source", () => {
    const panelRegistry = new PanelRegistry()
    const sources = new WorkspaceSourceRegistry()
    sources.register("files", {
      title: "Files",
      component: () => <div>file tree body</div>,
    })
    panelRegistry.register("macro.page", {
      title: "Macro",
      placement: "workspace-page",
      component: () => <div>macro page body</div>,
    })

    const { rerender } = renderLeftPane({
      panels: panelRegistry,
      sources,
      children: <WorkbenchLeftPane defaultTab="files" activePanelId="macro.page" />,
    })

    const filesButton = screen.getByRole("button", { name: "Files" })
    const macroButton = screen.getByRole("button", { name: "Macro" })
    expect(filesButton).toHaveStyle({ color: "var(--accent)" })
    expect(macroButton).not.toHaveStyle({ color: "var(--accent)" })

    rerender(
      <RegistryProvider
        panelRegistry={panelRegistry}
        workspaceSourceRegistry={sources}
        commandRegistry={new CommandRegistry()}
        surfaceResolverRegistry={new SurfaceResolverRegistry()}
      >
        <WorkbenchLeftPane defaultTab="files" activePanelId="macro.page" railOnly />
      </RegistryProvider>,
    )

    expect(screen.getByRole("button", { name: "Files" })).not.toHaveStyle({ color: "var(--accent)" })
    expect(screen.getByRole("button", { name: "Macro" })).toHaveStyle({ color: "var(--accent)" })
  })

  test("clicking the active source icon untoggles the source pane", () => {
    const sources = new WorkspaceSourceRegistry()
    sources.register("files", {
      title: "Files",
      component: () => <div>file tree body</div>,
    })
    const onCloseSourcePane = vi.fn()

    renderLeftPane({ sources, children: <WorkbenchLeftPane defaultTab="files" onCloseSourcePane={onCloseSourcePane} /> })

    expect(screen.getByText("file tree body")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Files" }))

    expect(onCloseSourcePane).toHaveBeenCalledTimes(1)
  })

  test("rail-only mode keeps plugin and Files icons visible without rendering the file tree", () => {
    const panelRegistry = new PanelRegistry()
    const sources = new WorkspaceSourceRegistry()
    sources.register("files", {
      title: "Files",
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

    renderLeftPane({
      panels: panelRegistry,
      sources,
      children: <WorkbenchLeftPane defaultTab="files" railOnly onOpenPanel={onOpenPanel} onCollapse={onCollapse} onExpand={onExpand} onCloseSourcePane={onCloseSourcePane} />,
    })

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
    const sources = new WorkspaceSourceRegistry()
    sources.register("files", {
      title: "Files",
      component: () => <div>files body</div>,
    })
    sources.register("data", {
      title: "Data",
      component: () => <div>data body</div>,
    })

    renderLeftPane({ sources, children: <WorkbenchLeftPane defaultTab="files" /> })

    const filesButton = screen.getByRole("button", { name: "Files" })
    const dataButton = screen.getByRole("button", { name: "Data" })
    expect(filesButton.querySelector('[data-boring-workspace-part="category-initial"]')?.textContent).toBe("F")
    expect(dataButton.querySelector('[data-boring-workspace-part="category-initial"]')?.textContent).toBe("D")
  })
})
