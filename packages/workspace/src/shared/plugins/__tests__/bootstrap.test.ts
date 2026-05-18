import { describe, expect, it, vi } from "vitest"
import { CommandRegistry } from "../../../front/registry/CommandRegistry"
import { PanelRegistry } from "../../../front/registry/PanelRegistry"
import { SurfaceResolverRegistry } from "../../../front/registry/SurfaceResolverRegistry"
import type { CommandConfig } from "../../../front/registry/types"
import { bootstrap } from "../bootstrap"
import { CatalogRegistry } from "../../../front/plugin/CatalogRegistry"
import { PluginError } from "../defineFrontPlugin"
import type { CatalogConfig } from "../types"

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

function makeCommand(overrides: Partial<CommandConfig> = {}): CommandConfig {
  return {
    id: "command",
    title: "Command",
    run: vi.fn(),
    ...overrides,
  }
}

function makeCatalog(overrides: Partial<CatalogConfig> = {}): CatalogConfig {
  return {
    id: "catalog",
    label: "Catalog",
    adapter: { search: async () => ({ items: [], total: 0, hasMore: false }) },
    onSelect: vi.fn(),
    ...overrides,
  }
}

describe("bootstrap", () => {
  it("requires an injected chat panel", () => {
    expect(() =>
      bootstrap({
        plugins: [],
        defaults: [],
        registries: makeRegistries(),
      } as unknown as Parameters<typeof bootstrap>[0]),
    ).toThrow("bootstrap requires chatPanel")
  })

  it("returns an empty registered list for no plugins or defaults", () => {
    expect(
      bootstrap({
        chatPanel: DummyChatPanel,
        plugins: [],
        defaults: [],
        registries: makeRegistries(),
      }),
    ).toEqual({ registered: [] })
  })

  it("normalizes plugin outputs into registries", () => {
    const registries = makeRegistries()

    bootstrap({
      chatPanel: DummyChatPanel,
      plugins: [
        {
          id: "host",
          outputs: [
            { type: "left-tab", id: "files", title: "Files", component: DummyPanel, source: "app" },
            { type: "command", command: makeCommand({ id: "output-command" }) },
            { type: "catalog", catalog: makeCatalog({ id: "output-catalog" }) },
            { type: "provider", id: "runtime", component: DummyPanel },
            {
              type: "surface-resolver",
              resolver: { id: "surface", resolve: () => ({ component: "files" }) },
            },
          ],
        },
      ],
      defaults: [],
      registries,
    })

    expect(registries.panels.get("files")).toEqual(
      expect.objectContaining({ id: "files", placement: "left-tab", pluginId: "host" }),
    )
    expect(registries.commands.getCommand("output-command")).toEqual(
      expect.objectContaining({ id: "output-command", pluginId: "host" }),
    )
    expect(registries.catalogs.get("output-catalog")).toEqual(
      expect.objectContaining({ id: "output-catalog", pluginId: "host" }),
    )
    expect(registries.surfaceResolvers.get("surface")).toEqual(
      expect.objectContaining({ id: "surface", pluginId: "host" }),
    )
  })

  it("registers defaults before host plugins and returns the final order", () => {
    const registries = makeRegistries()

    const result = bootstrap({
      chatPanel: DummyChatPanel,
      defaults: [
        { id: "filesystem", outputs: [{ type: "command", command: makeCommand({ id: "default-command" }) }] },
        { id: "theme", outputs: [{ type: "command", command: makeCommand({ id: "theme-command" }) }] },
      ],
      plugins: [
        { id: "host", outputs: [{ type: "command", command: makeCommand({ id: "host-command" }) }] },
      ],
      registries,
    })

    expect(result.registered).toEqual(["filesystem", "theme", "host"])
    expect(registries.commands.getCommands().map((c) => c.id)).toEqual([
      "default-command",
      "theme-command",
      "host-command",
    ])
  })

  it("excludes named defaults before plugin id uniqueness is checked", () => {
    const registries = makeRegistries()

    const result = bootstrap({
      chatPanel: DummyChatPanel,
      defaults: [{ id: "filesystem", outputs: [{ type: "command", command: makeCommand({ id: "default" }) }] }],
      plugins: [{ id: "filesystem", outputs: [{ type: "command", command: makeCommand({ id: "host" }) }] }],
      excludeDefaults: ["filesystem"],
      registries,
    })

    expect(result.registered).toEqual(["filesystem"])
    expect(registries.commands.getCommands()).toEqual([
      expect.objectContaining({ id: "host", pluginId: "filesystem" }),
    ])
  })

  it("throws duplicate-id for repeated plugin ids in the final set", () => {
    expect(() =>
      bootstrap({
        chatPanel: DummyChatPanel,
        defaults: [{ id: "filesystem", outputs: [] }],
        plugins: [{ id: "filesystem", outputs: [] }],
        registries: makeRegistries(),
      }),
    ).toThrow(PluginError)
  })

  it("is synchronous", () => {
    const result = bootstrap({
      chatPanel: DummyChatPanel,
      defaults: [],
      plugins: [{ id: "host", outputs: [] }],
      registries: makeRegistries(),
    })
    expect(result).not.toBeInstanceOf(Promise)
  })
})
