import { describe, expect, test, vi } from "vitest"
import { CommandRegistry } from "../CommandRegistry"
import { PanelRegistry } from "../PanelRegistry"

describe("CommandRegistry subscribe", () => {
  test("subscribe fires on registerCommand", () => {
    const reg = new CommandRegistry()
    const cb = vi.fn()
    reg.subscribe(cb)

    reg.registerCommand({ id: "cmd1", title: "Cmd", run: () => {} })

    expect(cb).toHaveBeenCalledTimes(1)
  })

  test("getSnapshot returns same reference when no mutations", () => {
    const reg = new CommandRegistry()
    reg.registerCommand({ id: "cmd1", title: "Cmd", run: () => {} })

    const snap1 = reg.getSnapshot()
    const snap2 = reg.getSnapshot()

    expect(snap1).toBe(snap2)
  })

  test("getSnapshot returns new reference after mutation", () => {
    const reg = new CommandRegistry()
    reg.registerCommand({ id: "cmd1", title: "Cmd", run: () => {} })
    const snap1 = reg.getSnapshot()

    reg.registerCommand({ id: "cmd2", title: "Cmd2", run: () => {} })
    const snap2 = reg.getSnapshot()

    expect(snap1).not.toBe(snap2)
    expect(snap2).toHaveLength(2)
  })

  test("unsubscribe stops notifications", () => {
    const reg = new CommandRegistry()
    const cb = vi.fn()
    const unsub = reg.subscribe(cb)

    reg.registerCommand({ id: "cmd1", title: "Cmd", run: () => {} })
    expect(cb).toHaveBeenCalledTimes(1)

    unsub()
    reg.registerCommand({ id: "cmd2", title: "Cmd2", run: () => {} })
    expect(cb).toHaveBeenCalledTimes(1)
  })

  test("unregisterByPluginId removes only matching commands", () => {
    const reg = new CommandRegistry()
    reg.registerCommand({ id: "a", title: "A", run: () => {}, pluginId: "p1" })
    reg.registerCommand({ id: "b", title: "B", run: () => {}, pluginId: "p2" })
    reg.registerCommand({ id: "c", title: "C", run: () => {} })

    reg.unregisterByPluginId("p1")

    expect(reg.getCommands().map((c) => c.id)).toEqual(["b", "c"])
  })

  test("unregisterByPluginId fires subscribe", () => {
    const reg = new CommandRegistry()
    reg.registerCommand({ id: "a", title: "A", run: () => {}, pluginId: "p1" })
    const cb = vi.fn()
    reg.subscribe(cb)

    reg.unregisterByPluginId("p1")
    expect(cb).toHaveBeenCalledTimes(1)
  })

  test("unregisterByPluginId does not fire when nothing removed", () => {
    const reg = new CommandRegistry()
    reg.registerCommand({ id: "a", title: "A", run: () => {} })
    const cb = vi.fn()
    reg.subscribe(cb)

    reg.unregisterByPluginId("nonexistent")
    expect(cb).not.toHaveBeenCalled()
  })
})

describe("PanelRegistry subscribe", () => {
  test("subscribe fires on register", () => {
    const reg = new PanelRegistry()
    const cb = vi.fn()
    reg.subscribe(cb)

    reg.register("panel1", { title: "P1", component: () => null as any })

    expect(cb).toHaveBeenCalledTimes(1)
  })

  test("getSnapshot returns same reference when no mutations", () => {
    const reg = new PanelRegistry()
    reg.register("panel1", { title: "P1", component: () => null as any })

    const snap1 = reg.getSnapshot()
    const snap2 = reg.getSnapshot()

    expect(snap1).toBe(snap2)
  })

  test("getSnapshot returns new reference after mutation", () => {
    const reg = new PanelRegistry()
    reg.register("panel1", { title: "P1", component: () => null as any })
    const snap1 = reg.getSnapshot()

    reg.register("panel2", { title: "P2", component: () => null as any })
    const snap2 = reg.getSnapshot()

    expect(snap1).not.toBe(snap2)
    expect(snap2).toHaveLength(2)
  })

})
