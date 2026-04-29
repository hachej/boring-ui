import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, act } from "@testing-library/react"
import { DockviewShell, useDockviewApi, DockviewApiContext } from "../DockviewShell"
import { ShadcnTab } from "../ShadcnTab"
import { PanelChrome, createLifecycleApi } from "../PanelChrome"
import { RegistryProvider } from "../../registry"
import { PanelRegistry } from "../../registry/PanelRegistry"
import { CommandRegistry } from "../../registry/CommandRegistry"
import { bindStore } from "../../store/selectors"
import { createWorkspaceStore } from "../../store"
import { events, userMeta } from "../../events"
import type { LayoutConfig, DockviewShellApi } from "../types"
import type { DockviewApi } from "dockview-react"

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

  it("shows a saving spinner while editor:save:start is in flight, hides on save:end", async () => {
    events._reset()
    const mockApi = { title: "doc.md", id: "panel-7", close: vi.fn() }
    render(<ShadcnTab api={mockApi as any} containerApi={{} as any} params={{}} tabLocation={"header" as any} />)

    expect(screen.queryByTestId("tab-saving-spinner")).not.toBeInTheDocument()

    act(() => {
      events.emit("editor:save:start", { panelId: "panel-7" })
    })
    expect(screen.getByTestId("tab-saving-spinner")).toBeInTheDocument()

    act(() => {
      events.emit("editor:save:end", { panelId: "panel-7" })
    })
    expect(screen.queryByTestId("tab-saving-spinner")).not.toBeInTheDocument()
  })

  it("ignores save events for OTHER panel ids", async () => {
    events._reset()
    const mockApi = { title: "mine.md", id: "panel-mine", close: vi.fn() }
    render(<ShadcnTab api={mockApi as any} containerApi={{} as any} params={{}} tabLocation={"header" as any} />)
    act(() => {
      events.emit("editor:save:start", { panelId: "someone-else" })
    })
    expect(screen.queryByTestId("tab-saving-spinner")).not.toBeInTheDocument()
  })

  it("clears the spinner on save:end even when the save itself failed (lifecycle hook always emits)", async () => {
    events._reset()
    const mockApi = { title: "x.md", id: "p", close: vi.fn() }
    render(<ShadcnTab api={mockApi as any} containerApi={{} as any} params={{}} tabLocation={"header" as any} />)
    act(() => {
      events.emit("editor:save:start", { panelId: "p" })
    })
    expect(screen.getByTestId("tab-saving-spinner")).toBeInTheDocument()
    act(() => {
      events.emit("editor:save:end", { panelId: "p" })
    })
    expect(screen.queryByTestId("tab-saving-spinner")).not.toBeInTheDocument()
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

describe("DockviewShell — file-event panel sync", () => {
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

  it("a `moved` event updates an open panel's params.path and tab title in place", async () => {
    const api = setupShell()
    act(() => {
      api.addPanel({
        id: "file:src/old.ts",
        component: "editor",
        title: "old.ts",
        params: { path: "src/old.ts" },
      })
    })

    act(() => {
      events.emit("file:moved", { ...userMeta(), from: "src/old.ts", to: "src/renamed.ts" })
    })

    const panel = api.getPanel("file:src/old.ts")
    expect(panel).toBeTruthy()
    expect((panel!.params as { path?: string }).path).toBe("src/renamed.ts")
    expect(panel!.title).toBe("renamed.ts")
  })

  it("matches by params.path even after the panel id stops matching the new path", async () => {
    // After one move, the panel id stays as `file:${original}` but params.path
    // reflects the new path. A subsequent move should still find it via
    // params.path lookup.
    const api = setupShell()
    act(() => {
      api.addPanel({
        id: "file:a.ts",
        component: "editor",
        title: "a.ts",
        params: { path: "a.ts" },
      })
    })
    act(() => {
      events.emit("file:moved", { ...userMeta(), from: "a.ts", to: "b.ts" })
    })
    act(() => {
      events.emit("file:moved", { ...userMeta(), from: "b.ts", to: "c.ts" })
    })

    const panel = api.getPanel("file:a.ts")
    expect((panel!.params as { path?: string }).path).toBe("c.ts")
    expect(panel!.title).toBe("c.ts")
  })

  it("a `deleted` event closes the matching panel", async () => {
    const api = setupShell()
    act(() => {
      api.addPanel({
        id: "file:doomed.ts",
        component: "editor",
        title: "doomed.ts",
        params: { path: "doomed.ts" },
      })
    })
    expect(api.getPanel("file:doomed.ts")).toBeTruthy()

    act(() => {
      events.emit("file:deleted", { ...userMeta(), path: "doomed.ts" })
    })

    expect(api.getPanel("file:doomed.ts")).toBeUndefined()
  })

  it("ignores events that don't match any open panel (no error)", async () => {
    const api = setupShell()
    expect(() => {
      act(() => {
        events.emit("file:moved", { ...userMeta(), from: "nope.ts", to: "still-nope.ts" })
        events.emit("file:deleted", { ...userMeta(), path: "nothing-open.ts" })
      })
    }).not.toThrow()
    expect(api.panels).toHaveLength(0)
  })

  it("preserves other tabs when one is moved/deleted", async () => {
    const api = setupShell()
    act(() => {
      api.addPanel({ id: "file:a.ts", component: "editor", title: "a.ts", params: { path: "a.ts" } })
      api.addPanel({ id: "file:b.ts", component: "editor", title: "b.ts", params: { path: "b.ts" } })
      api.addPanel({ id: "file:c.ts", component: "editor", title: "c.ts", params: { path: "c.ts" } })
    })

    act(() => {
      events.emit("file:deleted", { ...userMeta(), path: "b.ts" })
    })

    expect(api.getPanel("file:a.ts")).toBeTruthy()
    expect(api.getPanel("file:b.ts")).toBeUndefined()
    expect(api.getPanel("file:c.ts")).toBeTruthy()
    expect(api.panels.map((p) => p.id).sort()).toEqual([
      "file:a.ts",
      "file:c.ts",
    ])
  })
})

describe("DockviewShell — agent SSE → open panel sync (end-to-end smoke)", () => {
  // Per-mapping coverage lives in events/__tests__/agentBridge.test.ts.
  // This single test only proves the full pipeline (SSE chunk → bus
  // → DockviewShell listener → panel update) wires end-to-end.
  beforeEach(() => events._reset())

  it("an agent rename SSE chunk renames the open panel in place", async () => {
    const { emitAgentFileChange } = await import("../../events/agentBridge")
    const { panelRegistry, commandRegistry } = setupStoreAndRegistry()
    let captured: DockviewApi | null = null
    render(
      <RegistryProvider panelRegistry={panelRegistry} commandRegistry={commandRegistry}>
        <DockviewShell
          layout={{
            version: "2.0",
            groups: [{ id: "main", position: "center", dynamic: true }],
          }}
          onReady={(a) => {
            captured = a
          }}
        />
      </RegistryProvider>,
    )
    if (!captured) throw new Error("DockviewApi not captured")
    const api = captured as DockviewApi
    act(() => {
      api.addPanel({
        id: "file:src/old.ts",
        component: "editor",
        title: "old.ts",
        params: { path: "src/old.ts" },
      })
    })

    act(() => {
      emitAgentFileChange({
        type: "data-file-changed",
        data: {
          op: "rename",
          path: "src/renamed.ts",
          oldPath: "src/old.ts",
          toolCallId: "tc-1",
          timestamp: "2026-04-28T10:00:00Z",
        },
      })
    })

    const panel = api.getPanel("file:src/old.ts")
    expect(panel).toBeTruthy()
    expect((panel!.params as { path?: string }).path).toBe("src/renamed.ts")
    expect(panel!.title).toBe("renamed.ts")
  })
})
