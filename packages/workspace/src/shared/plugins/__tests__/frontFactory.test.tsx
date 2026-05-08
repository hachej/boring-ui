import type { ReactNode } from "react"
import { describe, expect, it } from "vitest"
import type { PaneProps } from "../../types/panel"
import {
  boringFrontFactoryToPlugin,
  createCapturingBoringFrontAPI,
  type BoringFrontFactory,
} from "../frontFactory"

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
