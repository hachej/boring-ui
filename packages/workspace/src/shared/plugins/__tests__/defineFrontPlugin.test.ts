import { describe, it, expect } from "vitest"
import {
  defineFrontPlugin,
  PluginError,
  type WorkspaceFrontPlugin,
} from "../defineFrontPlugin"
import type { PanelConfig } from "../../../front/registry/types"
import type { CommandConfig } from "../../../front/registry/types"
import type { CatalogConfig } from "../types"

const DummyComponent = () => null

function makePanel(overrides?: Partial<PanelConfig>): PanelConfig {
  return {
    id: "test-panel",
    title: "Test",
    component: DummyComponent,
    ...overrides,
  } as PanelConfig
}

function makeCommand(overrides?: Partial<CommandConfig>): CommandConfig {
  return {
    id: "test-cmd",
    title: "Test Command",
    run: () => {},
    ...overrides,
  }
}

function makeCatalog(overrides?: Partial<CatalogConfig>): CatalogConfig {
  return {
    id: "test-catalog",
    label: "Test Catalog",
    adapter: { search: async () => ({ items: [], total: 0, hasMore: false }) },
    onSelect: () => {},
    ...overrides,
  }
}

describe("defineFrontPlugin", () => {
  it("returns a shallow clone of valid input", () => {
    const spec: WorkspaceFrontPlugin = { id: "foo" }
    const result = defineFrontPlugin(spec)
    expect(result).toEqual(spec)
    expect(result).not.toBe(spec)
  })

  it("accepts a minimal plugin with only id", () => {
    expect(defineFrontPlugin({ id: "minimal" })).toHaveProperty("id", "minimal")
  })

  it("preserves optional label", () => {
    const result = defineFrontPlugin({ id: "x", label: "My Plugin" })
    expect(result.label).toBe("My Plugin")
  })

  describe("id validation", () => {
    it("throws on empty id", () => {
      expect(() => defineFrontPlugin({ id: "" })).toThrow(PluginError)
      expect(() => defineFrontPlugin({ id: "" })).toThrow("id must be a non-empty string")
    })

    it("throws on non-string id", () => {
      expect(() =>
        defineFrontPlugin({ id: 42 } as unknown as WorkspaceFrontPlugin),
      ).toThrow(PluginError)
    })
  })

  describe("panels validation", () => {
    it("accepts valid panels", () => {
      const result = defineFrontPlugin({
        id: "test",
        panels: [makePanel({ id: "p1" }), makePanel({ id: "p2" })],
      })
      expect(result.panels).toHaveLength(2)
    })

    it("throws on duplicate panel ids within plugin", () => {
      expect(() =>
        defineFrontPlugin({
          id: "test",
          panels: [makePanel({ id: "dup" }), makePanel({ id: "dup" })],
        }),
      ).toThrow('panels[1].id "dup" is duplicated')
    })

    it("throws on invalid placement", () => {
      expect(() =>
        defineFrontPlugin({
          id: "test",
          panels: [makePanel({ id: "p1", placement: "nowhere" as any })],
        }),
      ).toThrow("placement must be one of")
    })

    it("accepts all valid placements", () => {
      const placements = [
        "left",
        "center",
        "right",
        "bottom",
        "left-tab",
        "right-tab",
      ] as const
      for (const placement of placements) {
        expect(() =>
          defineFrontPlugin({ id: "test", panels: [makePanel({ id: "p1", placement })] }),
        ).not.toThrow()
      }
    })

    it("throws on non-function component when lazy:true", () => {
      expect(() =>
        defineFrontPlugin({
          id: "test",
          panels: [
            {
              id: "p1",
              title: "Lazy",
              component: "not-a-thunk" as any,
              lazy: true,
            } as any,
          ],
        }),
      ).toThrow("panels[0].component must be a ComponentType or lazy factory (got: string)")
    })

    it("accepts lazy panel with thunk component", () => {
      expect(() =>
        defineFrontPlugin({
          id: "test",
          panels: [
            {
              id: "p1",
              title: "Lazy",
              component: () => Promise.resolve({ default: DummyComponent }),
              lazy: true,
            },
          ],
        }),
      ).not.toThrow()
    })

    it("throws on non-function component when not lazy", () => {
      expect(() =>
        defineFrontPlugin({
          id: "test",
          panels: [{ id: "p1", title: "Bad", component: 42 } as any],
        }),
      ).toThrow("must be a ComponentType")
    })
  })

  describe("outputs validation", () => {
    it("accepts a left-tab output", () => {
      const result = defineFrontPlugin({
        id: "test",
        outputs: [
          {
            type: "left-tab",
            id: "files",
            title: "Files",
            component: DummyComponent,
            source: "builtin",
          },
        ],
      })
      expect(result.outputs).toHaveLength(1)
    })

    it("throws on duplicate output identities", () => {
      expect(() =>
        defineFrontPlugin({
          id: "test",
          outputs: [
            { type: "left-tab", id: "files", title: "Files", component: DummyComponent },
            { type: "left-tab", id: "files", title: "Files", component: DummyComponent },
          ],
        }),
      ).toThrow('outputs[1] "left-tab:files" is duplicated')
    })

    it("throws on invalid output type", () => {
      expect(() =>
        defineFrontPlugin({
          id: "test",
          outputs: [{ type: "side-tab", id: "x" } as any],
        }),
      ).toThrow("outputs[0].type must be one of")
    })

    it("throws on invalid left-tab component", () => {
      expect(() =>
        defineFrontPlugin({
          id: "test",
          outputs: [
            { type: "left-tab", id: "files", title: "Files", component: 42 as any },
          ],
        }),
      ).toThrow("outputs[0].component must be a ComponentType")
    })

    it("accepts a provider output", () => {
      const result = defineFrontPlugin({
        id: "test",
        outputs: [
          {
            type: "provider",
            id: "runtime",
            component: DummyComponent,
          },
        ],
      })
      expect(result.outputs).toHaveLength(1)
    })

    it("throws on invalid provider output component", () => {
      expect(() =>
        defineFrontPlugin({
          id: "test",
          outputs: [
            {
              type: "provider",
              id: "runtime",
              component: null as any,
            },
          ],
        }),
      ).toThrow("bindings[0] must be a component function")
    })

    it("accepts a surface resolver output", () => {
      const result = defineFrontPlugin({
        id: "test",
        outputs: [
          {
            type: "surface-resolver",
            resolver: {
              id: "open-target",
              resolve: () => ({ component: "test-panel" }),
            },
          },
        ],
      })
      expect(result.outputs).toHaveLength(1)
    })

    it("throws on invalid surface resolver output", () => {
      expect(() =>
        defineFrontPlugin({
          id: "test",
          outputs: [
            {
              type: "surface-resolver",
              resolver: { id: "open-target" } as any,
            },
          ],
        }),
      ).toThrow("outputs[0].resolver.resolve must be a function")
    })
  })

  describe("commands validation", () => {
    it("accepts valid commands", () => {
      const result = defineFrontPlugin({
        id: "test",
        commands: [makeCommand()],
      })
      expect(result.commands).toHaveLength(1)
    })

    it("throws on duplicate command ids", () => {
      expect(() =>
        defineFrontPlugin({
          id: "test",
          commands: [makeCommand({ id: "c" }), makeCommand({ id: "c" })],
        }),
      ).toThrow('commands[1].id "c" is duplicated')
    })

    it("throws on non-function run", () => {
      expect(() =>
        defineFrontPlugin({
          id: "test",
          commands: [{ id: "c", title: "Bad", run: "string" } as any],
        }),
      ).toThrow("commands[0].run must be a function")
    })

    it("accepts keywords when they are non-empty strings", () => {
      expect(() =>
        defineFrontPlugin({
          id: "test",
          commands: [makeCommand({ keywords: ["team", "people"] })],
        }),
      ).not.toThrow()
    })

    it("throws on invalid keywords payloads", () => {
      expect(() =>
        defineFrontPlugin({
          id: "test",
          commands: [makeCommand({ keywords: "team" as unknown as string[] })],
        }),
      ).toThrow("commands[0].keywords must be an array when provided")

      expect(() =>
        defineFrontPlugin({
          id: "test",
          commands: [makeCommand({ keywords: ["team", ""] })],
        }),
      ).toThrow("commands[0].keywords[1] must be a non-empty string")
    })
  })

  describe("catalogs validation", () => {
    it("accepts valid catalogs", () => {
      const result = defineFrontPlugin({
        id: "test",
        catalogs: [makeCatalog()],
      })
      expect(result.catalogs).toHaveLength(1)
    })

    it("throws on duplicate catalog ids", () => {
      expect(() =>
        defineFrontPlugin({
          id: "test",
          catalogs: [makeCatalog({ id: "x" }), makeCatalog({ id: "x" })],
        }),
      ).toThrow('catalogs[1].id "x" is duplicated')
    })

    it("throws when adapter.search is not a function", () => {
      expect(() =>
        defineFrontPlugin({
          id: "test",
          catalogs: [makeCatalog({ adapter: {} as any })],
        }),
      ).toThrow("catalogs[0].adapter.search must be a function")
    })

    it("throws when onSelect is not a function", () => {
      expect(() =>
        defineFrontPlugin({
          id: "test",
          catalogs: [makeCatalog({ onSelect: "bad" as any })],
        }),
      ).toThrow("catalogs[0].onSelect must be a function")
    })
  })

  describe("PluginError", () => {
    it("is instanceof Error", () => {
      const err = new PluginError("validation", "test")
      expect(err).toBeInstanceOf(Error)
    })

    it("has correct kind", () => {
      const err = new PluginError("duplicate-id", "dup")
      expect(err.kind).toBe("duplicate-id")
    })

    it("contains plugin id in message", () => {
      try {
        defineFrontPlugin({ id: "my-plugin", panels: [{ id: "", title: "" } as any] })
      } catch (e) {
        expect((e as PluginError).message).toContain('plugin "my-plugin"')
        expect((e as PluginError).kind).toBe("validation")
      }
    })
  })
})
