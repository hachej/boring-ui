import { describe, it, expect, vi, beforeEach } from "vitest"
import { createEventBus } from "../bus"

interface TestMap {
  "a:hello": { name: string }
  "a:bye": { name: string }
}

describe("createEventBus", () => {
  let bus: ReturnType<typeof createEventBus<TestMap>>

  beforeEach(() => {
    bus = createEventBus<TestMap>()
  })

  it("delivers payloads to subscribers in registration order", () => {
    const calls: string[] = []
    bus.on("a:hello", (p) => calls.push(`one:${p.name}`))
    bus.on("a:hello", (p) => calls.push(`two:${p.name}`))
    bus.emit("a:hello", { name: "x" })
    expect(calls).toEqual(["one:x", "two:x"])
  })

  it("on() returns an unsubscribe function", () => {
    const fn = vi.fn()
    const unsub = bus.on("a:hello", fn)
    bus.emit("a:hello", { name: "first" })
    unsub()
    bus.emit("a:hello", { name: "second" })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("emit with no listeners is a no-op", () => {
    expect(() => bus.emit("a:hello", { name: "x" })).not.toThrow()
  })

  it("named listeners only fire for their own event name", () => {
    const helloFn = vi.fn()
    const byeFn = vi.fn()
    bus.on("a:hello", helloFn)
    bus.on("a:bye", byeFn)
    bus.emit("a:hello", { name: "x" })
    expect(helloFn).toHaveBeenCalledTimes(1)
    expect(byeFn).not.toHaveBeenCalled()
  })

  it("subscribe during dispatch — new sub fires on the NEXT emit only", () => {
    const calls: string[] = []
    const late = vi.fn()
    bus.on("a:hello", () => {
      calls.push("first")
      bus.on("a:hello", late)
    })
    bus.emit("a:hello", { name: "x" })
    expect(late).not.toHaveBeenCalled()
    bus.emit("a:hello", { name: "y" })
    expect(late).toHaveBeenCalledTimes(1)
  })

  it("unsubscribe during dispatch — snapshotted listeners still complete this round", () => {
    const calls: string[] = []
    let unsubB: () => void = () => {}
    bus.on("a:hello", () => {
      calls.push("a")
      unsubB()
    })
    unsubB = bus.on("a:hello", () => calls.push("b"))
    bus.on("a:hello", () => calls.push("c"))
    bus.emit("a:hello", { name: "x" })
    // 'b' was unsubscribed by 'a' mid-dispatch but the snapshot was
    // already taken — fires this round, gone next.
    expect(calls).toEqual(["a", "b", "c"])
    bus.emit("a:hello", { name: "y" })
    expect(calls).toEqual(["a", "b", "c", "a", "c"])
  })

  it("a thrown listener doesn't stop the chain", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const fn = vi.fn()
    bus.on("a:hello", () => {
      throw new Error("boom")
    })
    bus.on("a:hello", fn)
    bus.emit("a:hello", { name: "x" })
    expect(fn).toHaveBeenCalledWith({ name: "x" })
    errSpy.mockRestore()
  })

  it("no replay — emit before subscribe never backfills", () => {
    bus.emit("a:hello", { name: "lost" })
    const fn = vi.fn()
    bus.on("a:hello", fn)
    expect(fn).not.toHaveBeenCalled()
    bus.emit("a:hello", { name: "received" })
    expect(fn).toHaveBeenCalledWith({ name: "received" })
  })

  it("_reset() wipes every subscriber", () => {
    const fn = vi.fn()
    bus.on("a:hello", fn)
    bus._reset()
    bus.emit("a:hello", { name: "x" })
    expect(fn).not.toHaveBeenCalled()
  })

  it("emit is synchronous", async () => {
    const order: string[] = []
    bus.on("a:hello", () => order.push("listener"))
    bus.emit("a:hello", { name: "x" })
    order.push("after-emit")
    await Promise.resolve()
    expect(order).toEqual(["listener", "after-emit"])
  })
})
