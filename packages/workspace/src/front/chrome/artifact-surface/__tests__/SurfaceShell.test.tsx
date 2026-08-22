import type { FunctionComponent } from "react"
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
let capturedWorkbenchProps: any
let capturedRightHeaderActions: FunctionComponent<unknown> | undefined
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
    capturedWorkbenchProps = props
    capturedRevealRequest = props.revealFileTreeRequest
    if (props.revealFileTreeRequest) capturedRevealRequests.push(props.revealFileTreeRequest)
    return (
      <div data-testid="mock-left-pane">
        {props.workbenchCollapsed && props.onToggleWorkbench ? (
          <button type="button" onClick={props.onToggleWorkbench}>Open workbench</button>
        ) : null}
      </div>
    )
  },
}))

vi.mock("../ArtifactSurfacePane", async () => {
  const React = await import("react")
  function MockArtifactSurfacePane(props: { storageKey?: string; allowedPanels?: string[]; onReady?: (api: unknown) => void; rightHeaderActions?: FunctionComponent<unknown> }) {
    capturedSurfaceStorageKey = props.storageKey
    capturedAllowedPanels = props.allowedPanels
    capturedRightHeaderActions = props.rightHeaderActions
    const RightHeaderActions = props.rightHeaderActions
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
    return <div data-testid="mock-artifact-surface">{RightHeaderActions ? <RightHeaderActions /> : null}</div>
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
    capturedWorkbenchProps = undefined
    capturedRightHeaderActions = undefined
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

  it("reserves the level-one tab row above the full expanded Workbench body", () => {
    const onHostToggleFullscreen = vi.fn()
    const onClose = vi.fn()
    renderSurface("workspace-a", { hostFullscreen: true, onHostToggleFullscreen, onClose })

    const shell = screen.getByTestId("surface-shell")
    const header = shell.querySelector<HTMLElement>('[data-boring-workspace-part="workbench-level-one-header"]')
    const body = shell.querySelector<HTMLElement>('[data-boring-workspace-part="workbench-body"]')
    const rail = shell.querySelector<HTMLElement>('[data-boring-workspace-part="surface-sidebar"]')

    expect(capturedRightHeaderActions).toBeUndefined()
    expect(header).not.toBeNull()
    expect(header).toHaveStyle({ height: "44px" })
    expect(header?.parentElement).toBe(shell)
    expect(body?.previousElementSibling).toBe(header)
    expect(body).toHaveStyle({ height: "100%" })
    expect(rail).toHaveStyle({ height: "calc(100% - 44px)" })
    expect(rail?.parentElement).toBe(body)
    expect(header).toHaveTextContent("")
    expect(screen.getByRole("button", { name: "Restore split view" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Close workbench" })).toBeInTheDocument()
  })

  it("lets the collapsed activity rail fill the host and reopen the Workbench", () => {
    const onHostExpand = vi.fn()
    renderSurface("workspace-a", { hostRailOnly: true, onHostExpand })

    const shell = screen.getByTestId("surface-shell")
    const body = shell.querySelector<HTMLElement>('[data-boring-workspace-part="workbench-body"]')
    const rail = shell.querySelector<HTMLElement>('[data-boring-workspace-part="surface-sidebar"]')

    const header = shell.querySelector('[data-boring-workspace-part="workbench-level-one-header"]')
    expect(header).toHaveAttribute("data-boring-state", "collapsed")
    expect(body).toHaveStyle({ height: "100%" })
    expect(rail).toHaveStyle({ height: "calc(100% - 44px)" })
    expect(rail).toHaveAttribute("data-boring-state", "host-collapsed")
    expect(rail).toHaveClass("border-border")
    expect(rail?.parentElement).toBe(body)
    expect(header).toHaveClass("border-border")
    expect(header).toHaveClass("bg-[color:oklch(from_var(--background)_calc(l-0.012)_c_h)]")
    const openWorkbench = screen.getByRole("button", { name: "Open workbench" })
    expect(openWorkbench).toHaveAttribute("data-size", "icon-sm")
    expect(openWorkbench.querySelector("svg")).toHaveClass("lucide-panel-right-open", "size-4")
    fireEvent.click(openWorkbench)
    expect(onHostExpand).toHaveBeenCalledOnce()
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

  it("pins a preview when the same logical path opens from another filesystem", async () => {
    let surface: SurfaceShellApi | undefined
    const pinPreview = vi.fn()
    const closePreview = vi.fn()
    mockPanels = [{
      id: "file:user:duplicate.md",
      component: "editor",
      title: "duplicate.md",
      params: { path: "duplicate.md", filesystem: "user", __workbenchPreview: true },
      api: { updateParameters: pinPreview, close: closePreview, setActive: vi.fn() },
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
      await surface?.openFile("/duplicate.md", { filesystem: "company_context" })
    })

    expect(pinPreview).toHaveBeenCalledWith(expect.objectContaining({
      filesystem: "user",
      path: "duplicate.md",
      __workbenchPreview: false,
    }))
    expect(closePreview).not.toHaveBeenCalled()
    expect(mockAddPanel).toHaveBeenCalledWith(expect.objectContaining({
      id: "file:company_context:/duplicate.md",
      params: expect.objectContaining({
        filesystem: "company_context",
        path: "/duplicate.md",
        __workbenchPreview: true,
      }),
    }))
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

  it("injects __closeWorkbenchOnDone into non-file openSurface params when meta.closeWorkbenchOnDone is set", async () => {
    // Regression: openSurfaceSync's non-file branch (e.g. the agent's
    // "questions" surface) must still auto-close the workbench on
    // submit/cancel when uiCommandDispatcher issues it with
    // meta.closeWorkbenchOnDone (set whenever openSurface is dispatched
    // while the workbench is closed). Collapsing the open-file paths into
    // openFileCore must not silently drop this for non-file surfaces.
    let surface: SurfaceShellApi | undefined
    const onClose = vi.fn()
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("questions", { title: "Questions", placement: "center", component: () => null })
    const surfaceResolverRegistry = new SurfaceResolverRegistry()
    surfaceResolverRegistry.register("questions", {
      source: "builtin",
      resolve: (request) => request.kind === "questions"
        ? { id: "questions", component: "questions", params: {}, score: 0 }
        : undefined,
    })

    renderSurface(
      "workspace-a",
      { onReady: (api) => { surface = api }, onClose },
      panelRegistry,
      surfaceResolverRegistry,
    )
    await waitFor(() => expect(surface).toBeDefined())

    act(() => {
      surface?.openSurface({ kind: "questions", target: "questions", meta: { closeWorkbenchOnDone: true } })
    })

    expect(mockAddPanel).toHaveBeenCalledWith(expect.objectContaining({
      id: "questions",
      component: "questions",
      params: expect.objectContaining({ __closeWorkbenchOnDone: onClose }),
    }))
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

    act(() => {
      surface?.expandToFile("/workspace/reports ", { filesystem: "user" })
    })
    expect(capturedRevealRequests).toContainEqual({
      path: "/workspace/reports ",
      seq: 3,
      filesystem: "user",
    })
    await waitFor(() => expect(capturedRevealRequest).toBeNull())

    const deliveredRequestCount = capturedRevealRequests.length
    act(() => surface?.closeWorkbenchLeftPane())
    act(() => capturedWorkbenchProps.onExpand?.("files"))
    await waitFor(() => expect(screen.getByTestId("mock-left-pane")).toBeInTheDocument())
    expect(capturedRevealRequests).toHaveLength(deliveredRequestCount)
    expect(capturedRevealRequest).toBeNull()
  })

  it("auto-collapses the workbench source pane to the rail when opening a workspace-page panel", async () => {
    let surface: SurfaceShellApi | undefined
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("plugin.page", { title: "Plugin Page", placement: "workspace-page", component: () => null })

    renderSurface("workspace-a", { onReady: (api) => { surface = api } }, panelRegistry)
    expect(screen.getByLabelText("Workbench sources and activity rail")).toBeInTheDocument()
    await waitFor(() => expect(surface).toBeDefined())

    act(() => {
      surface?.openPanel({ id: "plugin.page", component: "plugin.page", title: "Plugin Page" })
    })

    expect(mockAddPanel).toHaveBeenCalledWith(expect.objectContaining({ id: "plugin.page", component: "plugin.page" }))
    expect(screen.getByLabelText("Workbench sources and activity rail")).toHaveAttribute("data-boring-state", "rail")
  })

  it("keeps the workbench left pane open when opening a shared-dockview panel", async () => {
    let surface: SurfaceShellApi | undefined
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("plugin.chart", { title: "Plugin Chart", placement: "shared-dockview", component: () => null })

    renderSurface("workspace-a", { onReady: (api) => { surface = api } }, panelRegistry)
    expect(screen.getByLabelText("Workbench sources and activity rail")).toBeInTheDocument()
    await waitFor(() => expect(surface).toBeDefined())

    act(() => {
      surface?.openPanel({ id: "plugin.chart", component: "plugin.chart", title: "Plugin Chart" })
    })

    expect(mockAddPanel).toHaveBeenCalledWith(expect.objectContaining({ id: "plugin.chart", component: "plugin.chart" }))
    expect(screen.getByLabelText("Workbench sources and activity rail")).toBeInTheDocument()
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

  it("owns fullscreen and close controls in the expanded Workbench header", () => {
    const onClose = vi.fn()
    const onToggleFullscreen = vi.fn()
    const { rerender } = renderSurface("workspace-a", {
      onClose,
      onHostToggleFullscreen: onToggleFullscreen,
    })

    const headerActions = screen.getByRole("button", { name: "Fullscreen workbench" }).closest('[data-boring-workspace-part="workbench-header-actions"]')
    expect(headerActions).not.toBeNull()
    const closeWorkbench = screen.getByRole("button", { name: "Close workbench" })
    expect(closeWorkbench).toHaveAttribute("data-size", "icon-sm")
    expect(closeWorkbench.querySelector("svg")).toHaveClass("lucide-panel-right-close", "size-4")
    fireEvent.click(screen.getByRole("button", { name: "Fullscreen workbench" }))
    fireEvent.click(screen.getByRole("button", { name: "Close workbench" }))
    expect(onToggleFullscreen).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()

    rerender(
      <RegistryProvider
        panelRegistry={new PanelRegistry()}
        commandRegistry={new CommandRegistry()}
        surfaceResolverRegistry={new SurfaceResolverRegistry()}
      >
        <SurfaceShell
          storageKey="workspace-a"
          hostFullscreen
          onClose={onClose}
          onHostToggleFullscreen={onToggleFullscreen}
        />
      </RegistryProvider>,
    )
    expect(screen.getByRole("button", { name: "Restore split view" })).toBeInTheDocument()
  })

  it("hides expanded-header actions in rail-only mode and delegates reopen to the rail", () => {
    const onHostExpand = vi.fn()
    renderSurface("workspace-a", {
      hostRailOnly: true,
      onClose: vi.fn(),
      onHostExpand,
      onHostToggleFullscreen: vi.fn(),
    })

    expect(screen.queryByRole("button", { name: "Close workbench" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Fullscreen workbench" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Open workbench" }))
    expect(onHostExpand).toHaveBeenCalledOnce()
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

    const sidebar = screen.getByLabelText("Workbench sources and activity rail")
    expect(sidebar).toBeInTheDocument()
    expect(sidebar).toHaveAttribute("data-boring-state", "expanded")
    await waitFor(() => expect(surface).toBeDefined())

    act(() => {
      surface?.closeWorkbenchLeftPane()
    })

    expect(screen.getByLabelText("Workbench sources and activity rail")).toHaveAttribute("data-boring-state", "rail")

    act(() => capturedWorkbenchProps.onExpand("files"))

    expect(screen.getByLabelText("Workbench sources and activity rail")).toHaveAttribute("data-boring-state", "expanded")
  })
})
