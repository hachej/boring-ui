import { describe, expect, it, vi } from "vitest"
import { CommandRegistry } from "../../../front/registry/CommandRegistry"
import { PanelRegistry } from "../../../front/registry/PanelRegistry"
import { SurfaceResolverRegistry } from "../../../front/registry/SurfaceResolverRegistry"
import { CatalogRegistry } from "../../../front/plugin/CatalogRegistry"
import type { CatalogConfig } from "../types"
import { bootstrap } from "../bootstrap"
import { composePlugins } from "../composePlugins"
import { PluginError } from "../defineFrontPlugin"

const DummyPanel = () => null
const DummyChatPanel = () => null

function makeRegistries() {
  return {
    panels: new PanelRegistry(),
    commands: new CommandRegistry(),
    catalogs: new CatalogRegistry({ warnOnDuplicate: false }),
    surfaceResolvers: new SurfaceResolverRegistry(),
  }
}

function makeCatalog(id: string): CatalogConfig {
  return {
    id,
    label: id,
    adapter: { search: async () => ({ items: [], total: 0, hasMore: false }) },
    onSelect: vi.fn(),
  }
}

describe("composePlugins", () => {
  it("flattens child plugin contributions in order before parent outputs", () => {
    const plugin = composePlugins({
      id: "macro",
      label: "Macro",
      plugins: [
        {
          id: "panels",
          panels: [{ id: "chart", title: "Chart", component: DummyPanel }],
        },
        {
          id: "catalog",
          catalogs: [makeCatalog("series")],
        },
      ],
      outputs: [
        {
          type: "left-tab",
          id: "extra",
          title: "Extra",
          component: DummyPanel,
        },
      ],
    })

    expect(plugin.id).toBe("macro")
    expect(plugin.label).toBe("Macro")
    expect(plugin.panels).toBeUndefined()
    expect(plugin.catalogs).toBeUndefined()
    expect(plugin.outputs?.map((output) => output.type)).toEqual([
      "panel",
      "catalog",
      "left-tab",
    ])
  })

  it("adopts child output ownership to the parent plugin by default", () => {
    const registries = makeRegistries()
    const plugin = composePlugins({
      id: "macro",
      plugins: [
        {
          id: "catalog-child",
          catalogs: [makeCatalog("series")],
          outputs: [
            {
              type: "left-tab",
              id: "data",
              title: "Data",
              component: DummyPanel,
            },
          ],
        },
      ],
    })

    bootstrap({
      chatPanel: DummyChatPanel,
      plugins: [plugin],
      defaults: [],
      registries,
    })

    expect(registries.catalogs.get("series")).toEqual(
      expect.objectContaining({ pluginId: "macro" }),
    )
    expect(registries.panels.get("data")).toEqual(
      expect.objectContaining({ pluginId: "macro" }),
    )
  })

  it("can preserve child plugin ownership when adoptOutputs is false", () => {
    const registries = makeRegistries()
    const plugin = composePlugins({
      id: "macro",
      adoptOutputs: false,
      plugins: [
        {
          id: "catalog-child",
          catalogs: [makeCatalog("series")],
          outputs: [
            {
              type: "left-tab",
              id: "data",
              title: "Data",
              component: DummyPanel,
            },
          ],
        },
      ],
    })

    bootstrap({
      chatPanel: DummyChatPanel,
      plugins: [plugin],
      defaults: [],
      registries,
    })

    expect(registries.catalogs.get("series")).toEqual(
      expect.objectContaining({ pluginId: "catalog-child" }),
    )
    expect(registries.panels.get("data")).toEqual(
      expect.objectContaining({ pluginId: "catalog-child" }),
    )
  })

  it("adopting parent strips existing child ownership from nested composition", () => {
    const registries = makeRegistries()
    const inner = composePlugins({
      id: "inner",
      adoptOutputs: false,
      plugins: [
        {
          id: "leaf",
          outputs: [{ type: "left-tab", id: "data", title: "Data", component: DummyPanel }],
        },
      ],
    })
    const outer = composePlugins({ id: "outer", plugins: [inner] })

    bootstrap({
      chatPanel: DummyChatPanel,
      plugins: [outer],
      defaults: [],
      registries,
    })

    expect(registries.panels.get("data")).toEqual(
      expect.objectContaining({ pluginId: "outer" }),
    )
  })

  it("preserves child ownership for surface resolvers and agent tools", () => {
    const registries = makeRegistries()
    const agentTools = { register: vi.fn() }
    const tool = {
      name: "tool",
      description: "Tool",
      parameters: { type: "object", properties: {} },
      execute: vi.fn(async () => ({ content: [{ type: "text" as const, text: "ok" }] })),
    }
    const plugin = composePlugins({
      id: "macro",
      adoptOutputs: false,
      plugins: [
        {
          id: "surfaces",
          outputs: [
            {
              type: "surface-resolver",
              resolver: { id: "surface", resolve: () => ({ component: "chart" }) },
            },
            { type: "agent-tool", id: tool.name, tool },
          ],
        },
      ],
    })

    bootstrap({
      chatPanel: DummyChatPanel,
      plugins: [plugin],
      defaults: [],
      registries: { ...registries, agentTools },
    })

    expect(registries.surfaceResolvers.get("surface")).toEqual(
      expect.objectContaining({ pluginId: "surfaces" }),
    )
    expect(agentTools.register).toHaveBeenCalledWith(tool, "surfaces")
  })

  it("creates a valid empty composed plugin", () => {
    expect(composePlugins({ id: "empty", plugins: [] })).toEqual({
      id: "empty",
      label: undefined,
      outputs: [],
      systemPrompt: undefined,
    })
  })

  it("combines child and parent system prompts", () => {
    const plugin = composePlugins({
      id: "macro",
      systemPrompt: "Parent prompt",
      plugins: [
        { id: "a", systemPrompt: "Child A" },
        { id: "b", systemPrompt: "Child B" },
      ],
    })

    expect(plugin.systemPrompt).toBe("Child A\n\nChild B\n\nParent prompt")
  })

  it("rejects duplicate contribution ids after flattening", () => {
    expect(() =>
      composePlugins({
        id: "macro",
        plugins: [
          {
            id: "a",
            panels: [{ id: "chart", title: "Chart", component: DummyPanel }],
          },
          {
            id: "b",
            panels: [{ id: "chart", title: "Chart", component: DummyPanel }],
          },
        ],
      }),
    ).toThrow(PluginError)
  })
})
