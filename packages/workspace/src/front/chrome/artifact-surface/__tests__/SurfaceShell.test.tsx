import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"
import { SurfaceShell, type SurfaceShellApi, type SurfaceShellProps } from "../SurfaceShell"
import { RegistryProvider } from "../../../registry"
import { PanelRegistry } from "../../../registry/PanelRegistry"
import { CommandRegistry } from "../../../../shared/plugins/CommandRegistry"

let capturedSurfaceStorageKey: string | undefined
let capturedAllowedPanels: string[] | undefined

vi.mock("../../workbench-left/WorkbenchLeftPane", () => ({
  WorkbenchLeftPane: () => <div data-testid="mock-left-pane" />,
}))

vi.mock("../ArtifactSurfacePane", async () => {
  const React = await import("react")
  function MockArtifactSurfacePane(props: { storageKey?: string; allowedPanels?: string[]; onReady?: (api: unknown) => void }) {
    capturedSurfaceStorageKey = props.storageKey
    capturedAllowedPanels = props.allowedPanels
    React.useEffect(() => {
      props.onReady?.({
        panels: [],
        activePanel: null,
        getPanel: () => undefined,
        addPanel: vi.fn(),
        onDidAddPanel: vi.fn(() => ({ dispose: vi.fn() })),
        onDidRemovePanel: vi.fn(() => ({ dispose: vi.fn() })),
        onDidActivePanelChange: vi.fn(() => ({ dispose: vi.fn() })),
      })
    }, [props.onReady])
    return <div data-testid="mock-artifact-surface" />
  }
  MockArtifactSurfacePane.defaultAllowedPanels = [] as string[]
  return { ArtifactSurfacePane: MockArtifactSurfacePane }
})

function renderSurface(
  storageKey?: string,
  props: Partial<SurfaceShellProps> = {},
  panelRegistry = new PanelRegistry(),
) {
  return render(
    <RegistryProvider panelRegistry={panelRegistry} commandRegistry={new CommandRegistry()}>
      <SurfaceShell storageKey={storageKey} {...props} />
    </RegistryProvider>,
  )
}

describe("SurfaceShell", () => {
  beforeEach(() => {
    capturedSurfaceStorageKey = undefined
    capturedAllowedPanels = undefined
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

  it("updates allowed surface panels when a hot-loaded plugin panel registers after mount", async () => {
    const panelRegistry = new PanelRegistry()
    renderSurface("workspace-a", {}, panelRegistry)

    expect(capturedAllowedPanels).not.toContain("hot-csv.panel")

    act(() => {
      panelRegistry.register("hot-csv.panel", {
        title: "Hot CSV",
        placement: "center",
        component: () => null,
      })
    })

    await waitFor(() => expect(capturedAllowedPanels).toContain("hot-csv.panel"))
  })

  it("exposes an API command to close the workbench left pane", async () => {
    let surface: SurfaceShellApi | undefined
    renderSurface("workspace-a", {
      onReady: (api) => {
        surface = api
      },
    })

    expect(screen.getByLabelText("Workbench left pane")).toBeInTheDocument()
    await waitFor(() => expect(surface).toBeDefined())

    act(() => {
      surface?.closeWorkbenchLeftPane()
    })

    expect(screen.queryByLabelText("Workbench left pane")).not.toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Show sources" }).length).toBeGreaterThan(0)
  })
})
