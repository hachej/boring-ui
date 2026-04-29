import { describe, expect, it, vi } from "vitest"
import { CommandRegistry } from "../../registry/CommandRegistry"
import { PanelRegistry } from "../../registry/PanelRegistry"
import type { CommandConfig, PanelConfig } from "../../registry/types"
import { bootstrap, type AgentToolRegistry } from "../bootstrap"
import { CatalogRegistry } from "../CatalogRegistry"
import { PluginError } from "../definePlugin"
import type { CatalogConfig, Plugin } from "../types"

const DummyPanel = () => null

function makeRegistries() {
  return {
    panels: new PanelRegistry(),
    commands: new CommandRegistry(),
    catalogs: new CatalogRegistry({ warnOnDuplicate: false }),
  }
}

function makePanel(overrides: Partial<PanelConfig> = {}): PanelConfig {
  return {
    id: "panel",
    title: "Panel",
    component: DummyPanel,
    ...overrides,
  } as PanelConfig
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

function makeAgentTool(name = "tool") {
  return {
    name,
    description: "Tool",
    parameters: { type: "object", properties: {} },
    execute: vi.fn(async () => ({ content: [{ type: "text" as const, text: "ok" }] })),
  }
}

describe("bootstrap", () => {
  it("returns an empty registered list for no plugins or defaults", () => {
    expect(
      bootstrap({
        plugins: [],
        defaults: [],
        registries: makeRegistries(),
      }),
    ).toEqual({ registered: [] })
  })

  it("fans panels, commands, catalogs, and agent tools into registries", () => {
    const registries = makeRegistries()
    const agentTools: AgentToolRegistry = { register: vi.fn() }
    const tool = makeAgentTool()

    bootstrap({
      plugins: [
        {
          id: "host",
          panels: [makePanel({ id: "files", pluginId: "author-supplied" })],
          commands: [makeCommand({ id: "open", pluginId: "author-supplied" })],
          catalogs: [makeCatalog({ id: "catalog", pluginId: "author-supplied" })],
          agentTools: [tool],
        },
      ],
      defaults: [],
      registries: { ...registries, agentTools },
    })

    expect(registries.panels.get("files")).toEqual(
      expect.objectContaining({ id: "files", pluginId: "host" }),
    )
    expect(registries.commands.getCommand("open")).toEqual(
      expect.objectContaining({ id: "open", pluginId: "host" }),
    )
    expect(registries.catalogs.get("catalog")).toEqual(
      expect.objectContaining({ id: "catalog", pluginId: "host" }),
    )
    expect(agentTools.register).toHaveBeenCalledWith(tool, "host")
  })

  it("registers defaults before host plugins and returns the final order", () => {
    const registries = makeRegistries()

    const result = bootstrap({
      defaults: [
        { id: "filesystem", commands: [makeCommand({ id: "default-command" })] },
        { id: "theme", commands: [makeCommand({ id: "theme-command" })] },
      ],
      plugins: [{ id: "host", commands: [makeCommand({ id: "host-command" })] }],
      registries,
    })

    expect(result).toEqual({ registered: ["filesystem", "theme", "host"] })
    expect(registries.commands.getCommands().map((command) => command.id)).toEqual([
      "default-command",
      "theme-command",
      "host-command",
    ])
  })

  it("excludes named defaults before plugin id uniqueness is checked", () => {
    const registries = makeRegistries()

    const result = bootstrap({
      defaults: [{ id: "filesystem", commands: [makeCommand({ id: "default" })] }],
      plugins: [{ id: "filesystem", commands: [makeCommand({ id: "host" })] }],
      excludeDefaults: ["filesystem"],
      registries,
    })

    expect(result).toEqual({ registered: ["filesystem"] })
    expect(registries.commands.getCommands()).toEqual([
      expect.objectContaining({ id: "host", pluginId: "filesystem" }),
    ])
  })

  it("throws duplicate-id for repeated plugin ids in the final set", () => {
    expect(() =>
      bootstrap({
        defaults: [{ id: "filesystem" }],
        plugins: [{ id: "filesystem" }],
        registries: makeRegistries(),
      }),
    ).toThrow(PluginError)

    try {
      bootstrap({
        defaults: [{ id: "filesystem" }],
        plugins: [{ id: "filesystem" }],
        registries: makeRegistries(),
      })
    } catch (error) {
      expect((error as PluginError).kind).toBe("duplicate-id")
      expect((error as PluginError).message).toBe('plugin "filesystem" registered twice')
    }
  })

  it("allows contribution id collisions and lets registries apply late-wins", () => {
    const registries = makeRegistries()

    bootstrap({
      defaults: [
        {
          id: "builtin",
          panels: [makePanel({ id: "filetree", title: "Builtin Files" })],
          commands: [makeCommand({ id: "open", title: "Builtin Open" })],
          catalogs: [makeCatalog({ id: "files", label: "Builtin Files" })],
        },
      ],
      plugins: [
        {
          id: "host",
          panels: [makePanel({ id: "filetree", title: "Host Files" })],
          commands: [makeCommand({ id: "open", title: "Host Open" })],
          catalogs: [makeCatalog({ id: "files", label: "Host Files" })],
        },
      ],
      registries,
    })

    expect(registries.panels.get("filetree")).toEqual(
      expect.objectContaining({ title: "Host Files", pluginId: "host" }),
    )
    expect(registries.commands.getCommand("open")).toEqual(
      expect.objectContaining({ title: "Host Open", pluginId: "host" }),
    )
    expect(registries.catalogs.get("files")).toEqual(
      expect.objectContaining({ label: "Host Files", pluginId: "host" }),
    )
  })

  it("is synchronous", () => {
    const result = bootstrap({
      defaults: [],
      plugins: [{ id: "host" }],
      registries: makeRegistries(),
    })

    expect(result).not.toBeInstanceOf(Promise)
  })

  it("does not require an agent tool registry on the client", () => {
    const plugin: Plugin = { id: "host", agentTools: [makeAgentTool()] }

    expect(() =>
      bootstrap({
        defaults: [],
        plugins: [plugin],
        registries: makeRegistries(),
      }),
    ).not.toThrow()
  })
})
