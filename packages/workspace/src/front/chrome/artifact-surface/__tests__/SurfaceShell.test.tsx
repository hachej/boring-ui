import { beforeEach, describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"
import { SurfaceShell } from "../SurfaceShell"
import { RegistryProvider } from "../../../registry"
import { PanelRegistry } from "../../../registry/PanelRegistry"
import { CommandRegistry } from "../../../registry/CommandRegistry"

let capturedSurfaceStorageKey: string | undefined

vi.mock("../../workbench-left/WorkbenchLeftPane", () => ({
  WorkbenchLeftPane: () => <div data-testid="mock-left-pane" />,
}))

vi.mock("../ArtifactSurfacePane", () => {
  function MockArtifactSurfacePane(props: { storageKey?: string }) {
    capturedSurfaceStorageKey = props.storageKey
    return <div data-testid="mock-artifact-surface" />
  }
  MockArtifactSurfacePane.defaultAllowedPanels = [
    "code-editor",
    "markdown-editor",
    "csv-viewer",
    "empty",
  ]
  return { ArtifactSurfacePane: MockArtifactSurfacePane }
})

function renderSurface(storageKey?: string) {
  return render(
    <RegistryProvider panelRegistry={new PanelRegistry()} commandRegistry={new CommandRegistry()}>
      <SurfaceShell storageKey={storageKey} />
    </RegistryProvider>,
  )
}

describe("SurfaceShell", () => {
  beforeEach(() => {
    capturedSurfaceStorageKey = undefined
    localStorage.clear()
  })

  it("uses the workspace-scoped storage key for dockview pane persistence", () => {
    renderSurface("boring-ui-v2:surface-shell:full-app:workspace-a")

    expect(capturedSurfaceStorageKey).toBe("boring-ui-v2:surface-shell:full-app:workspace-a")
  })

  it("updates dockview pane persistence when the workspace storage key changes", () => {
    const { rerender } = renderSurface("workspace-a")
    expect(capturedSurfaceStorageKey).toBe("workspace-a")

    rerender(
      <RegistryProvider panelRegistry={new PanelRegistry()} commandRegistry={new CommandRegistry()}>
        <SurfaceShell storageKey="workspace-b" />
      </RegistryProvider>,
    )

    expect(capturedSurfaceStorageKey).toBe("workspace-b")
  })
})
