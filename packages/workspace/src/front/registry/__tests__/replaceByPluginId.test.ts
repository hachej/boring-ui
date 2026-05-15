import { describe, expect, test, vi } from "vitest"
import { CommandRegistry } from "../CommandRegistry"
import { PanelRegistry } from "../PanelRegistry"
import { SurfaceResolverRegistry } from "../SurfaceResolverRegistry"
import { CatalogRegistry } from "../../plugin/CatalogRegistry"

describe("Phase 3 — atomic replaceByPluginId", () => {
  test("CommandRegistry: drops owned commands and registers new set in one emit", () => {
    const registry = new CommandRegistry()
    registry.registerCommand({ id: "a", title: "A", run: () => {}, pluginId: "p1" })
    registry.registerCommand({ id: "b", title: "B", run: () => {}, pluginId: "p1" })
    registry.registerCommand({ id: "x", title: "X", run: () => {}, pluginId: "other" })

    const subscriber = vi.fn()
    registry.subscribe(subscriber)
    registry.replaceByPluginId("p1", [{ id: "c", title: "C", run: () => {} }])

    expect(subscriber).toHaveBeenCalledTimes(1)
    const ids = registry.getCommands().map((c) => c.id).sort()
    expect(ids).toEqual(["c", "x"])
    expect(registry.getCommand("c")?.pluginId).toBe("p1")
  })

  test("PanelRegistry: replace preserves registration order for new entries", () => {
    const registry = new PanelRegistry()
    registry.register("a", { id: "a", title: "A", placement: "center", component: () => null, pluginId: "p1" })
    registry.register("b", { id: "b", title: "B", placement: "center", component: () => null, pluginId: "other" })

    const subscriber = vi.fn()
    registry.subscribe(subscriber)
    registry.replaceByPluginId("p1", [
      { id: "c", title: "C", placement: "center", component: () => null },
      { id: "d", title: "D", placement: "center", component: () => null },
    ])

    expect(subscriber).toHaveBeenCalledTimes(1)
    const order = registry.listAll().map((p) => p.id)
    expect(order).toEqual(["b", "c", "d"])
  })

  test("CatalogRegistry: replace clears old + adds new in one emit", () => {
    const registry = new CatalogRegistry({ warnOnDuplicate: false })
    registry.register({ id: "old", label: "Old", adapter: { search: async () => ({ items: [], total: 0 }) } }, "p1")

    const subscriber = vi.fn()
    registry.subscribe(subscriber)
    registry.replaceByPluginId("p1", [
      { id: "new", label: "New", adapter: { search: async () => ({ items: [], total: 0 }) } },
    ])

    expect(subscriber).toHaveBeenCalledTimes(1)
    const ids = registry.getSnapshot().map((c) => c.id)
    expect(ids).toEqual(["new"])
  })

  test("SurfaceResolverRegistry: replace by pluginId is atomic", () => {
    const registry = new SurfaceResolverRegistry()
    registry.register("r1", { id: "r1", source: "plugin", resolve: () => undefined, pluginId: "p1" })
    registry.register("r2", { id: "r2", source: "plugin", resolve: () => undefined, pluginId: "other" })

    const subscriber = vi.fn()
    registry.subscribe(subscriber)
    registry.replaceByPluginId("p1", [
      { id: "r3", source: "plugin", resolve: () => undefined },
    ])

    expect(subscriber).toHaveBeenCalledTimes(1)
    const ids = registry.list().map((r) => r.id).sort()
    expect(ids).toEqual(["r2", "r3"])
  })

  test("replaceByPluginId with empty new set just unregisters owned entries", () => {
    const registry = new CommandRegistry()
    registry.registerCommand({ id: "a", title: "A", run: () => {}, pluginId: "p1" })
    registry.replaceByPluginId("p1", [])
    expect(registry.getCommands()).toEqual([])
  })

  test("replaceByPluginId with no owned + no new entries is a no-op", () => {
    const registry = new CommandRegistry()
    registry.registerCommand({ id: "a", title: "A", run: () => {}, pluginId: "other" })
    const subscriber = vi.fn()
    registry.subscribe(subscriber)
    registry.replaceByPluginId("p1", [])
    expect(subscriber).not.toHaveBeenCalled()
  })

  test("replaceByPluginId skips an id owned by a different plugin (with warning)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const registry = new CommandRegistry()
    registry.registerCommand({ id: "shared", title: "Owned by other", run: () => {}, pluginId: "other-plugin" })

    registry.replaceByPluginId("intruder", [{ id: "shared", title: "Hijack", run: () => {} }])

    expect(registry.getCommand("shared")?.pluginId).toBe("other-plugin")
    expect(registry.getCommand("shared")?.title).toBe("Owned by other")
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain("intruder")
    expect(warn.mock.calls[0][0]).toContain("other-plugin")
    warn.mockRestore()
  })

  test("PanelRegistry: collision skip preserves cross-plugin isolation", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const registry = new PanelRegistry()
    registry.register("shared", { id: "shared", title: "Other", placement: "center", component: () => null, pluginId: "other" })

    registry.replaceByPluginId("intruder", [
      { id: "shared", title: "Hijack", placement: "center", component: () => null },
    ])

    expect(registry.get("shared")?.pluginId).toBe("other")
    expect(registry.get("shared")?.title).toBe("Other")
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
