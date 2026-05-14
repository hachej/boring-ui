import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { renderHook } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { WorkspaceProvider } from "../front/provider"
import { useRegistry, useCommandRegistry, useCatalogRegistry } from "../front/registry"
import { useCatalogs } from "../front/plugin/useCatalogs"
import { defineFrontPlugin } from "../shared/plugins/defineFrontPlugin"
import {
  DATA_CATALOG_ROW_SURFACE_KIND,
  createDataCatalogPlugin,
} from "../plugins/dataCatalogPlugin/front"
import type { PluginOutput } from "../shared/plugins/types"
import type { WorkspaceFrontPlugin } from "../shared/plugins/defineFrontPlugin"
import { events, workspaceEvents } from "../front/events"
import type { ExplorerAdapter, SearchResult } from "../shared/types/explorer"

const DummyPanel = () => null

function getPluginOutput<T extends PluginOutput["type"]>(
  plugin: WorkspaceFrontPlugin,
  type: T,
): Extract<PluginOutput, { type: T }> {
  const output = plugin.outputs?.find(
    (candidate): candidate is Extract<PluginOutput, { type: T }> =>
      candidate.type === type,
  )
  if (!output) throw new Error(`missing ${type} output`)
  return output
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {}
}

function fireKeydown(key: string, opts: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  })
  document.dispatchEvent(event)
}

let originalStorage: Storage
beforeEach(() => {
  originalStorage = globalThis.localStorage
  const storage = new Map<string, string>()
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      removeItem: vi.fn((key: string) => storage.delete(key)),
      clear: vi.fn(() => storage.clear()),
      get length() { return storage.size },
      key: vi.fn((index: number) => [...storage.keys()][index] ?? null),
    } as unknown as Storage,
    writable: true,
    configurable: true,
  })
})
afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: originalStorage,
    writable: true,
    configurable: true,
  })
  vi.unstubAllGlobals()
})

const emptyResult: SearchResult = { items: [], total: 0, hasMore: false }

const stubAdapter: ExplorerAdapter = {
  search: vi.fn(async () => emptyResult),
}

describe("WorkspaceProvider — plugin integration", () => {
  it("bootstrap runs once on mount and registers user plugin contributions", () => {
    const testPlugin = defineFrontPlugin({
      id: "test-plugin",
      label: "Test",
      panels: [
        { id: "test-panel", title: "Test", component: DummyPanel, source: "app" },
      ],
      commands: [
        { id: "test-cmd", title: "Test Command", run: vi.fn() },
      ],
    })

    function Inspector() {
      const reg = useRegistry()
      const cmds = useCommandRegistry()
      return (
        <div>
          <span data-testid="has-panel">{String(reg.has("test-panel"))}</span>
          <span data-testid="has-cmd">{String(!!cmds.getCommand("test-cmd"))}</span>
        </div>
      )
    }

    render(
      <WorkspaceProvider plugins={[testPlugin]} persistenceEnabled={false}>
        <Inspector />
      </WorkspaceProvider>,
    )

    expect(screen.getByTestId("has-panel").textContent).toBe("true")
    expect(screen.getByTestId("has-cmd").textContent).toBe("true")
  })

  it("package/app-provided commands appear in CommandPalette and execute", async () => {
    const user = userEvent.setup()
    const run = vi.fn()

    render(
      <WorkspaceProvider
        commands={[
          {
            id: "user:settings",
            title: "Account settings",
            keywords: ["profile"],
            pluginId: "core",
            run,
          },
        ]}
        persistenceEnabled={false}
      >
        <div />
      </WorkspaceProvider>,
    )

    fireKeydown("k", { metaKey: true })
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument())
    await user.type(screen.getByRole("combobox"), ">profile")

    await waitFor(() => {
      expect(screen.getByText("Account settings")).toBeInTheDocument()
    })

    await user.click(screen.getByText("Account settings"))
    expect(run).toHaveBeenCalledOnce()
  })

  it("plugin-provided commands appear in CommandPalette and execute", async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    const plugin = defineFrontPlugin({
      id: "plugin-commands",
      label: "Plugin Commands",
      commands: [
        {
          id: "plugin.open-dashboard",
          title: "Open Plugin Dashboard",
          keywords: ["plugin-dashboard"],
          shortcut: "⌘D",
          run,
        },
      ],
    })

    render(
      <WorkspaceProvider plugins={[plugin]} persistenceEnabled={false}>
        <div />
      </WorkspaceProvider>,
    )

    fireKeydown("k", { metaKey: true })
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument())
    await user.type(screen.getByRole("combobox"), ">plugin-dashboard")

    await waitFor(() => {
      expect(screen.getByText("Open Plugin Dashboard")).toBeInTheDocument()
    })
    expect(screen.getByText("⌘D")).toBeInTheDocument()

    await user.click(screen.getByText("Open Plugin Dashboard"))
    expect(run).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("defaults include filesystemPlugin (files, editors, and file fallback panels)", () => {
    function Inspector() {
      const reg = useRegistry()
      const ids = reg.list().map((p) => p.id)
      return <div data-testid="ids">{ids.join(",")}</div>
    }

    render(
      <WorkspaceProvider persistenceEnabled={false}>
        <Inspector />
      </WorkspaceProvider>,
    )

    const ids = screen.getByTestId("ids").textContent!.split(",")
    expect(ids).toContain("files")
    expect(ids).toContain("empty-file-panel")
    expect(ids).toContain("code-editor")
    expect(ids).toContain("markdown-editor")
  })

  it("excludeDefaults: ['filesystem'] removes all filesystem contributions", () => {
    function Inspector() {
      const reg = useRegistry()
      const catalogs = useCatalogRegistry()
      return (
        <div>
          <span data-testid="panel-ids">{reg.list().map((p) => p.id).join(",")}</span>
          <span data-testid="catalog-count">{catalogs.list().length}</span>
        </div>
      )
    }

    render(
      <WorkspaceProvider excludeDefaults={["filesystem"]} persistenceEnabled={false}>
        <Inspector />
      </WorkspaceProvider>,
    )

    const panelIds = screen.getByTestId("panel-ids").textContent!.split(",")
    expect(panelIds).not.toContain("files")
    expect(panelIds).not.toContain("empty-file-panel")
    expect(panelIds).not.toContain("code-editor")
    expect(panelIds).not.toContain("markdown-editor")
    // core panels remain
    expect(panelIds).toContain("chat")
    expect(panelIds).toContain("session-list")
    expect(panelIds).toContain("workbench-left")
    expect(panelIds).toContain("artifact-surface")
    expect(screen.getByTestId("catalog-count").textContent).toBe("0")
  })

  it("existing children still work (capabilities, theme, etc.)", () => {
    function Inspector() {
      const reg = useRegistry()
      return <div data-testid="count">{reg.list().length}</div>
    }

    render(
      <WorkspaceProvider
        capabilities={{ "agent.chat": true }}
        defaultTheme="dark"
        persistenceEnabled={false}
      >
        <Inspector />
      </WorkspaceProvider>,
    )

    expect(Number(screen.getByTestId("count").textContent)).toBeGreaterThanOrEqual(3)
  })

  it("user plugin alongside defaults does not conflict", () => {
    const customPlugin = defineFrontPlugin({
      id: "analytics",
      panels: [
        { id: "analytics-dashboard", title: "Analytics", component: DummyPanel, source: "app" },
      ],
    })

    function Inspector() {
      const reg = useRegistry()
      const ids = reg.list().map((p) => p.id)
      return <div data-testid="ids">{ids.join(",")}</div>
    }

    render(
      <WorkspaceProvider plugins={[customPlugin]} persistenceEnabled={false}>
        <Inspector />
      </WorkspaceProvider>,
    )

    const ids = screen.getByTestId("ids").textContent!.split(",")
    expect(ids).toContain("files")
    expect(ids).toContain("analytics-dashboard")
  })
})

describe("createDataCatalogPlugin integration", () => {
  it("returns a WorkspaceFrontPlugin with a left-tab output, visualization panel, and catalog", () => {
    const plugin = createDataCatalogPlugin({ adapter: stubAdapter })
    expect(plugin.id).toBe("data-catalog")
    expect(plugin.label).toBe("Data Catalog")
    expect(plugin.outputs?.map((output) => output.type)).toEqual([
      "left-tab",
      "panel",
      "catalog",
      "surface-resolver",
    ])
    expect(plugin.catalogs).toBeUndefined()
  })

  it("catalog id matches the configured catalog id", () => {
    const plugin = createDataCatalogPlugin({ id: "metrics", catalogId: "metrics", adapter: stubAdapter })
    const catalog = getPluginOutput(plugin, "catalog")
    expect(catalog.type).toBe("catalog")
    expect(catalog.catalog.id).toBe("metrics")
  })

  it("uses defaults for id and label when not provided", () => {
    const plugin = createDataCatalogPlugin({ adapter: stubAdapter })
    expect(plugin.id).toBe("data-catalog")
    expect(plugin.label).toBe("Data Catalog")
    expect(getPluginOutput(plugin, "left-tab")).toEqual(
      expect.objectContaining({ type: "left-tab", title: "Data", id: "data-catalog-tab" }),
    )
  })

  it("uses custom label", () => {
    const plugin = createDataCatalogPlugin({ adapter: stubAdapter, label: "Series" })
    expect(plugin.label).toBe("Series")
    expect(plugin.outputs![0]).toEqual(
      expect.objectContaining({ type: "left-tab", title: "Series" }),
    )
    const catalog = getPluginOutput(plugin, "catalog")
    expect(catalog.type).toBe("catalog")
    expect(catalog.catalog.label).toBe("Series")
  })

  it("left-tab output has type left-tab and source app", () => {
    const plugin = createDataCatalogPlugin({ adapter: stubAdapter })
    expect(plugin.outputs![0]).toEqual(
      expect.objectContaining({ type: "left-tab", source: "app" }),
    )
  })

  it("catalog onSelect falls back to opening the data visualization surface", () => {
    const observed: unknown[] = []
    const unsubscribe = events.on(workspaceEvents.uiCommand, (payload) =>
      observed.push(payload.command),
    )
    const plugin = createDataCatalogPlugin({ adapter: stubAdapter })
    const catalog = getPluginOutput(plugin, "catalog")
    expect(catalog.type).toBe("catalog")
    expect(() => catalog.catalog.onSelect({ id: "x", title: "X" })).not.toThrow()
    expect(observed).toEqual([
      expect.objectContaining({
        kind: "openSurface",
        params: expect.objectContaining({
          kind: DATA_CATALOG_ROW_SURFACE_KIND,
          target: "x",
          meta: expect.objectContaining({
            catalogId: "data-catalog",
            row: { id: "x", title: "X" },
          }),
        }),
      }),
    ])
    unsubscribe()
  })

  it("surface resolver maps catalog rows to the data visualization panel", () => {
    const plugin = createDataCatalogPlugin({ adapter: stubAdapter })
    const resolver = getPluginOutput(plugin, "surface-resolver")
    const resolved = resolver.resolver.resolve({
      kind: DATA_CATALOG_ROW_SURFACE_KIND,
      target: "x",
      meta: { catalogId: "data-catalog", row: { id: "x", title: "X" } },
    })
    expect(resolved).toEqual(
      expect.objectContaining({
        component: "data-catalog-visualization",
        title: "X",
        params: { row: { id: "x", title: "X" } },
      }),
    )
  })

  it("catalog wires adapter and onSelect correctly", () => {
    const onSelect = vi.fn()
    const plugin = createDataCatalogPlugin({ adapter: stubAdapter, onSelect })
    const catalog = getPluginOutput(plugin, "catalog")
    expect(catalog.type).toBe("catalog")
    catalog.catalog.onSelect({ id: "x", title: "X" })
    expect(onSelect).toHaveBeenCalledWith({ id: "x", title: "X" }, {})
    expect(catalog.catalog.adapter).toBe(stubAdapter)
  })

  it("works when passed to WorkspaceProvider plugins", () => {
    const plugin = createDataCatalogPlugin({
      adapter: stubAdapter,
      id: "my-data",
      label: "My Data",
      leftTabId: "my-data",
      catalogId: "my-data",
    })

    function Inspector() {
      const reg = useRegistry()
      const catalogs = useCatalogRegistry()
      return (
        <div>
          <span data-testid="has-panel">{String(reg.has("my-data-visualization"))}</span>
          <span data-testid="has-left-tab">{String(reg.has("my-data"))}</span>
          <span data-testid="has-catalog">{String(!!catalogs.get("my-data"))}</span>
        </div>
      )
    }

    render(
      <WorkspaceProvider plugins={[plugin]} persistenceEnabled={false}>
        <Inspector />
      </WorkspaceProvider>,
    )

    expect(screen.getByTestId("has-panel").textContent).toBe("true")
    expect(screen.getByTestId("has-left-tab").textContent).toBe("true")
    expect(screen.getByTestId("has-catalog").textContent).toBe("true")
  })
})

describe("WorkspaceProvider — core panel registration (j9p7.25)", () => {
  it("registers the 4 core panels when default plugins are excluded", () => {
    function Inspector() {
      const reg = useRegistry()
      const ids = reg.list().map((p) => p.id)
      return <div data-testid="ids">{ids.join(",")}</div>
    }

    render(
      <WorkspaceProvider excludeDefaults={["filesystem"]} persistenceEnabled={false}>
        <Inspector />
      </WorkspaceProvider>,
    )

    const ids = screen.getByTestId("ids").textContent!.split(",")
    expect(ids).toContain("chat")
    expect(ids).toContain("session-list")
    expect(ids).toContain("workbench-left")
    expect(ids).toContain("artifact-surface")
    expect(ids).not.toContain("empty-file-panel")
  })

  it("core panels have source 'builtin'", () => {
    function Inspector() {
      const reg = useRegistry()
      const coreIds = ["chat", "session-list", "workbench-left", "artifact-surface"]
      const sources = coreIds.map((id) => reg.get(id)?.source).join(",")
      return <div data-testid="sources">{sources}</div>
    }

    render(
      <WorkspaceProvider excludeDefaults={["filesystem"]} persistenceEnabled={false}>
        <Inspector />
      </WorkspaceProvider>,
    )

    expect(screen.getByTestId("sources").textContent).toBe(
      "builtin,builtin,builtin,builtin",
    )
  })

  it("core panels register BEFORE plugin panels (ordering)", () => {
    const testPlugin = defineFrontPlugin({
      id: "custom",
      panels: [{ id: "custom-panel", title: "Custom", component: DummyPanel, source: "app" }],
    })

    function Inspector() {
      const reg = useRegistry()
      const ids = reg.list().map((p) => p.id)
      return <div data-testid="ids">{ids.join(",")}</div>
    }

    render(
      <WorkspaceProvider plugins={[testPlugin]} persistenceEnabled={false}>
        <Inspector />
      </WorkspaceProvider>,
    )

    const ids = screen.getByTestId("ids").textContent!.split(",")
    const chatIdx = ids.indexOf("chat")
    const customIdx = ids.indexOf("custom-panel")
    expect(chatIdx).toBeLessThan(customIdx)
  })

  it("core panels + filesystem defaults + user plugin all coexist", () => {
    const testPlugin = defineFrontPlugin({
      id: "test",
      panels: [{ id: "test-panel", title: "Test", component: DummyPanel, source: "app" }],
    })

    function Inspector() {
      const reg = useRegistry()
      return <div data-testid="count">{reg.list().length}</div>
    }

    render(
      <WorkspaceProvider plugins={[testPlugin]} persistenceEnabled={false}>
        <Inspector />
      </WorkspaceProvider>,
    )

    // 4 core + 8 filesystem outputs/panels + 1 test = 13
    expect(screen.getByTestId("count").textContent).toBe("13")
  })
})
