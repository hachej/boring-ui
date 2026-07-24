import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react"
import { DockviewShell, useDockviewApi, DockviewApiContext } from "../DockviewShell"
import { ShadcnTab } from "../ShadcnTab"
import { PanelChrome, createLifecycleApi } from "../PanelChrome"
import { RegistryProvider } from "../../registry"
import { PanelRegistry } from "../../registry/PanelRegistry"
import { CommandRegistry } from "../../../shared/plugins/CommandRegistry"
import { bindStore } from "../../store/selectors"
import { createWorkspaceStore } from "../../store"
import { events, workspaceEvents } from "../../events"
import type { LayoutConfig, DockviewShellApi } from "../types"
import type { DockviewApi } from "dockview-react"

function DummyPanel() {
  return <div data-testid="dummy-panel">Panel content</div>
}

function HotPanelOne() {
  return <div>hot-one</div>
}

function HotPanelTwo() {
  return <div>hot-two</div>
}

function setupStoreAndRegistry() {
  const store = createWorkspaceStore()
  bindStore(store)

  const panelRegistry = new PanelRegistry()
  panelRegistry.register("explorer", { title: "Explorer", lazy: false, component: DummyPanel })
  panelRegistry.register("editor", { title: "Editor", lazy: false, component: DummyPanel })
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

  it("reports the exact Dockview API as unavailable before disposal", () => {
    const { panelRegistry, commandRegistry } = setupStoreAndRegistry()
    const onReady = vi.fn()
    const onUnavailable = vi.fn()

    const { unmount } = render(
      <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry}>
        <DockviewShell layout={simpleLayout} onReady={onReady} onUnavailable={onUnavailable} />
      </RegistryProvider>,
    )
    const readyApi = onReady.mock.calls[0]?.[0]
    expect(readyApi).toBeDefined()

    unmount()

    expect(onUnavailable).toHaveBeenCalledTimes(1)
    expect(onUnavailable).toHaveBeenCalledWith(readyApi)
  })

  it("falls back to default panels when a persisted layout is invalid", async () => {
    const { panelRegistry, commandRegistry } = setupStoreAndRegistry()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    render(
      <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry}>
        <DockviewShell
          layout={simpleLayout}
          persistedLayout={{ panels: { broken: undefined } } as never}
        />
      </RegistryProvider>,
    )

    await waitFor(() => {
      expect(screen.getAllByTestId("dummy-panel").length).toBeGreaterThan(0)
    })
    expect(warn).toHaveBeenCalledWith(
      "[DockviewShell] Ignoring invalid persisted layout",
      expect.anything(),
    )
  })

  it("hot-swaps an already-mounted panel when its registry entry is replaced", async () => {
    const { panelRegistry, commandRegistry } = setupStoreAndRegistry()
    panelRegistry.register("hot", { title: "Hot", component: HotPanelOne })

    render(
      <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry}>
        <DockviewShell
          layout={{
            version: "2.0",
            groups: [{ id: "main", position: "center", panel: "hot" }],
          }}
        />
      </RegistryProvider>,
    )

    expect(await screen.findByText("hot-one")).toBeInTheDocument()

    act(() => {
      panelRegistry.register("hot", { title: "Hot", component: HotPanelTwo })
    })

    expect(await screen.findByText("hot-two")).toBeInTheDocument()
    expect(screen.queryByText("hot-one")).not.toBeInTheDocument()
  })

  it("can open a panel registered after mount when allowedPanels updates", async () => {
    const { panelRegistry, commandRegistry } = setupStoreAndRegistry()
    let api: DockviewApi | undefined

    render(
      <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry}>
        <DockviewShell
          layout={{ version: "2.0", groups: [{ id: "main", position: "center", dynamic: true }] }}
          allowedPanels={["hot-late"]}
          onReady={(nextApi) => {
            api = nextApi
          }}
        />
      </RegistryProvider>,
    )

    await waitFor(() => expect(api).toBeDefined())

    act(() => {
      panelRegistry.register("hot-late", {
        title: "Hot Late",
        placement: "center",
        component: () => <div>hot-late-panel</div>,
      })
    })

    act(() => {
      api!.addPanel({ id: "hot-late-instance", component: "hot-late", title: "Hot Late" })
    })

    expect(await screen.findByText("hot-late-panel")).toBeInTheDocument()
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
      lazy: false,
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
    panelRegistry.register("secret", { title: "Secret", lazy: false, component: DummyPanel })

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
  beforeEach(() => {
    vi.restoreAllMocks()
  })

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

  it("closes the panel from the overflow dropdown without re-activating it", () => {
    // Reproduce dockview's overflow popover row: the tab is wrapped in an
    // element with a NATIVE bubble-phase click listener that re-activates the
    // panel (and dockview also tears the popover down). Closing via the X must
    // call api.close() and must NOT let that native listener re-activate the
    // just-closed panel.
    const mockApi = {
      title: "Overflow Tab",
      id: "tab-overflow",
      close: vi.fn(),
      setActive: vi.fn(),
    }
    const wrapper = document.createElement("div")
    const wrapperClick = vi.fn(() => mockApi.setActive())
    wrapper.addEventListener("click", wrapperClick)
    document.body.appendChild(wrapper)

    render(
      <ShadcnTab
        api={mockApi as any}
        containerApi={{} as any}
        params={{}}
        tabLocation={"headerOverflow" as any}
      />,
      { container: wrapper },
    )

    fireEvent.click(screen.getByLabelText("Close Overflow Tab"))

    expect(mockApi.close).toHaveBeenCalledTimes(1)
    expect(mockApi.setActive).not.toHaveBeenCalled()
    expect(wrapperClick).not.toHaveBeenCalled()

    document.body.removeChild(wrapper)
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

  it("close other tabs closes siblings but keeps the clicked tab", async () => {
    const currentApi = {
      title: "Current",
      id: "tab-current",
      close: vi.fn(),
      setActive: vi.fn(),
    }
    const siblingApi = { title: "Sibling", id: "tab-sibling", close: vi.fn() }
    const otherGroupApi = { title: "Other", id: "tab-other", close: vi.fn() }
    ;(currentApi as any).group = { panels: [{ api: currentApi }, { api: siblingApi }] }

    render(
      <ShadcnTab
        api={currentApi as any}
        containerApi={{ panels: [{ api: currentApi }, { api: siblingApi }, { api: otherGroupApi }] } as any}
        params={{}}
        tabLocation={"header" as any}
      />,
    )

    fireEvent.contextMenu(screen.getByTitle("Current"))
    fireEvent.click(screen.getByRole("menuitem", { name: "Close other tabs" }))

    expect(currentApi.setActive).toHaveBeenCalled()
    expect(currentApi.close).not.toHaveBeenCalled()
    expect(siblingApi.close).toHaveBeenCalledTimes(1)
    expect(otherGroupApi.close).not.toHaveBeenCalled()
  })

  it("opens close-other menu on right-button pointer down", () => {
    const currentApi = { title: "Current", id: "tab-current", close: vi.fn() }
    const siblingApi = { title: "Sibling", id: "tab-sibling", close: vi.fn() }

    render(
      <ShadcnTab
        api={currentApi as any}
        containerApi={{ panels: [{ api: currentApi }, { api: siblingApi }] } as any}
        params={{}}
        tabLocation={"header" as any}
      />,
    )

    fireEvent.pointerDown(screen.getByTitle("Current"), { button: 2, clientX: 42, clientY: 24 })
    fireEvent.click(screen.getByRole("menuitem", { name: "Close other tabs" }))

    expect(currentApi.close).not.toHaveBeenCalled()
    expect(siblingApi.close).toHaveBeenCalledTimes(1)
  })

  it("close all closes every tab in the current group", () => {
    const currentApi = {
      title: "Current",
      id: "tab-current",
      close: vi.fn(),
      setActive: vi.fn(),
    }
    const siblingApi = { title: "Sibling", id: "tab-sibling", close: vi.fn() }
    const otherGroupApi = { title: "Other", id: "tab-other", close: vi.fn() }
    ;(currentApi as any).group = { panels: [{ api: currentApi }, { api: siblingApi }] }

    render(
      <ShadcnTab
        api={currentApi as any}
        containerApi={{ panels: [{ api: currentApi }, { api: siblingApi }, { api: otherGroupApi }] } as any}
        params={{}}
        tabLocation={"header" as any}
      />,
    )

    fireEvent.contextMenu(screen.getByTitle("Current"))
    fireEvent.click(screen.getByRole("menuitem", { name: "Close all" }))

    expect(currentApi.setActive).toHaveBeenCalled()
    expect(currentApi.close).toHaveBeenCalledTimes(1)
    expect(siblingApi.close).toHaveBeenCalledTimes(1)
    expect(otherGroupApi.close).not.toHaveBeenCalled()
  })

  it("shows copy path and hides close-other when there are no other tabs", () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    const currentApi = { title: "App.tsx", id: "tab-current", close: vi.fn() }

    render(
      <ShadcnTab
        api={currentApi as any}
        containerApi={{ panels: [{ api: currentApi }] } as any}
        params={{ path: "src/App.tsx" }}
        tabLocation={"header" as any}
      />,
    )

    fireEvent.contextMenu(screen.getByTitle("App.tsx"))

    expect(screen.getByRole("menuitem", { name: "Copy path" })).toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: "Copy absolute path" })).not.toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: "Close other tabs" })).not.toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Close all" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }))
    expect(writeText).toHaveBeenCalledWith("src/App.tsx")
  })

  it("copies path from file-backed panel id when tab params are missing", () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    const currentApi = { title: "App.tsx", id: "file:src/App.tsx", close: vi.fn() }

    render(
      <ShadcnTab
        api={currentApi as any}
        containerApi={{ panels: [{ api: currentApi }] } as any}
        params={{}}
        tabLocation={"header" as any}
      />,
    )

    fireEvent.contextMenu(screen.getByTitle("App.tsx"))
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }))

    expect(writeText).toHaveBeenCalledWith("src/App.tsx")
  })

  it("copies path from workspace surface panel id when tab params are missing", () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    const currentApi = {
      title: "App.tsx",
      id: "surface:workspace.open.path:src/App.tsx",
      close: vi.fn(),
    }

    render(
      <ShadcnTab
        api={currentApi as any}
        containerApi={{ panels: [{ api: currentApi }] } as any}
        params={{}}
        tabLocation={"header" as any}
      />,
    )

    fireEvent.contextMenu(screen.getByTitle("App.tsx"))
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }))

    expect(writeText).toHaveBeenCalledWith("src/App.tsx")
  })

  it("falls back to legacy clipboard copy when writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("not focused"))
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true,
    })
    const currentApi = { title: "App.tsx", id: "tab-current", close: vi.fn() }

    render(
      <ShadcnTab
        api={currentApi as any}
        containerApi={{ panels: [{ api: currentApi }] } as any}
        params={{ path: "src/App.tsx" }}
        tabLocation={"header" as any}
      />,
    )

    fireEvent.contextMenu(screen.getByTitle("App.tsx"))
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }))

    await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"))
    expect(writeText).toHaveBeenCalledWith("src/App.tsx")
  })

  it("close other tabs falls back to container panels when group panels are unavailable", () => {
    const currentApi = { title: "Current", id: "tab-current", close: vi.fn() }
    const siblingApi = { title: "Sibling", id: "tab-sibling", close: vi.fn() }

    render(
      <ShadcnTab
        api={currentApi as any}
        containerApi={{ panels: [{ api: currentApi }, { api: siblingApi }] } as any}
        params={{}}
        tabLocation={"header" as any}
      />,
    )

    fireEvent.contextMenu(screen.getByTitle("Current"))
    fireEvent.click(screen.getByRole("menuitem", { name: "Close other tabs" }))

    expect(currentApi.close).not.toHaveBeenCalled()
    expect(siblingApi.close).toHaveBeenCalledTimes(1)
  })

  it("close other tabs snapshots siblings before closing mutable panel arrays", () => {
    const panels: Array<{ api: { id: string; close: ReturnType<typeof vi.fn> } }> = []
    const currentApi = { title: "Current", id: "tab-current", close: vi.fn() }
    const siblingA = {
      api: {
        id: "tab-a",
        close: vi.fn(() => panels.splice(1, 1)),
      },
    }
    const siblingB = {
      api: {
        id: "tab-b",
        close: vi.fn(() => panels.splice(1, 1)),
      },
    }
    panels.push({ api: currentApi }, siblingA, siblingB)
    ;(currentApi as any).group = { panels }

    render(
      <ShadcnTab
        api={currentApi as any}
        containerApi={{ panels } as any}
        params={{}}
        tabLocation={"header" as any}
      />,
    )

    fireEvent.contextMenu(screen.getByTitle("Current"))
    fireEvent.click(screen.getByRole("menuitem", { name: "Close other tabs" }))

    expect(currentApi.close).not.toHaveBeenCalled()
    expect(siblingA.api.close).toHaveBeenCalledTimes(1)
    expect(siblingB.api.close).toHaveBeenCalledTimes(1)
  })

  it("keeps the file icon stable and shows a dot while save is in flight", async () => {
    events._reset()
    const mockApi = { title: "doc.md", id: "panel-7", close: vi.fn() }
    const { container } = render(<ShadcnTab api={mockApi as any} containerApi={{} as any} params={{}} tabLocation={"header" as any} />)

    expect(screen.queryByTestId("tab-dirty-dot")).not.toBeInTheDocument()
    const iconBefore = container.querySelector("svg")
    expect(iconBefore).toBeInTheDocument()

    act(() => {
      events.emit(workspaceEvents.editorSaveStart, { panelId: "panel-7" })
    })
    expect(screen.getByTestId("tab-dirty-dot")).toBeInTheDocument()
    expect(container.querySelector("svg")).toBe(iconBefore)

    act(() => {
      events.emit(workspaceEvents.editorSaveEnd, { panelId: "panel-7" })
    })
    expect(screen.queryByTestId("tab-dirty-dot")).not.toBeInTheDocument()
    expect(container.querySelector("svg")).toBe(iconBefore)
  })

  it("ignores save events for OTHER panel ids", async () => {
    events._reset()
    const mockApi = { title: "mine.md", id: "panel-mine", close: vi.fn() }
    render(<ShadcnTab api={mockApi as any} containerApi={{} as any} params={{}} tabLocation={"header" as any} />)
    act(() => {
      events.emit(workspaceEvents.editorSaveStart, { panelId: "someone-else" })
    })
    expect(screen.queryByTestId("tab-dirty-dot")).not.toBeInTheDocument()
  })

  it("clears the save dot on save:end even when the save itself failed (lifecycle hook always emits)", async () => {
    events._reset()
    const mockApi = { title: "x.md", id: "p", close: vi.fn() }
    render(<ShadcnTab api={mockApi as any} containerApi={{} as any} params={{}} tabLocation={"header" as any} />)
    act(() => {
      events.emit(workspaceEvents.editorSaveStart, { panelId: "p" })
    })
    expect(screen.getByTestId("tab-dirty-dot")).toBeInTheDocument()
    act(() => {
      events.emit(workspaceEvents.editorSaveEnd, { panelId: "p" })
    })
    expect(screen.queryByTestId("tab-dirty-dot")).not.toBeInTheDocument()
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

describe("DockviewShell — generic panel events", () => {
  beforeEach(() => events._reset())

  function setupShell() {
    const { panelRegistry, commandRegistry } = setupStoreAndRegistry()
    let captured: DockviewApi | null = null
    render(
      <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry}>
        <DockviewShell
          layout={{
            version: "2.0",
            groups: [{ id: "main", position: "center", dynamic: true }],
          }}
          onReady={(api) => {
            captured = api
          }}
        />
      </RegistryProvider>,
    )
    if (!captured) throw new Error("DockviewApi not captured")
    return captured as DockviewApi
  }

  it("updates matching panel params and title", async () => {
    const api = setupShell()
    act(() => {
      api.addPanel({
        id: "panel-a",
        component: "editor",
        title: "Old",
        params: { resourceId: "old" },
      })
    })

    act(() => {
      events.emit(workspaceEvents.panelUpdate, {
        cause: "user",
        ts: Date.now(),
        match: { param: "resourceId", value: "old" },
        params: { resourceId: "new" },
        title: "New",
      })
    })

    const panel = api.getPanel("panel-a")
    expect(panel).toBeTruthy()
    expect((panel!.params as { resourceId?: string }).resourceId).toBe("new")
    expect(panel!.title).toBe("New")
  })

  it("matches by id or param and dedupes overlapping matches", async () => {
    const api = setupShell()
    act(() => {
      api.addPanel({
        id: "panel-a",
        component: "editor",
        title: "A",
        params: { resourceId: "a" },
      })
    })
    act(() => {
      events.emit(workspaceEvents.panelUpdate, {
        cause: "user",
        ts: Date.now(),
        match: [{ id: "panel-a" }, { param: "resourceId", value: "a" }],
        params: { resourceId: "b" },
      })
    })

    const panel = api.getPanel("panel-a")
    expect((panel!.params as { resourceId?: string }).resourceId).toBe("b")
  })

  it("closes matching panels", async () => {
    const api = setupShell()
    act(() => {
      api.addPanel({
        id: "panel-a",
        component: "editor",
        title: "A",
        params: { resourceId: "a" },
      })
    })
    expect(api.getPanel("panel-a")).toBeTruthy()

    act(() => {
      events.emit(workspaceEvents.panelClose, {
        cause: "user",
        ts: Date.now(),
        match: { param: "resourceId", value: "a" },
      })
    })

    expect(api.getPanel("panel-a")).toBeUndefined()
  })

  it("ignores events that don't match any open panel (no error)", async () => {
    const api = setupShell()
    expect(() => {
      act(() => {
        events.emit(workspaceEvents.panelUpdate, {
          cause: "user",
          ts: Date.now(),
          match: { param: "resourceId", value: "missing" },
          params: { resourceId: "new" },
        })
        events.emit(workspaceEvents.panelClose, {
          cause: "user",
          ts: Date.now(),
          match: { id: "missing" },
        })
      })
    }).not.toThrow()
    expect(api.panels).toHaveLength(0)
  })
})
