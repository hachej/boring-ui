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
    expect(captured.registrations.panels[0]?.id).toBe("deck")
    expect(captured.registrations.surfaceResolvers).toHaveLength(1)
  })
})
