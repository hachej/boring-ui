import type { ReactNode } from "react"
import { describe, expect, it } from "vitest"
import type { PaneProps } from "../../types/panel"
import {
  captureFrontPlugin,
  createCapturingBoringFrontAPI,
  definePlugin,
  type BoringFrontFactory,
} from "../frontFactory"
import { PluginError } from "../errors"

function TestPanel(_props: PaneProps): null {
  return null
}

function TestProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}

function TestBinding(): null {
  return null
}

describe("createCapturingBoringFrontAPI", () => {
  it("captures providers, bindings, catalogs, panels, commands, left tabs, and surface resolvers", () => {
    const api = createCapturingBoringFrontAPI()
    api.registerProvider({ id: "runtime", component: TestProvider })
    api.registerBinding({ id: "listener", component: TestBinding })
    api.registerCatalog({ id: "catalog", label: "Catalog", adapter: {} as any, onSelect: () => undefined })
    api.registerPanel({ id: "chart", label: "Chart", component: TestPanel })
    api.registerPanelCommand({ id: "open-chart", title: "Open chart", panelId: "chart" })
    api.registerLeftTab({ id: "macro-tab", title: "Macro", panelId: "chart", component: TestPanel })
    api.registerSurfaceResolver({ kind: "macro.open", resolve: () => ({ component: "chart" }) })

    expect(api.flush()).toMatchObject({
      providers: [{ id: "runtime" }],
      bindings: [{ id: "listener" }],
      catalogs: [{ id: "catalog", label: "Catalog" }],
      panels: [{ id: "chart", label: "Chart" }],
      panelCommands: [{ id: "open-chart", title: "Open chart", panelId: "chart" }],
      leftTabs: [{ id: "macro-tab", title: "Macro", panelId: "chart" }],
      surfaceResolvers: [{ kind: "macro.open" }],
    })
  })
})

describe("captureFrontPlugin", () => {
  it("captures a branded synchronous front factory", () => {
    const plugin = definePlugin({
      id: "macro",
      label: "Macro",
      panels: [{ id: "chart", label: "Chart", component: TestPanel }],
      commands: [{ id: "open-chart", title: "Open chart", panelId: "chart" }],
      leftTabs: [{ id: "macro-tab", title: "Macro", panelId: "chart", component: TestPanel }],
      surfaceResolvers: [{ kind: "macro.open", resolve: () => ({ component: "chart", id: "chart:CPI" }) }],
    })

    const captured = captureFrontPlugin(plugin)

    expect(captured.id).toBe("macro")
    expect(captured.label).toBe("Macro")
    expect(captured.registrations.panels[0]).toMatchObject({ id: "chart", label: "Chart" })
    expect(captured.registrations.panelCommands[0]).toMatchObject({ id: "open-chart", panelId: "chart" })
    expect(captured.registrations.leftTabs[0]).toMatchObject({ id: "macro-tab" })
    expect(captured.registrations.surfaceResolvers[0]).toMatchObject({ kind: "macro.open" })
  })

  it("rejects async factories for static bootstrap mode", () => {
    const asyncPlugin = Object.assign(async () => undefined, { pluginId: "async" })
    expect(() => captureFrontPlugin(asyncPlugin)).toThrow("requires a synchronous factory")
  })

  it("rejects bare factories without pluginId", () => {
    const bare: BoringFrontFactory = () => undefined
    expect(() => captureFrontPlugin(bare as never)).toThrow(/definePlugin/)
  })
})

describe("definePlugin brand semantics (PLUGIN_SYSTEM.md §4.3 + §7)", () => {
  it("returns a wrapper that carries pluginId/pluginLabel", () => {
    const wrapped = definePlugin({
      id: "plugin-a",
      label: "Plugin A",
      panels: [{ id: "p", label: "P", component: TestPanel }],
    })

    expect(wrapped.pluginId).toBe("plugin-a")
    expect(wrapped.pluginLabel).toBe("Plugin A")
    expect(typeof wrapped).toBe("function")
  })

  it("each definePlugin call returns a fresh branded factory", () => {
    const config = {
      id: "plugin-a",
      panels: [{ id: "p", label: "P", component: TestPanel }],
    }
    const first = definePlugin(config)
    const second = definePlugin(config)
    expect(first.pluginId).toBe("plugin-a")
    expect(second.pluginId).toBe("plugin-a")
    expect(first).not.toBe(second)
  })

  it("rejects the removed positional form with a helpful migration message", () => {
    const factory: BoringFrontFactory = () => undefined
    expect(() => (definePlugin as unknown as (...args: unknown[]) => unknown)("legacy", factory, { label: "L" })).toThrow(
      /declarative config object/,
    )
    expect(() => (definePlugin as unknown as (...args: unknown[]) => unknown)("legacy")).toThrow(
      /declarative config object/,
    )
  })
})

describe("definePlugin declarative config form", () => {
  it("accepts a config object with panels/commands/leftTabs/surfaceResolvers", () => {
    const wrapped = definePlugin({
      id: "decl",
      label: "Declarative",
      panels: [{ id: "decl.panel", label: "Decl", component: TestPanel }],
      commands: [{ id: "decl.open", title: "Open Decl", panelId: "decl.panel" }],
      leftTabs: [{ id: "decl.tab", title: "Decl", panelId: "decl.panel" }],
      surfaceResolvers: [{ id: "decl.surface", kind: "decl.open", resolve: () => null }],
    })
    const captured = captureFrontPlugin(wrapped)
    expect(captured.registrations.panels).toHaveLength(1)
    expect(captured.registrations.panelCommands).toHaveLength(1)
    expect(captured.registrations.leftTabs).toHaveLength(1)
    expect(captured.registrations.surfaceResolvers).toHaveLength(1)
  })

  it("types setup as synchronous even though bare hot-load factories may be async", () => {
    // @ts-expect-error setup is synchronous for statically composed definePlugin configs.
    definePlugin({ id: "async-setup", setup: async () => undefined })
    const maybeAsyncFactory: BoringFrontFactory = () => undefined
    // @ts-expect-error BoringFrontFactory is async-capable; setup must be known-sync.
    definePlugin({ id: "maybe-async-setup", setup: maybeAsyncFactory })
  })

  it("calls setup() AFTER the declarative registrations", () => {
    const order: string[] = []
    const wrapped = definePlugin({
      id: "with-setup",
      panels: [{ id: "with-setup.panel", label: "WithSetup", component: TestPanel }],
      setup: (api) => {
        order.push("setup-ran")
        api.registerPanelCommand({ id: "with-setup.extra", title: "Extra", panelId: "with-setup.panel" })
      },
    })
    const captured = captureFrontPlugin(wrapped)
    expect(order).toEqual(["setup-ran"])
    expect(captured.registrations.panels.map((panel) => panel.id)).toEqual(["with-setup.panel"])
    expect(captured.registrations.panelCommands.map((command) => command.id)).toEqual(["with-setup.extra"])
  })

  it("rejects a config without an id", () => {
    expect(() => definePlugin({ id: "", panels: [] } as never)).toThrow(/id/)
  })

  it("empty config (id only) is valid", () => {
    const wrapped = definePlugin({ id: "empty" })
    const captured = captureFrontPlugin(wrapped)
    expect(captured.id).toBe("empty")
    expect(captured.registrations.panels).toEqual([])
  })

  it("composition via spread works", () => {
    const baseConfig = {
      id: "base",
      panels: [{ id: "base.panel", label: "Base", component: TestPanel }],
      commands: [{ id: "base.open", title: "Open Base", panelId: "base.panel" }],
    } as const
    const extended = definePlugin({
      ...baseConfig,
      id: "extended",
      commands: [...baseConfig.commands, { id: "extended.extra", title: "Extra", panelId: "base.panel" }],
    })
    const captured = captureFrontPlugin(extended)
    expect(captured.id).toBe("extended")
    expect(captured.registrations.panelCommands.map((command) => command.id)).toEqual(["base.open", "extended.extra"])
  })
})

describe("intra-pluginId collision detection (PLUGIN_SYSTEM.md §5.7)", () => {
  it("throws PluginError('duplicate-id') when two register* calls land the same id", () => {
    const api = createCapturingBoringFrontAPI({ pluginId: "concrete" })
    api.registerPanel({ id: "table", label: "Table 1", component: TestPanel })
    expect(() => api.registerPanel({ id: "table", label: "Table 2", component: TestPanel })).toThrow(PluginError)
    try {
      api.registerPanel({ id: "table", label: "Table 3", component: TestPanel })
    } catch (e) {
      expect((e as PluginError).kind).toBe("duplicate-id")
      expect((e as PluginError).message).toContain('plugin "concrete"')
      expect((e as PluginError).message).toContain('panel "table"')
    }
  })

  it("collision spans output kinds — panel and command can share the same id", () => {
    const api = createCapturingBoringFrontAPI({ pluginId: "concrete" })
    api.registerPanel({ id: "shared", label: "Pane", component: TestPanel })
    expect(() => api.registerPanelCommand({ id: "shared", title: "Open", panelId: "shared" })).not.toThrow()
  })

  it("catches the composition-chaining footgun", () => {
    const dataExplorerKit: BoringFrontFactory = (api) => {
      api.registerPanel({ id: "table", label: "Explorer Table", component: TestPanel })
    }
    const dataCatalogKit: BoringFrontFactory = (api) => {
      api.registerPanel({ id: "table", label: "Catalog Table", component: TestPanel })
    }
    const wrapped = definePlugin({
      id: "playground-catalog",
      setup: (api) => {
        dataExplorerKit(api)
        dataCatalogKit(api)
      },
    })
    expect(() => captureFrontPlugin(wrapped)).toThrow(/registers panel "table" twice/)
  })
})
