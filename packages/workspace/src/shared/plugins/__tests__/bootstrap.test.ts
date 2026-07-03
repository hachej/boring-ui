import { describe, expect, it, vi } from "vitest"
import { CommandRegistry } from "../CommandRegistry"
import { PanelRegistry } from "../../../front/registry/PanelRegistry"
import { WorkspaceSourceRegistry } from "../../../front/registry/WorkspaceSourceRegistry"
import { SurfaceResolverRegistry } from "../SurfaceResolverRegistry"
import type { CommandConfig } from "../../types/panel"
import { bootstrap, captureBootstrapPlugins } from "../bootstrap"
import { CatalogRegistry } from "../CatalogRegistry"
import { PluginError } from "../errors"
import { captureFrontPlugin, definePlugin } from "../frontFactory"
import type { CatalogConfig } from "../types"

const DummyPanel = () => null
const DummyChatPanel = () => null
const DummyOverlay = () => null

function makeRegistries() {
  return {
    panels: new PanelRegistry(),
    workspaceSources: new WorkspaceSourceRegistry(),
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
    const result = bootstrap({
      chatPanel: DummyChatPanel,
      plugins: [],
      defaults: [],
      registries: makeRegistries(),
    })
    expect(result.registered).toEqual([])
    expect(result.plugins).toEqual([])
  })

  it("captures front factories into registries", () => {
    const registries = makeRegistries()

    bootstrap({
      chatPanel: DummyChatPanel,
      plugins: [
        definePlugin({
          id: "host",
          panels: [{ id: "files", label: "Files", component: DummyPanel, placement: "workspace-page", source: "app" }],
          commands: [{ id: "output-command", title: "Output Command", run: vi.fn() }],
          catalogs: [makeCatalog({ id: "output-catalog" })],
          providers: [{ id: "runtime", component: DummyPanel }],
          surfaceResolvers: [{ id: "surface", kind: "surface", resolve: () => ({ component: "files" }) }],
        }),
      ],
      defaults: [],
      registries,
    })

    expect(registries.panels.get("files")).toEqual(
      expect.objectContaining({ id: "files", placement: "workspace-page", pluginId: "host" }),
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

  it("throws instead of silently dropping workspace sources when registry is missing", () => {
    expect(() => bootstrap({
      chatPanel: DummyChatPanel,
      defaults: [],
      plugins: [definePlugin({
        id: "source-plugin",
        workspaceSources: [{ id: "source", label: "Source", component: DummyPanel }],
      })],
      registries: {
        panels: new PanelRegistry(),
        commands: new CommandRegistry(),
        catalogs: new CatalogRegistry({ warnOnDuplicate: false }),
      },
    })).toThrow("registries.workspaceSources is missing")
  })

  it("wires declarative panel commands with panelId to an executable runner", () => {
    const registries = makeRegistries()
    const openPanel = vi.fn()

    bootstrap({
      chatPanel: DummyChatPanel,
      defaults: [],
      plugins: [definePlugin({
        id: "host",
        commands: [{ id: "host.open", title: "Open Host", panelId: "host.page" }],
      })],
      registries,
      panelCommandRunner: (command) => command.panelId ? () => openPanel(command.panelId) : undefined,
    })

    registries.commands.getCommand("host.open")?.run()

    expect(openPanel).toHaveBeenCalledWith("host.page")
  })

  it("registers defaults before host plugins and returns the final order", () => {
    const registries = makeRegistries()

    const result = bootstrap({
      chatPanel: DummyChatPanel,
      defaults: [
        definePlugin({ id: "filesystem", commands: [{ id: "default-command", title: "Default", run: vi.fn() }] }),
        definePlugin({ id: "theme", commands: [{ id: "theme-command", title: "Theme", run: vi.fn() }] }),
      ],
      plugins: [
        definePlugin({ id: "host", commands: [{ id: "host-command", title: "Host", run: vi.fn() }] }),
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
      defaults: [definePlugin({ id: "filesystem", commands: [{ id: "default", title: "Default", run: vi.fn() }] })],
      plugins: [definePlugin({ id: "filesystem", commands: [{ id: "host", title: "Host", run: vi.fn() }] })],
      excludeDefaults: ["filesystem"],
      registries,
    })

    expect(result.registered).toEqual(["filesystem"])
    expect(registries.commands.getCommands()).toEqual([
      expect.objectContaining({ id: "host", pluginId: "filesystem" }),
    ])
  })

  it("throws duplicate-id for app-left action collisions across plugins", () => {
    expect(() =>
      captureBootstrapPlugins({
        defaults: [definePlugin({ id: "a", appLeftActions: [{ id: "inbox", label: "Inbox", overlay: DummyOverlay }] })],
        plugins: [definePlugin({ id: "b", appLeftActions: [{ id: "inbox", label: "Other Inbox", overlay: DummyOverlay }] })],
      }),
    ).toThrow(/app-left action/)
  })

  it("throws duplicate-id for app-left action collisions in pre-captured plugins", () => {
    const capturedPlugins = [
      captureFrontPlugin(definePlugin({ id: "a", appLeftActions: [{ id: "inbox", label: "Inbox", overlay: DummyOverlay }] })),
      captureFrontPlugin(definePlugin({ id: "b", appLeftActions: [{ id: "inbox", label: "Other Inbox", overlay: DummyOverlay }] })),
    ]

    expect(() => captureBootstrapPlugins({ capturedPlugins })).toThrow(/app-left action/)
  })

  it("throws duplicate-id for repeated plugin ids in the final set", () => {
    expect(() =>
      bootstrap({
        chatPanel: DummyChatPanel,
        defaults: [definePlugin({ id: "filesystem" })],
        plugins: [definePlugin({ id: "filesystem" })],
        registries: makeRegistries(),
      }),
    ).toThrow(PluginError)
  })

  it("is synchronous", () => {
    const result = bootstrap({
      chatPanel: DummyChatPanel,
      defaults: [],
      plugins: [definePlugin({ id: "host" })],
      registries: makeRegistries(),
    })
    expect(result).not.toBeInstanceOf(Promise)
  })
})
