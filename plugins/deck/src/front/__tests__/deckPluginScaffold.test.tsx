import { describe, expect, it } from "vitest"
import {
  bootstrap,
  CatalogRegistry,
  CommandRegistry,
  PanelRegistry,
  SurfaceResolverRegistry,
} from "@hachej/boring-workspace"
import { captureFrontPlugin } from "@hachej/boring-workspace/plugin"
import deckPlugin, { createDeckPlugin } from "../index"

const DummyChatPanel = () => null

function makeRegistries() {
  return {
    panels: new PanelRegistry(),
    commands: new CommandRegistry(),
    catalogs: new CatalogRegistry({ warnOnDuplicate: false }),
    surfaceResolvers: new SurfaceResolverRegistry(),
  }
}

describe("deck scaffold", () => {
  it("exports a default front plugin factory", () => {
    expect(deckPlugin.pluginId).toBe("deck")
  })

  it("captures the default provider, panel, and resolver scaffold", () => {
    const captured = captureFrontPlugin(createDeckPlugin())
    expect(captured.id).toBe("deck")
    expect(captured.registrations.providers).toHaveLength(1)
    expect(captured.registrations.providers[0]?.id).toBe("deck-files")
    expect(captured.registrations.panels).toHaveLength(1)
    expect(captured.registrations.panels[0]).toEqual(
      expect.objectContaining({ id: "deck", label: "Deck", placement: "center", source: "app" }),
    )
    expect(captured.registrations.surfaceResolvers).toHaveLength(1)
    expect(captured.registrations.surfaceResolvers[0]).toEqual(
      expect.objectContaining({ id: "deck.open-path", kind: "workspace.open.path", source: "app" }),
    )
  })

  it("normalizes Windows-style pathPrefix values before matching deck markdown", () => {
    const captured = captureFrontPlugin(createDeckPlugin({ pathPrefix: "briefings\\" }))
    const resolver = captured.registrations.surfaceResolvers[0]
    if (!resolver) throw new Error("expected deck resolver")

    expect(resolver.resolve({ kind: "workspace.open.path", target: "briefings/intro.md" })).toEqual(
      expect.objectContaining({
        component: "deck",
        title: "intro.md",
        params: { path: "briefings/intro.md" },
      }),
    )
  })

  it("ignores non-markdown and out-of-prefix requests", () => {
    const captured = captureFrontPlugin(createDeckPlugin({ pathPrefix: "slides" }))
    const resolver = captured.registrations.surfaceResolvers[0]
    if (!resolver) throw new Error("expected deck resolver")

    expect(resolver.resolve({ kind: "workspace.open.path", target: "deck/intro.md" })).toBeNull()
    expect(resolver.resolve({ kind: "workspace.open.path", target: "slides/intro.txt" })).toBeNull()
    expect(resolver.resolve({ kind: "other.kind", target: "slides/intro.md" })).toBeNull()
  })

  it("registers through workspace bootstrap and resolves workspace.open.path via the live registry", () => {
    const registries = makeRegistries()

    bootstrap({
      chatPanel: DummyChatPanel,
      defaults: [],
      plugins: [createDeckPlugin({ pathPrefix: "briefings\\" })],
      registries,
    })

    expect(registries.panels.get("deck")).toEqual(
      expect.objectContaining({ id: "deck", title: "Deck", pluginId: "deck" }),
    )

    expect(
      registries.surfaceResolvers.resolve({ kind: "workspace.open.path", target: "briefings/weekly.md" }),
    ).toEqual(
      expect.objectContaining({
        component: "deck",
        title: "weekly.md",
        params: { path: "briefings/weekly.md" },
      }),
    )
    expect(
      registries.surfaceResolvers.resolve({ kind: "workspace.open.path", target: "deck/weekly.md" }),
    ).toBeUndefined()
  })
})
