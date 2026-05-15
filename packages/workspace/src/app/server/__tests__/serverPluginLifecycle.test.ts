import { describe, expect, test, vi } from "vitest"
import { ServerPluginLifecycleBus } from "../serverPluginLifecycle"

describe("Phase 4 — ServerPluginLifecycleBus", () => {
  test("hasHandlers returns false when nothing subscribed", () => {
    const bus = new ServerPluginLifecycleBus()
    expect(bus.hasHandlers("plugin_shutdown")).toBe(false)
    expect(bus.hasHandlers("plugin_start")).toBe(false)
  })

  test("emit fans out to subscribers in order", async () => {
    const bus = new ServerPluginLifecycleBus()
    const log: string[] = []
    bus.on("plugin_start", (e) => { log.push(`a:${e.pluginId}:${e.reason}`) })
    bus.on("plugin_start", (e) => { log.push(`b:${e.pluginId}:${e.reason}`) })

    await bus.emit({ type: "plugin_start", pluginId: "ask-user", reason: "reload" })
    expect(log).toEqual(["a:ask-user:reload", "b:ask-user:reload"])
  })

  test("handler errors are isolated — other handlers still run (Pi parity)", async () => {
    const bus = new ServerPluginLifecycleBus()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const okHandler = vi.fn()
    bus.on("plugin_shutdown", () => { throw new Error("boom") })
    bus.on("plugin_shutdown", okHandler)

    await bus.emit({ type: "plugin_shutdown", pluginId: "p1", reason: "reload" })
    expect(okHandler).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  test("unsubscribe stops further events", async () => {
    const bus = new ServerPluginLifecycleBus()
    const handler = vi.fn()
    const off = bus.on("plugin_start", handler)
    await bus.emit({ type: "plugin_start", pluginId: "p", reason: "startup" })
    off()
    await bus.emit({ type: "plugin_start", pluginId: "p", reason: "reload" })
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
