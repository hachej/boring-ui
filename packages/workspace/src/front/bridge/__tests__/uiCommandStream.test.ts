import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { startUiCommandStream, type DispatchContext } from "../uiCommandStream"
import type { SurfaceShellApi, SurfaceShellSnapshot } from "../../chrome/artifact-surface/SurfaceShell"

function fakeSurface(): SurfaceShellApi & {
  __opened: string[]
  __surfaces: unknown[]
  __panels: unknown[]
  __expanded: string[]
  __leftClosed: number
} {
  const opened: string[] = []
  const surfaces: unknown[] = []
  const panels: unknown[] = []
  const expanded: string[] = []
  const surface: SurfaceShellApi & {
    __opened: string[]
    __surfaces: unknown[]
    __panels: unknown[]
    __expanded: string[]
    __leftClosed: number
  } = {
    openFile: (p: string) => opened.push(p),
    openSurface: (request: unknown) => surfaces.push(request),
    openPanel: (cfg: unknown) => panels.push(cfg),
    expandToFile: (path: string) => expanded.push(path),
    closeWorkbenchLeftPane: () => {
      surface.__leftClosed += 1
    },
    getSnapshot: (): SurfaceShellSnapshot => ({ openTabs: [], activeTab: null }),
    __opened: opened,
    __surfaces: surfaces,
    __panels: panels,
    __expanded: expanded,
    __leftClosed: 0,
  }
  return surface
}

function dispatchCtx(surface = fakeSurface()): DispatchContext & {
  __surface: ReturnType<typeof fakeSurface>
} {
  return {
    surface: () => surface,
    isWorkbenchOpen: () => true,
    openWorkbench: () => {},
    __surface: surface,
  } as DispatchContext & { __surface: ReturnType<typeof fakeSurface> }
}

// -------- minimal EventSource mock --------
//
// Mirrors only the surface that uiCommandStream.ts uses: addEventListener,
// close. Tests grab the instance and fire events at it manually so we can
// drive `command` / `init` / `error` deterministically without a real
// network.

interface MockEventSource extends EventSource {
  __url: string
  __closed: boolean
  __emit: (type: string, data?: string) => void
}

function makeEventSourceCtor() {
  const instances: MockEventSource[] = []
  const ctor = vi.fn(function MockES(url: string) {
    const handlers: Record<string, Array<(ev: { data?: string }) => void>> = {}
    const inst = {
      __url: url,
      __closed: false,
      addEventListener(type: string, listener: (ev: { data?: string }) => void) {
        const list = handlers[type] ?? (handlers[type] = [])
        list.push(listener)
      },
      close() {
        inst.__closed = true
      },
      __emit(type: string, data?: string) {
        for (const fn of handlers[type] ?? []) fn({ data })
      },
    } as unknown as MockEventSource
    instances.push(inst)
    return inst
  }) as unknown as typeof EventSource
  return { ctor, instances }
}

describe("startUiCommandStream — SSE path", () => {
  it("opens an EventSource against /api/v1/ui/commands/next", () => {
    const { ctor, instances } = makeEventSourceCtor()
    const stop = startUiCommandStream({
      ctx: dispatchCtx(),
      eventSourceCtor: ctor,
    })
    expect(ctor).toHaveBeenCalledTimes(1)
    expect(instances[0]?.__url).toBe("/api/v1/ui/commands/next")
    stop()
  })

  it("appends query params to the EventSource URL", () => {
    const { ctor, instances } = makeEventSourceCtor()
    const stop = startUiCommandStream({
      ctx: dispatchCtx(),
      eventSourceCtor: ctor,
      query: { workspaceId: "w1" },
    })
    expect(instances[0]?.__url).toBe("/api/v1/ui/commands/next?workspaceId=w1")
    stop()
  })

  it("dispatches commands received as `command` events", () => {
    const { ctor, instances } = makeEventSourceCtor()
    const ctx = dispatchCtx()
    const stop = startUiCommandStream({ ctx, eventSourceCtor: ctor })
    const es = instances[0]!

    es.__emit("command", JSON.stringify({ kind: "openFile", params: { path: "greeter.ts" }, seq: 1 }))
    es.__emit("command", JSON.stringify({ kind: "openPanel", params: { id: "logs", component: "log-viewer" } }))
    es.__emit("command", JSON.stringify({ kind: "closeWorkbenchLeftPane", params: {} }))

    expect(ctx.__surface.__opened).toEqual(["greeter.ts"])
    expect(ctx.__surface.__panels).toHaveLength(1)
    expect(ctx.__surface.__leftClosed).toBe(1)
    stop()
  })

  it("ignores malformed JSON payloads instead of throwing", () => {
    const { ctor, instances } = makeEventSourceCtor()
    const ctx = dispatchCtx()
    const stop = startUiCommandStream({ ctx, eventSourceCtor: ctor })
    const es = instances[0]!
    expect(() => es.__emit("command", "not-json")).not.toThrow()
    expect(ctx.__surface.__opened).toEqual([])
    stop()
  })

  it("ignores command events with no data or non-string data (no JSON.parse on '')", () => {
    const { ctor, instances } = makeEventSourceCtor()
    const ctx = dispatchCtx()
    const stop = startUiCommandStream({ ctx, eventSourceCtor: ctor })
    const es = instances[0]!
    // No data at all
    expect(() => es.__emit("command")).not.toThrow()
    // Empty string (the previous JSON.parse(typeof data === 'string' ? data : '')
    // hack would have thrown SyntaxError here and silently caught it; the
    // explicit guard makes the no-op visible AND safe).
    expect(() => es.__emit("command", "")).not.toThrow()
    expect(ctx.__surface.__opened).toEqual([])
    stop()
  })

  it("closes the EventSource on cleanup", () => {
    const { ctor, instances } = makeEventSourceCtor()
    const stop = startUiCommandStream({ ctx: dispatchCtx(), eventSourceCtor: ctor })
    expect(instances[0]?.__closed).toBe(false)
    stop()
    expect(instances[0]?.__closed).toBe(true)
  })
})

describe("startUiCommandStream — reconnect + fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("reconnects with linear backoff on error, up to maxReconnects", () => {
    const { ctor, instances } = makeEventSourceCtor()
    const stop = startUiCommandStream({
      ctx: dispatchCtx(),
      eventSourceCtor: ctor,
      maxReconnects: 3,
      reconnectDelayMs: 100,
    })
    // Initial connect
    expect(ctor).toHaveBeenCalledTimes(1)
    // First error → schedules a reconnect after 100ms (delay * attempt 1)
    instances[0]!.__emit("error")
    vi.advanceTimersByTime(100)
    expect(ctor).toHaveBeenCalledTimes(2)
    // Second error → 200ms backoff
    instances[1]!.__emit("error")
    vi.advanceTimersByTime(200)
    expect(ctor).toHaveBeenCalledTimes(3)
    stop()
  })

  it("falls back to polling once maxReconnects is exhausted", async () => {
    const { ctor, instances } = makeEventSourceCtor()
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify([{ kind: "openFile", params: { path: "x.ts" } }]), {
        status: 200,
      }),
    )
    const ctx = dispatchCtx()
    const stop = startUiCommandStream({
      ctx,
      eventSourceCtor: ctor,
      fetcher: fetcher as unknown as typeof fetch,
      maxReconnects: 1,
      reconnectDelayMs: 50,
      pollIntervalMs: 100,
    })
    // First connect → error → reconnect attempt 1 (within budget) →
    // second connect → error → exceeds maxReconnects → poll fallback.
    instances[0]!.__emit("error")
    vi.advanceTimersByTime(50)
    expect(ctor).toHaveBeenCalledTimes(2)
    instances[1]!.__emit("error")
    // Polling fallback kicks off immediately.
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).toHaveBeenCalled()
    const firstCallArgs = fetcher.mock.calls[0] as unknown as [string, ...unknown[]] | undefined
    expect(firstCallArgs?.[0]).toBe("/api/v1/ui/commands/next?poll=true")
    await vi.advanceTimersByTimeAsync(10)
    expect(ctx.__surface.__opened).toEqual(["x.ts"])
    stop()
  })

  it("appends query params to polling URLs", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }))
    const stop = startUiCommandStream({
      ctx: dispatchCtx(),
      eventSourceCtor: null,
      fetcher: fetcher as unknown as typeof fetch,
      pollIntervalMs: 100,
      query: { workspaceId: "w1" },
    })
    await vi.advanceTimersByTimeAsync(0)
    const firstCallArgs = fetcher.mock.calls[0] as unknown as [string, ...unknown[]] | undefined
    expect(firstCallArgs?.[0]).toBe("/api/v1/ui/commands/next?poll=true&workspaceId=w1")
    stop()
  })

  it("uses polling immediately when EventSource is forced off (eventSourceCtor: null)", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify([{ kind: "openFile", params: { path: "x.ts" } }]), {
        status: 200,
      }),
    )
    const ctx = dispatchCtx()
    const stop = startUiCommandStream({
      ctx,
      eventSourceCtor: null,
      fetcher: fetcher as unknown as typeof fetch,
      pollIntervalMs: 100,
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(ctx.__surface.__opened).toEqual(["x.ts"])
    stop()
  })

  it("if cancelled fires while a reconnect timer is pending, the timer is a no-op (does NOT fall through to polling)", () => {
    const { ctor, instances } = makeEventSourceCtor()
    const fetcher = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }))
    const stop = startUiCommandStream({
      ctx: dispatchCtx(),
      eventSourceCtor: ctor,
      fetcher: fetcher as unknown as typeof fetch,
      maxReconnects: 5,
      reconnectDelayMs: 100,
    })
    // First connect → error → reconnect timer scheduled.
    instances[0]!.__emit("error")
    expect(ctor).toHaveBeenCalledTimes(1)
    // Cleanup BEFORE the reconnect fires.
    stop()
    // Advance past the scheduled reconnect — the timer fires but openSse
    // hits `if (cancelled) return` and exits without opening a new ES
    // OR routing to the polling fallback.
    vi.advanceTimersByTime(500)
    expect(ctor).toHaveBeenCalledTimes(1)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("polling stop() prevents further polls and aborts in-flight", async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify([]), { status: 200 }),
    )
    const stop = startUiCommandStream({
      ctx: dispatchCtx(),
      eventSourceCtor: null,
      fetcher: fetcher as unknown as typeof fetch,
      pollIntervalMs: 50,
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).toHaveBeenCalledTimes(1)
    stop()
    await vi.advanceTimersByTimeAsync(500)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("`init` event resets the reconnect counter so a later hiccup gets full budget", () => {
    const { ctor, instances } = makeEventSourceCtor()
    const stop = startUiCommandStream({
      ctx: dispatchCtx(),
      eventSourceCtor: ctor,
      maxReconnects: 2,
      reconnectDelayMs: 10,
    })
    // Two errors before init → reconnect budget would be at 2.
    instances[0]!.__emit("error")
    vi.advanceTimersByTime(10)
    instances[1]!.__emit("error")
    vi.advanceTimersByTime(20) // 10ms * attempt 2
    expect(ctor).toHaveBeenCalledTimes(3)
    // The connection signals init — counter resets.
    instances[2]!.__emit("init", JSON.stringify({ v: 1 }))
    // Now another two errors should still be within budget (counter back to 0).
    instances[2]!.__emit("error")
    vi.advanceTimersByTime(10)
    instances[3]!.__emit("error")
    vi.advanceTimersByTime(20)
    expect(ctor).toHaveBeenCalledTimes(5)
    stop()
  })
})
