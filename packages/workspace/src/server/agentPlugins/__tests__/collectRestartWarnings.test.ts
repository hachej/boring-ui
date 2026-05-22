import { describe, expect, test } from "vitest"
import { collectRestartWarnings } from "../routes"
import type { BoringPluginEvent } from "../types"

describe("collectRestartWarnings", () => {
  test("returns empty for no events", () => {
    expect(collectRestartWarnings([])).toEqual([])
  })

  test("ignores unload and error events", () => {
    const events: BoringPluginEvent[] = [
      { type: "boring.plugin.unload", id: "foo", revision: 1 },
      { type: "boring.plugin.error", id: "bar", revision: 2, message: "boom" },
    ]
    expect(collectRestartWarnings(events)).toEqual([])
  })

  test("extracts warnings from load events with requiresRestart", () => {
    const events: BoringPluginEvent[] = [
      {
        type: "boring.plugin.load",
        id: "my-plugin",
        boring: { front: "front/index.tsx" },
        version: "1.0.0",
        revision: 1,
        requiresRestart: ["routes", "agentTools"],
      },
    ]
    const warnings = collectRestartWarnings(events)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].id).toBe("my-plugin")
    expect(warnings[0].surfaces).toEqual(["routes", "agentTools"])
    expect(warnings[0].message).toContain("my-plugin reloaded")
    expect(warnings[0].message).toContain("routes + agentTools")
  })

  test("skips load events without requiresRestart", () => {
    const events: BoringPluginEvent[] = [
      {
        type: "boring.plugin.load",
        id: "quiet-plugin",
        boring: { front: "front/index.tsx" },
        version: "1.0.0",
        revision: 1,
      },
    ]
    expect(collectRestartWarnings(events)).toEqual([])
  })

  test("skips load events with empty requiresRestart", () => {
    const events: BoringPluginEvent[] = [
      {
        type: "boring.plugin.load",
        id: "quiet-plugin",
        boring: { front: "front/index.tsx" },
        version: "1.0.0",
        revision: 1,
        requiresRestart: [],
      },
    ]
    expect(collectRestartWarnings(events)).toEqual([])
  })

  test("handles mixed events correctly", () => {
    const events: BoringPluginEvent[] = [
      { type: "boring.plugin.load", id: "good", boring: { front: "f" }, version: "1", revision: 1 },
      { type: "boring.plugin.unload", id: "gone", revision: 1 },
      {
        type: "boring.plugin.load",
        id: "stale",
        boring: { front: "f" },
        version: "1",
        revision: 2,
        requiresRestart: ["agentTools"],
      },
      { type: "boring.plugin.error", id: "broken", revision: 1, message: "fail" },
    ]
    const warnings = collectRestartWarnings(events)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].id).toBe("stale")
  })
})
