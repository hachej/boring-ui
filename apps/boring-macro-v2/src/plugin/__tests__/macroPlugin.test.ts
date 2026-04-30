import { describe, it, expect } from "vitest"
import { makeMacroClientPlugin, macroChatSuggestions } from "../index"
import { makeMacroServerPlugin } from "../server"
import type { MacroConfig } from "../../server/config"

describe("makeMacroClientPlugin", () => {
  const plugin = makeMacroClientPlugin(() => {})

  it("returns a plugin with id 'boring-macro'", () => {
    expect(plugin.id).toBe("boring-macro")
  })

  it("has label 'Macro'", () => {
    expect(plugin.label).toBe("Macro")
  })

  it("includes chart-canvas, deck, and macro-series panels", () => {
    const ids = plugin.panels!.map((p: { id: string }) => p.id)
    expect(ids).toContain("chart-canvas")
    expect(ids).toContain("deck")
    expect(ids).toContain("macro-series")
    expect(ids).toHaveLength(3)
  })

  it("includes macro-series catalog", () => {
    expect(plugin.catalogs).toHaveLength(1)
    expect(plugin.catalogs![0].id).toBe("macro-series")
  })

  it("has no agentTools (client-only)", () => {
    expect(plugin.agentTools).toBeUndefined()
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

  it("includes all 4 agent tools", () => {
    expect(plugin.agentTools).toHaveLength(4)
    const names = plugin.agentTools!.map((t) => t.name).sort()
    expect(names).toEqual([
      "execute_sql",
      "get_series_data",
      "macro_search",
      "persist_derived_series",
    ])
  })
})
