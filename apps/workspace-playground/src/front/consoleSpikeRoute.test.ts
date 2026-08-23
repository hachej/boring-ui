import { describe, expect, it } from "vitest"
import { isConsoleSpikeRoute } from "./consoleSpikeRoute"

describe("workspace-playground console spike route", () => {
  it("enables the spike only for consoleSpike=1", () => {
    expect(isConsoleSpikeRoute("?consoleSpike=1")).toBe(true)
    expect(isConsoleSpikeRoute("?consoleSpike=0")).toBe(false)
    expect(isConsoleSpikeRoute("?showcase=1")).toBe(false)
    expect(isConsoleSpikeRoute("")).toBe(false)
  })
})
