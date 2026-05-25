import { describe, expect, it } from "vitest"
import { captureFrontPlugin } from "@hachej/boring-workspace/plugin"
import deckPlugin, { createDeckPlugin } from "../index"

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

  it("resolves workspace.open.path deck markdown requests to the deck panel", () => {
    const captured = captureFrontPlugin(createDeckPlugin())
    const resolver = captured.registrations.surfaceResolvers[0]
    if (!resolver) throw new Error("expected deck resolver")

    expect(resolver.resolve({ kind: "workspace.open.path", target: "deck/intro.md" })).toEqual(
      expect.objectContaining({
        component: "deck",
        title: "intro.md",
        params: { path: "deck/intro.md" },
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
})
