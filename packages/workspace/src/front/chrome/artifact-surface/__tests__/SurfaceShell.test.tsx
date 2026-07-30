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
let capturedRevealRequest: any
let capturedRevealRequests: any[] = []
let mockAddPanel = vi.fn()
let mockPanels: any[] = []
let mockActivePanel: any = null
let mockActivePanelChange: (() => void) | undefined
let mockGetPanel: (id: string) => unknown = vi.fn(() => undefined)

vi.mock("../../workbench-left/WorkbenchLeftPane", () => ({
  WorkbenchLeftPane: (props: any) => {
    capturedWorkbenchBridge = props.bridge
    capturedRevealRequest = props.revealFileTreeRequest
    if (props.revealFileTreeRequest) capturedRevealRequests.push(props.revealFileTreeRequest)
    return <div data-testid="mock-left-pane" />
  },
}))

vi.mock("../ArtifactSurfacePane", async () => {
  const React = await import("react")
  function MockArtifactSurfacePane(props: { storageKey?: string; allowedPanels?: string[]; onReady?: (api: unknown) => void }) {
    capturedSurfaceStorageKey = props.storageKey
    capturedAllowedPanels = props.allowedPanels
    React.useEffect(() => {
      props.onReady?.({
        panels: mockPanels,
        get activePanel() { return mockActivePanel },
        getPanel: mockGetPanel,
        addPanel: mockAddPanel,
        onDidAddPanel: vi.fn(() => ({ dispose: vi.fn() })),
        onDidRemovePanel: vi.fn(() => ({ dispose: vi.fn() })),
        onDidActivePanelChange: vi.fn((callback: () => void) => {
          mockActivePanelChange = callback
          return { dispose: vi.fn() }
        }),
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
    capturedWorkbenchBridge = undefined
    capturedRevealRequest = undefined
    capturedRevealRequests = []
    mockAddPanel = vi.fn()
    mockPanels = []
    mockActivePanel = null
    mockActivePanelChange = undefined
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
    const opened = vi.fn()
    capturedWorkbenchBridge.subscribe("file:opened", opened)

    act(() => {
      surface?.openSurface({ kind: WORKSPACE_OPEN_PATH_SURFACE_KIND, target: "data.csv", filesystem: "company_context" })
    })

    expect(mockAddPanel).toHaveBeenCalledWith(expect.objectContaining({
      id: "file:company_context:data.csv",
      component: "hot-csv.panel",
      params: expect.objectContaining({ path: "data.csv", filesystem: "company_context" }),
    }))
    expect(opened).toHaveBeenCalledWith({
      path: "data.csv",
      mode: "edit",
      filesystem: "company_context",
    })
  })

  it("synchronizes filesystem identity when an existing file-backed tab becomes active", async () => {
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("editor", { title: "Editor", placement: "center", component: () => null })
    mockActivePanel = {
      id: "file:company_context:policy.md",
      component: "editor",
      params: { path: "policy.md", filesystem: "company_context", __boringFileBacked: true },
    }
    mockPanels = [mockActivePanel]
    renderSurface("workspace-a", {}, panelRegistry)
    await waitFor(() => expect(mockActivePanelChange).toBeDefined())
    const opened = vi.fn()
    capturedWorkbenchBridge.subscribe("file:opened", opened)

    act(() => mockActivePanelChange?.())

    expect(opened).toHaveBeenCalledWith({
      path: "policy.md",
      mode: "edit",
      filesystem: "company_context",
    })
    expect(capturedWorkbenchBridge.getActiveFileResource()).toEqual({
      path: "policy.md",
      filesystem: "company_context",
    })
  })

  it("carries filesystem identity through file-open and reveal synchronization", async () => {
    let surface: SurfaceShellApi | undefined
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("editor", { title: "Editor", placement: "center", component: () => null })
    const surfaceResolverRegistry = new SurfaceResolverRegistry()
    surfaceResolverRegistry.register("filesystem", {
      kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
      resolve: ({ target }) => ({ component: "editor", title: target, params: { path: target } }),
    })
    renderSurface(undefined, { onReady: (api) => { surface = api } }, panelRegistry, surfaceResolverRegistry)
    await waitFor(() => expect(surface).toBeDefined())
    const opened = vi.fn()
    capturedWorkbenchBridge.subscribe("file:opened", opened)

    act(() => {
      surface?.openFile("/company/policy.md", { filesystem: "company_context" })
    })
    expect(opened).toHaveBeenCalledWith({
      path: "/company/policy.md",
      mode: "edit",
      filesystem: "company_context",
    })

    act(() => {
      surface?.expandToFile("/company/policy.md", { filesystem: "company_context" })
    })
    expect(capturedRevealRequests).toContainEqual({
      path: "/company/policy.md",
      seq: 1,
      filesystem: "company_context",
    })
    await waitFor(() => expect(capturedRevealRequest).toBeNull())

    act(() => {
      surface?.expandToFile("/workspace/README.md", { filesystem: "user" })
    })
    expect(capturedRevealRequests).toContainEqual({
      path: "/workspace/README.md",
      seq: 2,
      filesystem: "user",
    })
    await waitFor(() => expect(capturedRevealRequest).toBeNull())

    const deliveredRequestCount = capturedRevealRequests.length
    act(() => surface?.closeWorkbenchLeftPane())
    fireEvent.click(screen.getAllByRole("button", { name: "Show workspace menu" })[0]!)
    await waitFor(() => expect(screen.getByTestId("mock-left-pane")).toBeInTheDocument())
    expect(capturedRevealRequests).toHaveLength(deliveredRequestCount)
    expect(capturedRevealRequest).toBeNull()
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
