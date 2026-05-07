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

describe("createCapturingBoringFrontAPI", () => {
  it("captures panels, commands, left tabs, and surface resolvers", () => {
    const api = createCapturingBoringFrontAPI()
    api.registerPanel({ id: "chart", label: "Chart", component: TestPanel })
    api.registerPanelCommand({ id: "open-chart", title: "Open chart", panelId: "chart" })
    api.registerLeftTab({ id: "macro-tab", title: "Macro", panelId: "chart", component: TestPanel })
    api.registerSurfaceResolver({ kind: "macro.open", resolve: () => ({ component: "chart" }) })

    expect(api.flush()).toMatchObject({
      panels: [{ id: "chart", label: "Chart" }],
      panelCommands: [{ id: "open-chart", title: "Open chart", panelId: "chart" }],
      leftTabs: [{ id: "macro-tab", title: "Macro", panelId: "chart" }],
      surfaceResolvers: [{ kind: "macro.open" }],
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
      "left-tab",
      "command",
      "surface-resolver",
    ])
    expect(plugin.outputs?.[0]).toMatchObject({
      type: "panel",
      panel: { id: "chart", title: "Chart", placement: "center", source: "plugin" },
    })
    expect(plugin.outputs?.[1]).toMatchObject({
      type: "left-tab",
      id: "macro-tab",
      title: "Macro",
      source: "plugin",
    })
    expect(plugin.outputs?.[2]).toMatchObject({
      type: "command",
      command: { id: "open-chart", title: "Open chart", keywords: ["chart"] },
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
