import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"
import { SurfaceShell, type SurfaceShellApi, type SurfaceShellProps } from "../SurfaceShell"
import { RegistryProvider } from "../../../registry"
import { PanelRegistry } from "../../../registry/PanelRegistry"
import { CommandRegistry } from "../../../../shared/plugins/CommandRegistry"
import { SurfaceResolverRegistry } from "../../../../shared/plugins/SurfaceResolverRegistry"
import { WORKSPACE_OPEN_PATH_SURFACE_KIND } from "../../../../shared/types/surface"

let capturedSurfaceStorageKey: string | undefined
let capturedAllowedPanels: string[] | undefined
let mockAddPanel = vi.fn()
let mockGetPanel: (id: string) => unknown = vi.fn(() => undefined)

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
        getPanel: mockGetPanel,
        addPanel: mockAddPanel,
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
  surfaceResolverRegistry = new SurfaceResolverRegistry(),
) {
  return render(
    <RegistryProvider
      panelRegistry={panelRegistry}
      commandRegistry={new CommandRegistry()}
      surfaceResolverRegistry={surfaceResolverRegistry}
    >
      <SurfaceShell storageKey={storageKey} {...props} />
    </RegistryProvider>,
  )
}

describe("SurfaceShell", () => {
  beforeEach(() => {
    capturedSurfaceStorageKey = undefined
    capturedAllowedPanels = undefined
    mockAddPanel = vi.fn()
    mockGetPanel = vi.fn(() => undefined)
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

  it("routes file opens through the latest matching surface resolver before activating stale tabs", async () => {
    let surface: SurfaceShellApi | undefined
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("editor", { title: "Editor", placement: "center", component: () => null })
    panelRegistry.register("hot-csv.panel", { title: "Hot CSV", placement: "center", component: () => null })
    const surfaceResolverRegistry = new SurfaceResolverRegistry()
    surfaceResolverRegistry.register("filesystem", {
      source: "builtin",
      resolve: (request) => request.kind === WORKSPACE_OPEN_PATH_SURFACE_KIND
        ? { id: `file:${request.target}`, component: "editor", params: { path: request.target }, score: 0 }
        : undefined,
    })
    surfaceResolverRegistry.register("hot-csv.surface", {
      source: "plugin",
      resolve: (request) => request.kind === WORKSPACE_OPEN_PATH_SURFACE_KIND && request.target.endsWith(".csv")
        ? { id: `hot-csv:${request.target}`, component: "hot-csv.panel", params: { path: request.target }, score: 100 }
        : undefined,
    })
    mockGetPanel = vi.fn((id: string) => id === "file:data.csv"
      ? { api: { setActive: vi.fn(), updateParameters: vi.fn() } }
      : undefined,
    )

    renderSurface("workspace-a", { onReady: (api) => { surface = api } }, panelRegistry, surfaceResolverRegistry)
    await waitFor(() => expect(surface).toBeDefined())

    await act(async () => {
      await surface?.openFile("data.csv")
    })

    expect(mockAddPanel).toHaveBeenCalledWith(expect.objectContaining({
      id: "hot-csv:data.csv",
      component: "hot-csv.panel",
      params: { path: "data.csv" },
    }))
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
