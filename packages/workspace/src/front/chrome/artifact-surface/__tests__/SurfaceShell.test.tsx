import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"
import { SurfaceShell, type SurfaceShellApi, type SurfaceShellProps } from "../SurfaceShell"
import { RegistryProvider } from "../../../registry"
import { PanelRegistry } from "../../../registry/PanelRegistry"
import { CommandRegistry } from "../../../../shared/plugins/CommandRegistry"
import { SurfaceResolverRegistry } from "../../../../shared/plugins/SurfaceResolverRegistry"
import { WORKSPACE_OPEN_PATH_SURFACE_KIND } from "../../../../shared/types/surface"

vi.mock("../../workbench-left/WorkbenchLeftPane", () => ({
  WorkbenchLeftPane: () => <div data-testid="mock-left-pane" />,
}))

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

function readStoredTabs(storageKey: string) {
  const raw = localStorage.getItem(`${storageKey}:workspaceTabs`)
  return raw ? JSON.parse(raw) as { tabs: Array<{ id: string; component: string; title: string }>; activeTab: string | null } : null
}

describe("SurfaceShell", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("persists workspace tabs under the workspace-scoped storage key", async () => {
    let surface: SurfaceShellApi | undefined
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("chart", { title: "Chart", placement: "center", component: () => <div>Chart panel</div> })

    renderSurface("workspace-a", { onReady: (api) => { surface = api } }, panelRegistry)
    await waitFor(() => expect(surface).toBeDefined())

    act(() => {
      surface?.openPanel({ id: "chart:gdp", component: "chart", title: "GDP" })
    })

    await waitFor(() => {
      expect(readStoredTabs("workspace-a")?.tabs.map((tab) => tab.id)).toContain("chart:gdp")
    })
    expect(readStoredTabs("workspace-a")?.activeTab).toBe("chart:gdp")
  })

  it("restores persisted workspace tabs when remounted with the same storage key", async () => {
    localStorage.setItem("workspace-a:workspaceTabs", JSON.stringify({
      v: 1,
      tabs: [{ id: "chart:gdp", component: "chart", title: "GDP", kind: "plugin", filetreeOpen: false }],
      activeTab: "chart:gdp",
    }))
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("chart", { title: "Chart", placement: "center", component: () => <div>Restored chart</div> })

    renderSurface("workspace-a", {}, panelRegistry)

    expect(await screen.findByRole("button", { name: "Activate GDP" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("Restored chart")).toBeInTheDocument()
  })

  it("switches to a different workspace tab set when the storage key changes", async () => {
    localStorage.setItem("workspace-a:workspaceTabs", JSON.stringify({
      v: 1,
      tabs: [{ id: "chart:a", component: "chart", title: "A", kind: "plugin", filetreeOpen: false }],
      activeTab: "chart:a",
    }))
    localStorage.setItem("workspace-b:workspaceTabs", JSON.stringify({
      v: 1,
      tabs: [{ id: "chart:b", component: "chart", title: "B", kind: "plugin", filetreeOpen: false }],
      activeTab: "chart:b",
    }))
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("chart", { title: "Chart", placement: "center", component: () => <div>Chart panel</div> })

    const { rerender } = renderSurface("workspace-a", {}, panelRegistry)
    expect(await screen.findByRole("button", { name: "Activate A" })).toBeInTheDocument()

    rerender(
      <RegistryProvider panelRegistry={panelRegistry} commandRegistry={new CommandRegistry()} surfaceResolverRegistry={new SurfaceResolverRegistry()}>
        <SurfaceShell storageKey="workspace-b" />
      </RegistryProvider>,
    )

    expect(await screen.findByRole("button", { name: "Activate B" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Activate A" })).not.toBeInTheDocument()
  })

  it("routes file opens through the latest matching surface resolver before reusing stale file tabs", async () => {
    let surface: SurfaceShellApi | undefined
    const panelRegistry = new PanelRegistry()
    panelRegistry.register("editor", { title: "Editor", placement: "center", component: () => <div>Editor</div> })
    panelRegistry.register("hot-csv.panel", { title: "Hot CSV", placement: "center", component: () => <div>CSV</div> })
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

    renderSurface("workspace-a", { onReady: (api) => { surface = api } }, panelRegistry, surfaceResolverRegistry)
    await waitFor(() => expect(surface).toBeDefined())

    act(() => {
      surface?.openSurface({ kind: WORKSPACE_OPEN_PATH_SURFACE_KIND, target: "data.csv" })
    })

    await waitFor(() => expect(surface?.getSnapshot().activeTab).toBe("hot-csv:data.csv"))
    expect(screen.getByRole("button", { name: "Activate data.csv" })).toBeInTheDocument()
  })

  it("renders a reachable close-workbench button as an overlay regardless of tab state", async () => {
    renderSurface("workspace-a", { onClose: vi.fn() })

    expect(await screen.findByRole("button", { name: "Close workbench" })).toBeInTheDocument()
  })

  it("omits the close-workbench button when no onClose handler is provided", () => {
    renderSurface("workspace-a")

    expect(screen.queryByRole("button", { name: "Close workbench" })).not.toBeInTheDocument()
  })

  it("exposes an API command to close the workbench left pane", async () => {
    let surface: SurfaceShellApi | undefined
    renderSurface("workspace-a", {
      onReady: (api) => {
        surface = api
      },
    })

    expect(screen.getByLabelText("Files")).toBeInTheDocument()
    await waitFor(() => expect(surface).toBeDefined())

    act(() => {
      surface?.closeWorkbenchLeftPane()
    })

    expect(screen.queryByLabelText("Files")).not.toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Show file tree" }).length).toBeGreaterThan(0)
  })
})
