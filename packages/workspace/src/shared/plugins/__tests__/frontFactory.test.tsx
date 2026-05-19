import type { ReactNode } from "react"
import { describe, expect, it } from "vitest"
import type { PaneProps } from "../../types/panel"
import {
  boringFrontFactoryToPlugin,
  createCapturingBoringFrontAPI,
  definePlugin,
  toWorkspacePlugin,
  type BoringFrontFactory,
} from "../frontFactory"
import { PluginError } from "../defineFrontPlugin"

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
      outputs: [
        expect.objectContaining({ type: "provider", id: "runtime" }),
        expect.objectContaining({ type: "binding", id: "listener" }),
        expect.objectContaining({ type: "catalog" }),
        expect.objectContaining({ type: "panel" }),
        expect.objectContaining({ type: "command" }),
        expect.objectContaining({ type: "left-tab" }),
        expect.objectContaining({ type: "surface-resolver" }),
      ],
    })
  })
})

describe("boringFrontFactoryToPlugin", () => {
  it("adapts a synchronous BoringFrontFactory to WorkspaceFrontPlugin outputs", () => {
    const factory: BoringFrontFactory = (api) => {
      api.registerPanel({ id: "chart", label: "Chart", component: TestPanel })
      api.registerPanelCommand({ id: "open-chart", title: "Open chart", panelId: "chart" })
      api.registerLeftTab({ id: "macro-tab", title: "Macro", panelId: "chart", component: TestPanel })
      api.registerSurfaceResolver({ kind: "macro.open", resolve: () => ({ component: "chart", id: "chart:CPI" }) })
    }

    const plugin = boringFrontFactoryToPlugin("macro", factory)

    expect(plugin.id).toBe("macro")
    expect(plugin.outputs?.map((output) => output.type)).toEqual([
      "panel",
      "command",
      "left-tab",
      "surface-resolver",
    ])
    expect(plugin.outputs?.[0]).toMatchObject({
      type: "panel",
      panel: { id: "chart", title: "Chart", placement: "center", source: "plugin" },
    })
    expect(plugin.outputs?.[1]).toMatchObject({
      type: "command",
      command: { id: "open-chart", title: "Open chart", keywords: ["chart"] },
    })
    expect(plugin.outputs?.[2]).toMatchObject({
      type: "left-tab",
      id: "macro-tab",
      title: "Macro",
      source: "plugin",
    })
    expect(plugin.outputs?.[3]).toMatchObject({
      type: "surface-resolver",
      resolver: { id: "macro:macro.open", source: "plugin" },
    })
  })

  it("rejects async factories for bootstrap mode", () => {
    expect(() => boringFrontFactoryToPlugin("async", async () => undefined))
      .toThrow("requires a synchronous factory")
  })
})

describe("definePlugin brand semantics (DESIGN.md §4.3 + §8)", () => {
  it("returns a NEW wrapper that carries pluginId/pluginLabel", () => {
    const factory: BoringFrontFactory = (api) => {
      api.registerPanel({ id: "p", label: "P", component: TestPanel })
    }
    const wrapped = definePlugin("plugin-a", factory, { label: "Plugin A" })

    expect(wrapped).not.toBe(factory)
    expect(wrapped.pluginId).toBe("plugin-a")
    expect(wrapped.pluginLabel).toBe("Plugin A")
    // Input factory is NOT mutated — it remains unbranded and reusable.
    expect((factory as Partial<typeof wrapped>).pluginId).toBeUndefined()
    expect((factory as Partial<typeof wrapped>).pluginLabel).toBeUndefined()
  })

  it("calling definePlugin twice with the SAME id on the same factory is safe", () => {
    const factory: BoringFrontFactory = () => undefined
    const first = definePlugin("plugin-a", factory)
    const second = definePlugin("plugin-a", factory)
    expect(first.pluginId).toBe("plugin-a")
    expect(second.pluginId).toBe("plugin-a")
  })

  it("rebranding a wrapper with a different id throws", () => {
    const factory: BoringFrontFactory = () => undefined
    const wrapped = definePlugin("plugin-a", factory)
    expect(() => definePlugin("plugin-b", wrapped)).toThrow(
      /already branded as "plugin-a"/,
    )
  })

  it("toWorkspacePlugin rejects bare factories without pluginId", () => {
    const bare: BoringFrontFactory = () => undefined
    expect(() => toWorkspacePlugin(bare as never)).toThrow(
      /Wrap it with `definePlugin/,
    )
  })

  it("toWorkspacePlugin accepts a branded factory and produces outputs", () => {
    const wrapped = definePlugin("plugin-a", (api) => {
      api.registerPanel({ id: "p", label: "P", component: TestPanel })
    })
    const plugin = toWorkspacePlugin(wrapped)
    expect(plugin.id).toBe("plugin-a")
    expect(plugin.outputs?.[0]).toMatchObject({ type: "panel" })
  })
})

describe("definePlugin declarative config form", () => {
  it("accepts a config object with panels/commands/leftTabs/surfaceResolvers", () => {
    const wrapped = definePlugin({
      id: "decl",
      label: "Declarative",
      panels: [
        { id: "decl.panel", label: "Decl", component: TestPanel },
      ],
      commands: [
        { id: "decl.open", title: "Open Decl", panelId: "decl.panel" },
      ],
      leftTabs: [
        { id: "decl.tab", title: "Decl", panelId: "decl.panel" },
      ],
      surfaceResolvers: [
        { id: "decl.surface", kind: "decl.open", resolve: () => null },
      ],
    })
    expect(wrapped.pluginId).toBe("decl")
    expect(wrapped.pluginLabel).toBe("Declarative")

    const plugin = toWorkspacePlugin(wrapped)
    const types = (plugin.outputs ?? []).map((o) => o.type).sort()
    expect(types).toEqual(["command", "left-tab", "panel", "surface-resolver"])
  })

  it("calls setup() AFTER the declarative registrations", () => {
    const order: string[] = []
    const wrapped = definePlugin({
      id: "with-setup",
      panels: [
        {
          id: "with-setup.panel",
          label: "WithSetup",
          // component captures registration order via side effect; we
          // inspect via the output array, which preserves call order.
          component: TestPanel,
        },
      ],
      setup: (api) => {
        order.push("setup-ran")
        api.registerPanelCommand({
          id: "with-setup.extra",
          title: "Extra",
          panelId: "with-setup.panel",
        })
      },
    })
    const plugin = toWorkspacePlugin(wrapped)
    expect(order).toEqual(["setup-ran"])
    const outputTypes = (plugin.outputs ?? []).map((o) => o.type)
    // panel (declarative) before panelCommand (registered inside setup)
    expect(outputTypes).toEqual(["panel", "command"])
  })

  it("rejects a config without an id", () => {
    expect(() => definePlugin({ id: "", panels: [] } as never)).toThrow(/id/)
  })

  it("empty config (id only) is valid — produces zero outputs", () => {
    const wrapped = definePlugin({ id: "empty" })
    expect(wrapped.pluginId).toBe("empty")
    const plugin = toWorkspacePlugin(wrapped)
    expect(plugin.outputs ?? []).toEqual([])
  })

  it("composition via spread works (extend a base plugin's config)", () => {
    const baseConfig = {
      id: "base",
      panels: [{ id: "base.panel", label: "Base", component: TestPanel }],
      commands: [{ id: "base.open", title: "Open Base", panelId: "base.panel" }],
    } as const
    const extended = definePlugin({
      ...baseConfig,
      id: "extended",
      commands: [
        ...baseConfig.commands,
        { id: "extended.extra", title: "Extra", panelId: "base.panel" },
      ],
    })
    const plugin = toWorkspacePlugin(extended)
    expect(plugin.id).toBe("extended")
    const cmdIds = (plugin.outputs ?? [])
      .filter((o) => o.type === "command")
      .map((o) => {
        const obj = o as { type: "command"; command?: { id?: string }; id?: string }
        return obj.command?.id ?? obj.id ?? "?"
      })
    expect(cmdIds).toEqual(["base.open", "extended.extra"])
  })
})

describe("intra-pluginId collision detection (DESIGN.md §6.7)", () => {
  it("throws PluginError('duplicate-id') when two register* calls land the same id", () => {
    const api = createCapturingBoringFrontAPI({ pluginId: "concrete" })
    api.registerPanel({ id: "table", label: "Table 1", component: TestPanel })
    expect(() =>
      api.registerPanel({ id: "table", label: "Table 2", component: TestPanel }),
    ).toThrow(PluginError)
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
    // Different kind, same id — should NOT throw (kinds are namespaced).
    expect(() =>
      api.registerPanelCommand({ id: "shared", title: "Open", panelId: "shared" }),
    ).not.toThrow()
  })

  it("catches the composition-chaining footgun: two kits both registering panel \"table\"", () => {
    const dataExplorerKit: BoringFrontFactory = (api) => {
      api.registerPanel({ id: "table", label: "Explorer Table", component: TestPanel })
    }
    const dataCatalogKit: BoringFrontFactory = (api) => {
      api.registerPanel({ id: "table", label: "Catalog Table", component: TestPanel })
    }
    const wrapped = definePlugin("playground-catalog", (api) => {
      dataExplorerKit(api)
      dataCatalogKit(api)
    })
    expect(() => toWorkspacePlugin(wrapped)).toThrow(/registers panel "table" twice/)
  })
})
