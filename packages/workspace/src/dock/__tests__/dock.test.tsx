import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { DockviewShell, useDockviewApi, DockviewApiContext } from "../DockviewShell"
import { ShadcnTab } from "../ShadcnTab"
import { PanelChrome, createLifecycleApi } from "../PanelChrome"
import { RegistryProvider } from "../../registry"
import { PanelRegistry } from "../../registry/PanelRegistry"
import { CommandRegistry } from "../../registry/CommandRegistry"
import { bindStore } from "../../store/selectors"
import { createWorkspaceStore } from "../../store"
import type { LayoutConfig, DockviewShellApi } from "../types"

function DummyPanel() {
  return <div data-testid="dummy-panel">Panel content</div>
}

function setupStoreAndRegistry() {
  const store = createWorkspaceStore()
  bindStore(store)

  const panelRegistry = new PanelRegistry()
  panelRegistry.register("explorer", { title: "Explorer", component: DummyPanel })
  panelRegistry.register("editor", { title: "Editor", component: DummyPanel })
  const commandRegistry = new CommandRegistry()

  return { store, panelRegistry, commandRegistry }
}

const simpleLayout: LayoutConfig = {
  version: "2.0",
  groups: [
    { id: "sidebar", position: "left", panel: "explorer" },
    { id: "main", position: "center", panel: "editor" },
  ],
}

describe("DockviewShell", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("shows loading skeleton when hydration is incomplete", async () => {
    const { panelRegistry, commandRegistry } = setupStoreAndRegistry()

    // Mock useHydrationComplete to return false to simulate pre-hydration state
    const selectorsModule = await import("../../store/selectors")
    const spy = vi.spyOn(selectorsModule, "useHydrationComplete").mockReturnValue(false)

    render(
      <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry}>
        <DockviewShell layout={simpleLayout} />
      </RegistryProvider>,
    )

    expect(screen.getByText("Loading workspace...")).toBeInTheDocument()
    spy.mockRestore()
  })

  it("renders DockviewReact when hydration is complete", () => {
    const { panelRegistry, commandRegistry } = setupStoreAndRegistry()

    const { container } = render(
      <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry}>
        <DockviewShell layout={simpleLayout} className="test-shell" />
      </RegistryProvider>,
    )

    expect(container.querySelector(".dv-shell")).toBeInTheDocument()
    expect(container.querySelector(".test-shell")).toBeInTheDocument()
  })

  it("calls onReady when layout is initialized", () => {
    const { panelRegistry, commandRegistry } = setupStoreAndRegistry()
    const onReady = vi.fn()

    render(
      <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry}>
        <DockviewShell layout={simpleLayout} onReady={onReady} />
      </RegistryProvider>,
    )

    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onReady).toHaveBeenCalledWith(expect.objectContaining({
      addPanel: expect.any(Function),
    }))
  })

  it("filters components when allowedPanels is set", () => {
    const { panelRegistry, commandRegistry } = setupStoreAndRegistry()
    const onReady = vi.fn()

    render(
      <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry}>
        <DockviewShell
          layout={{
            version: "2.0",
            groups: [
              { id: "main", position: "center", panel: "explorer" },
            ],
          }}
          allowedPanels={["explorer"]}
          onReady={onReady}
        />
      </RegistryProvider>,
    )

    expect(onReady).toHaveBeenCalled()
  })

  it("logs error and throws in dev for unknown panel ID", () => {
    const { panelRegistry, commandRegistry } = setupStoreAndRegistry()
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    expect(() =>
      render(
        <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry}>
          <DockviewShell
            layout={{
              version: "2.0",
              groups: [
                { id: "main", position: "center", panel: "nonexistent" },
              ],
            }}
          />
        </RegistryProvider>,
      ),
    ).toThrow("Unknown panel ID: nonexistent")

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("nonexistent"),
    )
  })
})

describe("useDockviewApi", () => {
  it("throws when used outside DockviewShell", () => {
    function BadComponent() {
      useDockviewApi()
      return null
    }

    expect(() =>
      render(<BadComponent />),
    ).toThrow("useDockviewApi must be used within a DockviewShell")
  })
})

describe("PanelChrome", () => {
  it("renders title and children", () => {
    render(
      <PanelChrome title="Test Panel">
        <div>child content</div>
      </PanelChrome>,
    )

    expect(screen.getByText("Test Panel")).toBeInTheDocument()
    expect(screen.getByText("child content")).toBeInTheDocument()
  })

  it("renders icon when provided", () => {
    function TestIcon({ className }: { className?: string }) {
      return <svg data-testid="panel-icon" className={className} />
    }

    render(
      <PanelChrome title="With Icon" icon={TestIcon}>
        <div />
      </PanelChrome>,
    )

    expect(screen.getByTestId("panel-icon")).toBeInTheDocument()
  })

  it("hides close button when essential", () => {
    render(
      <PanelChrome title="Essential" essential>
        <div />
      </PanelChrome>,
    )

    expect(screen.queryByLabelText(/close/i)).not.toBeInTheDocument()
  })
})

describe("createLifecycleApi", () => {
  it("wraps DockviewPanelApi correctly", () => {
    const mockPanelApi = {
      id: "panel-1",
      title: "My Panel",
      setTitle: vi.fn(),
      close: vi.fn(),
      setActive: vi.fn(),
      isActive: true,
    }

    const lifecycle = createLifecycleApi(mockPanelApi as any)

    expect(lifecycle.panelId).toBe("panel-1")
    expect(lifecycle.title).toBe("My Panel")
    expect(lifecycle.isActive).toBe(true)

    lifecycle.setTitle("New Title")
    expect(mockPanelApi.setTitle).toHaveBeenCalledWith("New Title")

    lifecycle.close()
    expect(mockPanelApi.close).toHaveBeenCalled()

    lifecycle.focus()
    expect(mockPanelApi.setActive).toHaveBeenCalled()
  })

  it("falls back to id when title is undefined", () => {
    const mockPanelApi = {
      id: "fallback-id",
      title: undefined,
      setTitle: vi.fn(),
      close: vi.fn(),
      setActive: vi.fn(),
      isActive: false,
    }

    const lifecycle = createLifecycleApi(mockPanelApi as any)
    expect(lifecycle.title).toBe("fallback-id")
  })
})

describe("DockviewShellApi via onReady", () => {
  it("onReady provides a DockviewApi with expected methods", () => {
    const { panelRegistry, commandRegistry } = setupStoreAndRegistry()
    const onReady = vi.fn()

    render(
      <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry}>
        <DockviewShell layout={simpleLayout} onReady={onReady} />
      </RegistryProvider>,
    )

    expect(onReady).toHaveBeenCalledTimes(1)
    const api = onReady.mock.calls[0][0]
    expect(typeof api.addPanel).toBe("function")
    expect(typeof api.removePanel).toBe("function")
    expect(typeof api.getPanel).toBe("function")
    expect(typeof api.toJSON).toBe("function")
  })

  it("DockviewApiContext provides DockviewShellApi to descendants", () => {
    const { panelRegistry, commandRegistry } = setupStoreAndRegistry()
    let capturedApi: DockviewShellApi | null = null

    panelRegistry.register("api-test", {
      title: "API Test",
      component: function ApiTestPanel() {
        capturedApi = useDockviewApi()
        return <div>test</div>
      },
    })

    render(
      <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry}>
        <DockviewShell
          layout={{
            version: "2.0",
            groups: [{ id: "main", position: "center", panel: "api-test" }],
          }}
        />
      </RegistryProvider>,
    )

    expect(capturedApi).not.toBeNull()
    expect(typeof capturedApi!.addPanel).toBe("function")
    expect(typeof capturedApi!.removePanel).toBe("function")
    expect(typeof capturedApi!.activatePanel).toBe("function")
    expect(typeof capturedApi!.movePanel).toBe("function")
    expect(typeof capturedApi!.getActivePanel).toBe("function")
    expect(typeof capturedApi!.toJSON).toBe("function")
  })
})

describe("DockviewShell — allowedPanels filtering", () => {
  it("allowedPanels excludes unallowed panels from components", () => {
    const { panelRegistry, commandRegistry } = setupStoreAndRegistry()
    panelRegistry.register("secret", { title: "Secret", component: DummyPanel })

    render(
      <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry}>
        <DockviewShell
          layout={{
            version: "2.0",
            groups: [
              { id: "main", position: "center", panel: "explorer" },
            ],
          }}
          allowedPanels={["explorer"]}
        />
      </RegistryProvider>,
    )

    expect(panelRegistry.has("secret")).toBe(true)
  })
})

describe("DockviewShell — multi-group layout", () => {
  it("renders layout with multiple groups", () => {
    const { panelRegistry, commandRegistry } = setupStoreAndRegistry()
    const onReady = vi.fn()

    render(
      <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry}>
        <DockviewShell
          layout={{
            version: "2.0",
            groups: [
              { id: "sidebar", position: "left", panel: "explorer" },
              { id: "main", position: "center", panel: "editor" },
            ],
          }}
          onReady={onReady}
        />
      </RegistryProvider>,
    )

    expect(onReady).toHaveBeenCalledTimes(1)
  })
})

describe("ShadcnTab", () => {
  it("renders tab title and close button", () => {
    const mockApi = {
      title: "My Tab",
      id: "tab-1",
      close: vi.fn(),
    }

    render(<ShadcnTab api={mockApi as any} containerApi={{} as any} params={{}} tabLocation={"header" as any} />)

    expect(screen.getByText("My Tab")).toBeInTheDocument()
    expect(screen.getByLabelText("Close My Tab")).toBeInTheDocument()
  })

  it("falls back to id when title is undefined", () => {
    const mockApi = {
      title: undefined,
      id: "fallback-id",
      close: vi.fn(),
    }

    render(<ShadcnTab api={mockApi as any} containerApi={{} as any} params={{}} tabLocation={"header" as any} />)

    expect(screen.getByText("fallback-id")).toBeInTheDocument()
  })
})

describe("types", () => {
  it("LayoutConfig has required shape", () => {
    const layout: LayoutConfig = {
      version: "2.0",
      groups: [
        { id: "main", position: "center" },
        {
          id: "sidebar",
          position: "left",
          panel: "explorer",
          locked: true,
          hideHeader: false,
          dynamic: true,
          placeholder: "empty-placeholder",
          collapsible: true,
          collapsedWidth: 48,
          constraints: { minWidth: 200, maxWidth: 400 },
        },
      ],
    }
    expect(layout.groups).toHaveLength(2)
    expect(layout.groups[1].constraints?.minWidth).toBe(200)
  })
})
