import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CommandRegistry } from "../../../shared/plugins/CommandRegistry"
import { PanelRegistry } from "../../registry/PanelRegistry"
import { RegistryProvider, useCatalogRegistry } from "../../registry/RegistryProvider"
import { WorkspaceProvider } from "../../provider"
import { CatalogRegistry } from "../../../shared/plugins/CatalogRegistry"
import type { CatalogConfig } from "../../../shared/plugins/types"
import { useCatalogs } from "../useCatalogs"

function makeCatalog(overrides: Partial<CatalogConfig> = {}): CatalogConfig {
  return {
    id: "catalog",
    label: "Catalog",
    adapter: {
      search: async () => ({ items: [], total: 0, hasMore: false }),
    },
    onSelect: vi.fn(),
    ...overrides,
  }
}

function makeWrapper(registry: CatalogRegistry) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <RegistryProvider
        panelRegistry={new PanelRegistry()}
        commandRegistry={new CommandRegistry()}
        catalogRegistry={registry}
      >
        {children}
      </RegistryProvider>
    )
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("CatalogRegistry", () => {
  it("registers and lists distinct catalogs", () => {
    const registry = new CatalogRegistry()

    registry.register(makeCatalog({ id: "files" }), "filesystem")
    registry.register(makeCatalog({ id: "series" }), "macro")

    expect(registry.list().map((catalog) => catalog.id)).toEqual(["files", "series"])
    expect(registry.get("files")).toEqual(
      expect.objectContaining({ id: "files", pluginId: "filesystem" }),
    )
  })

  it("uses late-wins-on-id and warns in dev mode", () => {
    const registry = new CatalogRegistry({ warnOnDuplicate: true })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    registry.register(makeCatalog({ id: "files", label: "Old" }), "builtin")
    registry.register(makeCatalog({ id: "files", label: "New" }), "host")

    expect(registry.list()).toHaveLength(1)
    expect(registry.get("files")).toEqual(
      expect.objectContaining({ label: "New", pluginId: "host" }),
    )
    expect(warn).toHaveBeenCalledWith(
      '[CatalogRegistry] catalog "files" registered by "host" overrides previous registration',
    )
  })

  it("keeps duplicate override silent in production mode", () => {
    const registry = new CatalogRegistry({ warnOnDuplicate: false })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    registry.register(makeCatalog({ id: "files", label: "Old" }), "builtin")
    registry.register(makeCatalog({ id: "files", label: "New" }), "host")

    expect(registry.get("files")?.label).toBe("New")
    expect(warn).not.toHaveBeenCalled()
  })

  it("unregister removes one catalog and notifies subscribers", () => {
    const registry = new CatalogRegistry()
    const subscriber = vi.fn()
    registry.register(makeCatalog({ id: "files" }), "filesystem")
    registry.subscribe(subscriber)

    registry.unregister("files")

    expect(registry.get("files")).toBeUndefined()
    expect(subscriber).toHaveBeenCalledTimes(1)
  })

  it("unregisterByPluginId removes only matching plugin catalogs", () => {
    const registry = new CatalogRegistry()
    const subscriber = vi.fn()
    registry.register(makeCatalog({ id: "files" }), "filesystem")
    registry.register(makeCatalog({ id: "series" }), "macro")
    registry.register(makeCatalog({ id: "tables" }), "macro")
    registry.subscribe(subscriber)

    registry.unregisterByPluginId("macro")

    expect(registry.list().map((catalog) => catalog.id)).toEqual(["files"])
    expect(subscriber).toHaveBeenCalledTimes(1)
  })

  it("getSnapshot is stable until mutation", () => {
    const registry = new CatalogRegistry()
    registry.register(makeCatalog({ id: "files" }), "filesystem")

    const before = registry.getSnapshot()
    expect(registry.getSnapshot()).toBe(before)

    registry.register(makeCatalog({ id: "series" }), "macro")

    expect(registry.getSnapshot()).not.toBe(before)
    expect(registry.getSnapshot()).toHaveLength(2)
  })

  it("subscribe fires synchronously on register", () => {
    const registry = new CatalogRegistry()
    const subscriber = vi.fn()
    registry.subscribe(subscriber)

    registry.register(makeCatalog({ id: "files" }), "filesystem")

    expect(subscriber).toHaveBeenCalledTimes(1)
  })
})

describe("useCatalogs", () => {
  it("re-renders when the catalog registry changes", () => {
    const registry = new CatalogRegistry()
    const { result } = renderHook(() => useCatalogs(), {
      wrapper: makeWrapper(registry),
    })

    expect(result.current).toEqual([])

    act(() => {
      registry.register(makeCatalog({ id: "files" }), "filesystem")
    })

    expect(result.current).toEqual([
      expect.objectContaining({ id: "files", pluginId: "filesystem" }),
    ])
  })

  it("exposes the catalog registry from RegistryProvider", () => {
    const registry = new CatalogRegistry()
    registry.register(makeCatalog({ id: "files" }), "filesystem")

    const { result } = renderHook(() => useCatalogRegistry(), {
      wrapper: makeWrapper(registry),
    })

    expect(result.current.get("files")).toEqual(
      expect.objectContaining({ id: "files", pluginId: "filesystem" }),
    )
  })

  it("re-renders inside WorkspaceProvider when its registry changes", () => {
    const { result } = renderHook(
      () => ({
        catalogs: useCatalogs(),
        registry: useCatalogRegistry(),
      }),
      {
        wrapper: ({ children }) => (
          <WorkspaceProvider excludeDefaults={["filesystem"]} persistenceEnabled={false}>{children}</WorkspaceProvider>
        ),
      },
    )

    expect(result.current.catalogs).toEqual([])

    act(() => {
      result.current.registry.register(makeCatalog({ id: "files" }), "filesystem")
    })

    expect(result.current.catalogs).toEqual([
      expect.objectContaining({ id: "files", pluginId: "filesystem" }),
    ])
  })
})
