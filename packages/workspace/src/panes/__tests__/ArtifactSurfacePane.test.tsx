import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { ArtifactSurfacePane } from "../ArtifactSurfacePane"
import { RegistryProvider } from "../../registry"
import { PanelRegistry } from "../../registry/PanelRegistry"
import { CommandRegistry } from "../../registry/CommandRegistry"
import { bindStore } from "../../store/selectors"
import { createWorkspaceStore } from "../../store"

function DummyPanel() {
  return <div>panel</div>
}

function setup(panels: string[]) {
  const store = createWorkspaceStore()
  bindStore(store)

  const panelRegistry = new PanelRegistry()
  for (const id of panels) {
    panelRegistry.register(id, { title: id, component: DummyPanel })
  }
  const commandRegistry = new CommandRegistry()
  return { panelRegistry, commandRegistry }
}

function renderWithRegistry(
  ui: React.ReactElement,
  panels: string[],
) {
  const { panelRegistry, commandRegistry } = setup(panels)
  return render(
    <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry}>
      {ui}
    </RegistryProvider>,
  )
}

describe("ArtifactSurfacePane", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("renders nested DockviewShell when visible", () => {
    const { container } = renderWithRegistry(
      <ArtifactSurfacePane />,
      ["code-editor", "markdown-editor", "csv-viewer", "empty"],
    )
    expect(screen.getByTestId("artifact-surface")).toBeInTheDocument()
    expect(container.querySelector(".dv-shell")).toBeInTheDocument()
  })

  it("renders nothing when visible=false", () => {
    renderWithRegistry(
      <ArtifactSurfacePane visible={false} />,
      ["empty"],
    )
    expect(screen.queryByTestId("artifact-surface")).not.toBeInTheDocument()
  })

  it("accepts custom allowedPanels", () => {
    const { container } = renderWithRegistry(
      <ArtifactSurfacePane allowedPanels={["code-editor"]} />,
      ["code-editor", "markdown-editor", "empty"],
    )
    expect(container.querySelector(".dv-shell")).toBeInTheDocument()
  })

  it("accepts className prop", () => {
    renderWithRegistry(
      <ArtifactSurfacePane className="custom-surface" />,
      ["empty"],
    )
    expect(screen.getByTestId("artifact-surface")).toHaveClass("custom-surface")
  })

  it("exposes default allowedPanels as static property", () => {
    expect(ArtifactSurfacePane.defaultAllowedPanels).toEqual([
      "code-editor",
      "markdown-editor",
      "csv-viewer",
      "empty",
    ])
  })

  it("onLayoutChange callback fires on layout changes", () => {
    const onLayoutChange = vi.fn()
    renderWithRegistry(
      <ArtifactSurfacePane onLayoutChange={onLayoutChange} />,
      ["empty"],
    )
    expect(screen.getByTestId("artifact-surface")).toBeInTheDocument()
  })

  it("onReady callback fires when shell initializes", () => {
    const onReady = vi.fn()
    renderWithRegistry(
      <ArtifactSurfacePane onReady={onReady} />,
      ["empty"],
    )
    expect(onReady).toHaveBeenCalledOnce()
  })
})
