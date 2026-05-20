import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PluginInspector, type PluginMeta } from "../PluginInspector"
import { RegistryProvider } from "../../registry/RegistryProvider"
import { PanelRegistry } from "../../registry/PanelRegistry"
import { CommandRegistry } from "../../../shared/plugins/CommandRegistry"
import { CatalogRegistry } from "../../../shared/plugins/CatalogRegistry"
import { PluginErrorProvider } from "../PluginErrorContext"

function DummyPanel() {
  return <div>dummy</div>
}

function renderInspector(plugins: PluginMeta[], opts?: { openByDefault?: boolean }) {
  const pr = new PanelRegistry()
  const cr = new CommandRegistry()
  const cat = new CatalogRegistry()

  pr.register("p1", { title: "Panel One", component: DummyPanel, source: "app", pluginId: "alpha" })
  pr.register("p2", { title: "Panel Two", component: DummyPanel, source: "app", pluginId: "alpha" })
  pr.register("p3", { title: "Panel Three", component: DummyPanel, source: "app", pluginId: "beta" })

  cr.registerCommand({ id: "cmd1", title: "Cmd One", pluginId: "alpha", run: () => {} })

  return render(
    <PluginErrorProvider>
      <RegistryProvider panelRegistry={pr} commandRegistry={cr} catalogRegistry={cat}>
        <PluginInspector plugins={plugins} />
      </RegistryProvider>
    </PluginErrorProvider>,
  )
}

const twoPlugins: PluginMeta[] = [
  { id: "alpha", label: "Alpha Plugin" },
  { id: "beta", label: "Beta Plugin", systemPrompt: "You are a beta agent." },
]

describe("PluginInspector", () => {
  it("is hidden by default", () => {
    renderInspector(twoPlugins)
    expect(screen.queryByTestId("plugin-inspector")).toBeNull()
  })

  it("opens on Ctrl+Shift+I", () => {
    renderInspector(twoPlugins)
    fireEvent.keyDown(window, { key: "I", ctrlKey: true, shiftKey: true })
    expect(screen.getByTestId("plugin-inspector")).toBeTruthy()
    expect(screen.getByText("Plugin Inspector (2)")).toBeTruthy()
  })

  it("lists plugins with contribution counts", () => {
    renderInspector(twoPlugins)
    fireEvent.keyDown(window, { key: "I", ctrlKey: true, shiftKey: true })
    expect(screen.getByText("Alpha Plugin")).toBeTruthy()
    expect(screen.getByText("Beta Plugin")).toBeTruthy()
  })

  it("closes when toggle key is pressed again", () => {
    renderInspector(twoPlugins)
    fireEvent.keyDown(window, { key: "I", ctrlKey: true, shiftKey: true })
    expect(screen.getByTestId("plugin-inspector")).toBeTruthy()
    fireEvent.keyDown(window, { key: "I", ctrlKey: true, shiftKey: true })
    expect(screen.queryByTestId("plugin-inspector")).toBeNull()
  })

  it("shows 'No plugins registered' when empty", () => {
    renderInspector([])
    fireEvent.keyDown(window, { key: "I", ctrlKey: true, shiftKey: true })
    expect(screen.getByText("No plugins registered.")).toBeTruthy()
  })
})
