import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"
import { RegistryProvider } from "../../../registry/RegistryProvider"
import { PanelRegistry } from "../../../registry/PanelRegistry"
import { CommandRegistry } from "../../../../shared/plugins/CommandRegistry"
import { SurfaceResolverRegistry } from "../../../../shared/plugins/SurfaceResolverRegistry"
import type { PaneProps } from "../../../registry/types"
import { WorkbenchLeftPane } from "../WorkbenchLeftPane"

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
