import { describe, expect, test, vi } from "vitest"
import { LifecycleBus } from "../../../shared/plugins/lifecycleBus"

describe("Phase 3 — LifecycleBus", () => {
  test("hasHandlers returns false when no subscribers", () => {
    const bus = new LifecycleBus()
    expect(bus.hasHandlers("plugin_shutdown")).toBe(false)
    expect(bus.hasHandlers("plugin_start")).toBe(false)
  })

  test("emit fans out to all subscribers in order", async () => {
    const bus = new LifecycleBus()
    const log: string[] = []
    bus.on("plugin_start", (e) => { log.push(`a:${e.pluginId}:${e.reason}`) })
    bus.on("plugin_start", (e) => { log.push(`b:${e.pluginId}:${e.reason}`) })

    await bus.emit({ type: "plugin_start", pluginId: "ask-user", reason: "reload" })
    expect(log).toEqual(["a:ask-user:reload", "b:ask-user:reload"])
  })

  test("hasHandlers reflects subscribe/unsubscribe", () => {
    const bus = new LifecycleBus()
    const off = bus.on("plugin_shutdown", () => {})
    expect(bus.hasHandlers("plugin_shutdown")).toBe(true)
    off()
    expect(bus.hasHandlers("plugin_shutdown")).toBe(false)
  })

  test("handler errors are isolated — other handlers still run (Pi parity)", async () => {
    const bus = new LifecycleBus()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const okHandler = vi.fn()
    bus.on("plugin_shutdown", () => { throw new Error("boom") })
    bus.on("plugin_shutdown", okHandler)

    await bus.emit({ type: "plugin_shutdown", pluginId: "p1", reason: "reload" })
    expect(okHandler).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  test("subscriber that unsubscribes during emit doesn't break iteration", async () => {
    const bus = new LifecycleBus()
    const log: string[] = []
    const offB = bus.on("plugin_start", () => { log.push("a"); offB() })
    bus.on("plugin_start", () => { log.push("b") })

    await bus.emit({ type: "plugin_start", pluginId: "p", reason: "startup" })
    expect(log).toEqual(["a", "b"])
  })
})
