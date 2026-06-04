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
})
