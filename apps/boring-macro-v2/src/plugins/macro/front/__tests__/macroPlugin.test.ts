import { describe, it, expect, vi } from "vitest"
import { events } from "@boring/workspace"
import { createCapturingBoringFrontAPI } from "@boring/workspace/plugin"
import macroFront, { makeMacroClientPlugin, macroChatSuggestions } from "../index"
import { makeMacroServerPlugin } from "../../server"
import { MACRO_OPEN_SERIES_SURFACE_KIND } from "../../shared/constants"
import { openSeriesPane } from "../data/macroSeriesUi"
import type { MacroConfig } from "../../server/config"
import type { SurfaceResolverOutput } from "@boring/workspace"

const UI_COMMAND_EVENT = "workspace:ui.command"

describe("makeMacroClientPlugin", () => {
  const onSeriesSelect = vi.fn()
  const plugin = makeMacroClientPlugin(onSeriesSelect)

  function findSurfaceResolver(id: string): SurfaceResolverOutput | undefined {
    return plugin.outputs?.find((output): output is SurfaceResolverOutput => {
      if (output.type !== "surface-resolver") return false
      return output.resolver.id === id
    })
  }

  it("returns a plugin with id 'boring-macro'", () => {
    expect(plugin.id).toBe("boring-macro")
  })

  it("has label 'Macro'", () => {
    expect(plugin.label).toBe("Macro")
  })

  it("includes chart-canvas and deck panel outputs", () => {
    const ids = plugin.outputs
      ?.filter((output) => output.type === "panel")
      .map((output) => output.panel.id)
    expect(ids).toEqual(["chart-canvas", "deck"])
    expect(plugin.panels).toBeUndefined()
  })

  it("installs reusable data catalog outputs for macro series", () => {
    expect(plugin.catalogs).toBeUndefined()
    expect(plugin.outputs?.map((output) => output.type)).toEqual([
      "panel",
      "panel",
      "surface-resolver",
      "surface-resolver",
      "left-tab",
      "catalog",
    ])
    expect(plugin.outputs?.[2]).toEqual(
      expect.objectContaining({
        type: "surface-resolver",
        resolver: expect.objectContaining({ id: "boring-macro-series" }),
      }),
    )
    expect(plugin.outputs?.[3]).toEqual(
      expect.objectContaining({
        type: "surface-resolver",
        resolver: expect.objectContaining({ id: "boring-macro-deck-path" }),
      }),
    )
    expect(plugin.outputs?.[4]).toEqual(
      expect.objectContaining({
        type: "left-tab",
        id: "macro-series",
        title: "Data",
      }),
    )
    expect(plugin.outputs?.[5]).toEqual(
      expect.objectContaining({
        type: "catalog",
        catalog: expect.objectContaining({
          id: "macro-series",
          label: "Macro Series",
        }),
      }),
    )
  })

  it("routes macro series targets through the macro surface resolver", () => {
    const resolver = findSurfaceResolver("boring-macro-series")
    expect(resolver?.type).toBe("surface-resolver")
    expect(resolver?.resolver.resolve({
      kind: MACRO_OPEN_SERIES_SURFACE_KIND,
      target: "GDPC1",
      meta: { title: "Real GDP" },
    })).toEqual({
      id: "chart:GDPC1",
      component: "chart-canvas",
      title: "Real GDP",
      params: { seriesId: "GDPC1" },
      score: 0,
    })
  })

  it("posts macro series openings as macro-owned surface targets", () => {
    const observed: unknown[] = []
    const unsubscribe = events.on(UI_COMMAND_EVENT, (payload) =>
      observed.push(payload.command),
    )

    try {
      openSeriesPane(" GDPC1 ", { title: "Real GDP" })
      openSeriesPane("   ")

      expect(observed).toEqual([
        {
          kind: "openSurface",
          params: {
            kind: MACRO_OPEN_SERIES_SURFACE_KIND,
            target: "GDPC1",
            meta: { title: "Real GDP" },
          },
        },
      ])
    } finally {
      unsubscribe()
    }
  })

  it("routes deck markdown paths through the macro surface resolver", () => {
    const resolver = findSurfaceResolver("boring-macro-deck-path")
    expect(resolver?.type).toBe("surface-resolver")
    expect(resolver?.resolver.resolve({
      kind: "workspace.open.path",
      target: "deck/labor.md",
    })).toEqual({
      id: "file:deck/labor.md",
      component: "deck",
      title: "labor.md",
      params: { path: "deck/labor.md" },
      score: 10,
    })
    expect(resolver?.resolver.resolve({
      kind: "workspace.open.path",
      target: "notes/labor.md",
    })).toBeUndefined()
  })

  it("routes macro catalog activation through the host callback", () => {
    const catalog = plugin.outputs?.find((output) => output.type === "catalog")?.catalog
    const row = { id: "GDPC1", title: "Real GDP" }

    catalog!.onSelect(row)

    expect(onSeriesSelect).toHaveBeenCalledWith(row)
  })

  it("has no agentTools (client-only)", () => {
    expect(plugin.agentTools).toBeUndefined()
  })
})

describe("macroFront", () => {
  it("default-exports a BoringFrontFactory for dynamic hot reload", () => {
    const api = createCapturingBoringFrontAPI()
    macroFront(api)
    const captured = api.flush()

    expect(captured.panels.map((panel) => panel.id)).toEqual(["chart-canvas", "deck"])
    expect(captured.surfaceResolvers.map((resolver) => resolver.id)).toEqual([
      "boring-macro-series",
      "boring-macro-deck-path",
    ])
    expect(captured.surfaceResolvers[0].resolve({
      kind: MACRO_OPEN_SERIES_SURFACE_KIND,
      target: "GDPC1",
    })).toEqual({
      id: "chart:GDPC1",
      component: "chart-canvas",
      title: "GDPC1",
      params: { seriesId: "GDPC1" },
      score: 0,
    })
  })
})

describe("macroChatSuggestions", () => {
  it("exports 4 suggestions", () => {
    expect(macroChatSuggestions).toHaveLength(4)
  })

  it("each has label, hint, icon, and prompt", () => {
    for (const s of macroChatSuggestions) {
      expect(typeof s.label).toBe("string")
      expect(typeof s.hint).toBe("string")
      expect(s.icon).toBeDefined()
      expect(typeof s.prompt).toBe("string")
    }
  })
})

describe("makeMacroServerPlugin", () => {
  const macroConfig: MacroConfig = {
    clickhouse: null,
    authRedirectOnRoot: false,
    devAutoSession: true,
    deckRoot: "/tmp",
  }
  const plugin = makeMacroServerPlugin(macroConfig)

  it("returns a plugin with id 'boring-macro'", () => {
    expect(plugin.id).toBe("boring-macro")
  })

  it("has label 'Macro'", () => {
    expect(plugin.label).toBe("Macro")
  })

  it("registers a native pi extension path instead of legacy agentTools", () => {
    expect(plugin.agentTools).toBeUndefined()
    expect(plugin.systemPrompt).toBeUndefined()
    expect(plugin.extensionPaths).toHaveLength(1)
    expect(plugin.extensionPaths![0]).toMatch(/macro\/agent\/index\.ts$/)
  })
})
