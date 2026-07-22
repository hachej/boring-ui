import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { SurfaceShell, type SurfaceShellApi, type SurfaceShellProps } from "../SurfaceShell"
import { RegistryProvider } from "../../../registry"
import { PanelRegistry } from "../../../registry/PanelRegistry"
import { CommandRegistry } from "../../../../shared/plugins/CommandRegistry"
import { SurfaceResolverRegistry } from "../../../../shared/plugins/SurfaceResolverRegistry"
import { WORKSPACE_OPEN_PATH_SURFACE_KIND } from "../../../../shared/types/surface"

let capturedSurfaceStorageKey: string | undefined
let capturedAllowedPanels: string[] | undefined
let capturedWorkbenchBridge: any
let mockAddPanel = vi.fn()
let mockPanels: any[] = []
let mockGetPanel: (id: string) => unknown = vi.fn(() => undefined)

vi.mock("../../workbench-left/WorkbenchLeftPane", () => ({
  WorkbenchLeftPane: (props: any) => {
    capturedWorkbenchBridge = props.bridge
    return <div data-testid="mock-left-pane" />
  },
}))

vi.mock("../ArtifactSurfacePane", async () => {
  const React = await import("react")
  function MockArtifactSurfacePane(props: { storageKey?: string; allowedPanels?: string[]; onReady?: (api: unknown) => void; onUnavailable?: (api: unknown) => void }) {
    capturedSurfaceStorageKey = props.storageKey
    capturedAllowedPanels = props.allowedPanels
    React.useEffect(() => {
      const api = {
        panels: mockPanels,
        activePanel: null,
        getPanel: mockGetPanel,
        addPanel: mockAddPanel,
        onDidAddPanel: vi.fn(() => ({ dispose: vi.fn() })),
        onDidRemovePanel: vi.fn(() => ({ dispose: vi.fn() })),
        onDidActivePanelChange: vi.fn(() => ({ dispose: vi.fn() })),
      }
      props.onReady?.(api)
      return () => props.onUnavailable?.(api)
    }, [props.allowedPanels?.join("\0"), props.onReady, props.onUnavailable, props.storageKey])
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
    capturedWorkbenchBridge = undefined
    mockAddPanel = vi.fn()
    mockPanels = []
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

  it("marks the surface unavailable while its Dockview instance is replaced", () => {
    const onReady = vi.fn()
    const onUnavailable = vi.fn()
    const panelRegistry = new PanelRegistry()
    const commandRegistry = new CommandRegistry()
    const initialPanels = [{ id: "welcome", component: "welcome-panel", title: "Welcome" }]
    const { rerender } = renderSurface("workspace-a", { onReady, onUnavailable, initialPanels }, panelRegistry)
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(mockAddPanel).toHaveBeenCalledTimes(1)

    rerender(
      <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry}>
        <SurfaceShell storageKey="workspace-b" onReady={onReady} onUnavailable={onUnavailable} initialPanels={initialPanels} />
      </RegistryProvider>,
    )

    expect(onUnavailable).toHaveBeenCalledTimes(1)
    expect(onReady).toHaveBeenCalledTimes(2)
    expect(mockAddPanel).toHaveBeenCalledTimes(2)
  })

  it("updates allowed surface panels when hot-loaded dockview/plugin-page panels register after mount", async () => {
    const panelRegistry = new PanelRegistry()
    renderSurface("workspace-a", {}, panelRegistry)

    expect(capturedAllowedPanels).not.toContain("hot-csv.panel")
    expect(capturedAllowedPanels).not.toContain("hot-page.panel")

    act(() => {
      panelRegistry.register("hot-csv.panel", {
        title: "Hot CSV",
        placement: "shared-dockview",
        component: () => null,
      })
      panelRegistry.register("hot-page.panel", {
        title: "Hot Page",
        placement: "workspace-page",
        component: () => null,
      })
    })

    await waitFor(() => expect(capturedAllowedPanels).toEqual(expect.arrayContaining(["hot-csv.panel", "hot-page.panel"])))
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
      await surface?.openFile("README.md")
    })
    expect(mockAddPanel).toHaveBeenCalledWith(expect.objectContaining({
      id: "file:user:README.md",
      component: "editor",
      params: expect.objectContaining({ path: "README.md", filesystem: "user" }),
    }))

    mockAddPanel.mockClear()
    await act(async () => {
      await surface?.openFile("data.csv", { filesystem: "company_context" })
    })

    expect(mockAddPanel).toHaveBeenCalledWith(expect.objectContaining({
      id: "file:company_context:data.csv",
      component: "hot-csv.panel",
      params: expect.objectContaining({ path: "data.csv", filesystem: "company_context" }),
    }))
  })

  it("reactivates legacy user file panels instead of duplicating default workspace opens", async () => {
    let surface: SurfaceShellApi | undefined
    const legacySetActive = vi.fn()
    const legacyUpdateParameters = vi.fn()
    mockPanels = [{
      id: "file:README.md",
      component: "editor",
      params: { path: "README.md" },
      api: { setActive: legacySetActive, updateParameters: legacyUpdateParameters },
    }]
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("editor", { title: "Editor", placement: "center", component: () => null })
    const surfaceResolverRegistry = new SurfaceResolverRegistry()
    surfaceResolverRegistry.register("filesystem", {
      source: "builtin",
      resolve: (request) => request.kind === WORKSPACE_OPEN_PATH_SURFACE_KIND
        ? { component: "editor", params: { path: request.target }, score: 0 }
        : undefined,
    })

    renderSurface("workspace-a", { onReady: (api) => { surface = api } }, panelRegistry, surfaceResolverRegistry)
    await waitFor(() => expect(surface).toBeDefined())

    await act(async () => {
      await surface?.openFile("README.md")
    })

    expect(mockAddPanel).not.toHaveBeenCalled()
    expect(legacyUpdateParameters).toHaveBeenCalledWith(expect.objectContaining({ path: "README.md", filesystem: "user" }))
    expect(legacySetActive).toHaveBeenCalled()
  })

  it("opens the same path in user and company_context as distinct surface panels", async () => {
    let surface: SurfaceShellApi | undefined
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("editor", { title: "Editor", placement: "center", component: () => null })
    const surfaceResolverRegistry = new SurfaceResolverRegistry()
    surfaceResolverRegistry.register("filesystem", {
      source: "builtin",
      resolve: (request) => request.kind === WORKSPACE_OPEN_PATH_SURFACE_KIND
        ? { component: "editor", params: { path: request.target }, score: 0 }
        : undefined,
    })

    renderSurface("workspace-a", { onReady: (api) => { surface = api } }, panelRegistry, surfaceResolverRegistry)
    await waitFor(() => expect(surface).toBeDefined())

    await act(async () => {
      await surface?.openFile("same.md")
      await surface?.openFile("same.md", { filesystem: "company_context" })
    })

    expect(mockAddPanel).toHaveBeenCalledWith(expect.objectContaining({ id: "file:user:same.md" }))
    expect(mockAddPanel).toHaveBeenCalledWith(expect.objectContaining({ id: "file:company_context:same.md" }))
  })

  it("routes openSurface path requests through the latest resolver before stale file tabs", async () => {
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

    act(() => {
      surface?.openSurface({ kind: WORKSPACE_OPEN_PATH_SURFACE_KIND, target: "data.csv", filesystem: "company_context" })
    })

    expect(mockAddPanel).toHaveBeenCalledWith(expect.objectContaining({
      id: "file:company_context:data.csv",
      component: "hot-csv.panel",
      params: expect.objectContaining({ path: "data.csv", filesystem: "company_context" }),
    }))
  })

  it("auto-collapses the workbench source pane to the rail when opening a workspace-page panel", async () => {
    let surface: SurfaceShellApi | undefined
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("plugin.page", { title: "Plugin Page", placement: "workspace-page", component: () => null })

    renderSurface("workspace-a", { onReady: (api) => { surface = api } }, panelRegistry)
    expect(screen.getByLabelText("Workbench left pane")).toBeInTheDocument()
    await waitFor(() => expect(surface).toBeDefined())

    act(() => {
      surface?.openPanel({ id: "plugin.page", component: "plugin.page", title: "Plugin Page" })
    })

    expect(mockAddPanel).toHaveBeenCalledWith(expect.objectContaining({ id: "plugin.page", component: "plugin.page" }))
    expect(screen.getByLabelText("Workbench left pane")).toHaveAttribute("data-boring-state", "rail")
  })

  it("keeps the workbench left pane open when opening a shared-dockview panel", async () => {
    let surface: SurfaceShellApi | undefined
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("plugin.chart", { title: "Plugin Chart", placement: "shared-dockview", component: () => null })

    renderSurface("workspace-a", { onReady: (api) => { surface = api } }, panelRegistry)
    expect(screen.getByLabelText("Workbench left pane")).toBeInTheDocument()
    await waitFor(() => expect(surface).toBeDefined())

    act(() => {
      surface?.openPanel({ id: "plugin.chart", component: "plugin.chart", title: "Plugin Chart" })
    })

    expect(mockAddPanel).toHaveBeenCalledWith(expect.objectContaining({ id: "plugin.chart", component: "plugin.chart" }))
    expect(screen.getByLabelText("Workbench left pane")).toBeInTheDocument()
  })

  it("renders a reachable close-workbench button as an overlay regardless of tab state", async () => {
    // Regression: the close action used to live in dockview's right-header
    // slot, which gets squeezed/hidden when exactly one tab is open. It is now
    // an always-rendered overlay, so it must be present even with zero panels.
    renderSurface("workspace-a", { onClose: vi.fn() })

    expect(await screen.findByRole("button", { name: "Close workbench" })).toBeInTheDocument()
  })

  it("omits the close-workbench button when no onClose handler is provided", () => {
    renderSurface("workspace-a")

    expect(screen.queryByRole("button", { name: "Close workbench" })).not.toBeInTheDocument()
  })

  it("surface-backed source bridge opens panels and reports unsupported requests as errors", async () => {
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("plugin.chart", { title: "Plugin Chart", placement: "shared-dockview", component: () => null })
    renderSurface("workspace-a", {}, panelRegistry)
    await waitFor(() => expect(capturedWorkbenchBridge).toBeDefined())

    await expect(capturedWorkbenchBridge.openPanel({
      id: "plugin.chart",
      component: "plugin.chart",
      title: "Plugin Chart",
    })).resolves.toMatchObject({ status: "ok" })
    expect(mockAddPanel).toHaveBeenCalledWith(expect.objectContaining({ id: "plugin.chart", component: "plugin.chart" }))

    await expect(capturedWorkbenchBridge.openPanel({
      id: "missing",
      component: "missing.panel",
      title: "Missing",
    })).resolves.toMatchObject({ status: "error", error: { code: "INVALID_PANEL" } })
    await expect(capturedWorkbenchBridge.closePanel("missing")).resolves.toMatchObject({ status: "error", error: { code: "PANEL_NOT_FOUND" } })
  })

  it("exposes an API command to collapse and restore the full left block", async () => {
    let surface: SurfaceShellApi | undefined
    localStorage.setItem("workspace-a:sourcePaneOpen", "1")
    renderSurface("workspace-a", {
      onReady: (api) => {
        surface = api
      },
    })

    const sidebar = screen.getByLabelText("Workbench left pane")
    expect(sidebar).toBeInTheDocument()
    expect(sidebar).toHaveAttribute("data-boring-state", "expanded")
    await waitFor(() => expect(surface).toBeDefined())

    act(() => {
      surface?.closeWorkbenchLeftPane()
    })

    expect(screen.getByLabelText("Workbench left pane")).toHaveAttribute("data-boring-state", "collapsed")

    fireEvent.click(screen.getAllByRole("button", { name: "Show workspace menu" })[0]!)

    expect(screen.getByLabelText("Workbench left pane")).toHaveAttribute("data-boring-state", "expanded")
  })
})
