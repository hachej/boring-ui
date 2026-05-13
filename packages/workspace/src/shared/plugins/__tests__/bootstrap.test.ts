import { describe, expect, it, vi } from "vitest"
import { CommandRegistry } from "../../../front/registry/CommandRegistry"
import { PanelRegistry } from "../../../front/registry/PanelRegistry"
import { SurfaceResolverRegistry } from "../../../front/registry/SurfaceResolverRegistry"
import type { CommandConfig, PanelConfig } from "../../../front/registry/types"
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
    ).toEqual({ registered: [], systemPromptAppend: "" })
  })

  it("fans panels, commands, and catalogs into registries", () => {
    const registries = makeRegistries()

    bootstrap({
      chatPanel: DummyChatPanel,
      plugins: [
        {
          id: "host",
          panels: [makePanel({ id: "files", pluginId: "author-supplied" })],
          commands: [makeCommand({ id: "open", pluginId: "author-supplied" })],
          catalogs: [makeCatalog({ id: "catalog", pluginId: "author-supplied" })],
        },
      ],
      defaults: [],
      registries,
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
  })

  it("normalizes plugin outputs into registries", () => {
    const registries = makeRegistries()

    bootstrap({
      chatPanel: DummyChatPanel,
      plugins: [
        {
          id: "host",
          outputs: [
            {
              type: "left-tab",
              id: "files",
              title: "Files",
              component: DummyPanel,
              source: "app",
            },
            { type: "command", command: makeCommand({ id: "output-command" }) },
            { type: "catalog", catalog: makeCatalog({ id: "output-catalog" }) },
            { type: "provider", id: "runtime", component: DummyPanel },
            {
              type: "surface-resolver",
              resolver: {
                id: "surface",
                resolve: () => ({ component: "files" }),
              },
            },
          ],
        },
      ],
      defaults: [],
      registries,
    })

    expect(registries.panels.get("files")).toEqual(
      expect.objectContaining({
        id: "files",
        title: "Files",
        placement: "left-tab",
        pluginId: "host",
      }),
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
        { id: "filesystem", commands: [makeCommand({ id: "default-command" })] },
        { id: "theme", commands: [makeCommand({ id: "theme-command" })] },
      ],
      plugins: [{ id: "host", commands: [makeCommand({ id: "host-command" })] }],
      registries,
    })

    expect(result).toEqual({ registered: ["filesystem", "theme", "host"], systemPromptAppend: "" })
    expect(registries.commands.getCommands().map((command) => command.id)).toEqual([
      "default-command",
      "theme-command",
      "host-command",
    ])
  })

  it("excludes named defaults before plugin id uniqueness is checked", () => {
    const registries = makeRegistries()

    const result = bootstrap({
      chatPanel: DummyChatPanel,
      defaults: [{ id: "filesystem", commands: [makeCommand({ id: "default" })] }],
      plugins: [{ id: "filesystem", commands: [makeCommand({ id: "host" })] }],
      excludeDefaults: ["filesystem"],
      registries,
    })

    expect(result).toEqual({ registered: ["filesystem"], systemPromptAppend: "" })
    expect(registries.commands.getCommands()).toEqual([
      expect.objectContaining({ id: "host", pluginId: "filesystem" }),
    ])
  })

  it("throws duplicate-id for repeated plugin ids in the final set", () => {
    expect(() =>
      bootstrap({
        chatPanel: DummyChatPanel,
        defaults: [{ id: "filesystem" }],
        plugins: [{ id: "filesystem" }],
        registries: makeRegistries(),
      }),
    ).toThrow(PluginError)

    try {
      bootstrap({
        chatPanel: DummyChatPanel,
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
      chatPanel: DummyChatPanel,
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
      chatPanel: DummyChatPanel,
      defaults: [],
      plugins: [{ id: "host" }],
      registries: makeRegistries(),
    })

    expect(result).not.toBeInstanceOf(Promise)
  })

  describe("systemPromptAppend", () => {
    it("returns empty string when no plugins have systemPrompt", () => {
      const result = bootstrap({
        chatPanel: DummyChatPanel,
        plugins: [{ id: "a" }, { id: "b" }],
        defaults: [],
        registries: makeRegistries(),
      })
      expect(result.systemPromptAppend).toBe("")
    })

    it("returns trimmed prompt from a single plugin", () => {
      const result = bootstrap({
        chatPanel: DummyChatPanel,
        plugins: [{ id: "a", systemPrompt: "  Hello world  " }],
        defaults: [],
        registries: makeRegistries(),
      })
      expect(result.systemPromptAppend).toBe("Hello world")
    })

    it("joins multiple prompts with double-newline in registration order", () => {
      const result = bootstrap({
        chatPanel: DummyChatPanel,
        defaults: [{ id: "default", systemPrompt: "Default context" }],
        plugins: [{ id: "host", systemPrompt: "Host context" }],
        registries: makeRegistries(),
      })
      expect(result.systemPromptAppend).toBe("Default context\n\nHost context")
    })

    it("skips plugins with undefined systemPrompt", () => {
      const result = bootstrap({
        chatPanel: DummyChatPanel,
        plugins: [
          { id: "a", systemPrompt: "A" },
          { id: "b" },
          { id: "c", systemPrompt: "C" },
        ],
        defaults: [],
        registries: makeRegistries(),
      })
      expect(result.systemPromptAppend).toBe("A\n\nC")
    })

    it("skips plugins with whitespace-only systemPrompt", () => {
      const result = bootstrap({
        chatPanel: DummyChatPanel,
        plugins: [
          { id: "a", systemPrompt: "A" },
          { id: "b", systemPrompt: "   " },
          { id: "c", systemPrompt: "\n\t" },
        ],
        defaults: [],
        registries: makeRegistries(),
      })
      expect(result.systemPromptAppend).toBe("A")
    })

    it("preserves defaults-first ordering for prompt concatenation", () => {
      const result = bootstrap({
        chatPanel: DummyChatPanel,
        defaults: [
          { id: "fs", systemPrompt: "Filesystem plugin" },
          { id: "theme", systemPrompt: "Theme plugin" },
        ],
        plugins: [{ id: "macro", systemPrompt: "Macro plugin" }],
        registries: makeRegistries(),
      })
      expect(result.systemPromptAppend).toBe(
        "Filesystem plugin\n\nTheme plugin\n\nMacro plugin",
      )
    })
  })
})
