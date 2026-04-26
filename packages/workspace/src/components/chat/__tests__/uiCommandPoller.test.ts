import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { dispatchUiCommand, startUiCommandPoller, type DispatchContext } from "../uiCommandPoller"
import type { SurfaceShellApi, SurfaceShellSnapshot } from "../SurfaceShell"

function fakeSurface(): SurfaceShellApi & { __opened: string[]; __panels: unknown[] } {
  const opened: string[] = []
  const panels: unknown[] = []
  return {
    openFile: (path: string) => opened.push(path),
    openPanel: (cfg: unknown) => panels.push(cfg),
    getSnapshot: (): SurfaceShellSnapshot => ({ openTabs: [], activeTab: null }),
    __opened: opened,
    __panels: panels,
  }
}

function ctx(over: Partial<DispatchContext> = {}, surface = fakeSurface()): DispatchContext & { __surface: ReturnType<typeof fakeSurface> } {
  let workbenchOpen = true
  return {
    surface: () => surface,
    isWorkbenchOpen: () => workbenchOpen,
    openWorkbench: () => {
      workbenchOpen = true
    },
    ...over,
    __surface: surface,
  } as DispatchContext & { __surface: ReturnType<typeof fakeSurface> }
}

describe("dispatchUiCommand", () => {
  it("openFile calls surface.openFile with the path", () => {
    const c = ctx()
    dispatchUiCommand({ kind: "openFile", params: { path: "greeter.ts" } }, c)
    expect(c.__surface.__opened).toEqual(["greeter.ts"])
  })

  it("openFile is a no-op when path is missing or non-string", () => {
    const c = ctx()
    dispatchUiCommand({ kind: "openFile", params: {} }, c)
    dispatchUiCommand({ kind: "openFile", params: { path: 42 as unknown as string } }, c)
    expect(c.__surface.__opened).toEqual([])
  })

  it("openFile auto-opens the workbench when closed AND defers via RAF", async () => {
    let workbenchOpen = false
    const surface = fakeSurface()
    const ctxClosed: DispatchContext = {
      surface: () => surface,
      isWorkbenchOpen: () => workbenchOpen,
      openWorkbench: () => {
        workbenchOpen = true
      },
    }

    // Fake RAF — fire on demand inside the test.
    const rafQueue: FrameRequestCallback[] = []
    const originalRaf = global.requestAnimationFrame
    global.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafQueue.push(cb)
      return rafQueue.length
    }) as typeof requestAnimationFrame

    try {
      // workbench is closed before the call
      expect(workbenchOpen).toBe(false)
      dispatchUiCommand({ kind: "openFile", params: { path: "greeter.ts" } }, ctxClosed)
      // openWorkbench fired, BUT openFile is queued — surface should still be empty.
      expect(workbenchOpen).toBe(true)
      expect(surface.__opened).toEqual([])
      // Drain RAFs (need a double drain — the dispatcher uses RAF inside RAF
      // to give dockview a layout pass between mount and addPanel).
      const flushRaf = () => {
        const queue = rafQueue.splice(0)
        for (const cb of queue) cb(0)
      }
      flushRaf()
      flushRaf()
      expect(surface.__opened).toEqual(["greeter.ts"])
    } finally {
      global.requestAnimationFrame = originalRaf
    }
  })

  it("openPanel calls surface.openPanel with the full config", () => {
    const c = ctx()
    dispatchUiCommand(
      {
        kind: "openPanel",
        params: {
          id: "logs",
          component: "log-viewer",
          title: "Logs",
          params: { source: "agent" },
        },
      },
      c,
    )
    expect(c.__surface.__panels).toEqual([
      { id: "logs", component: "log-viewer", title: "Logs", params: { source: "agent" } },
    ])
  })

  it("openPanel requires both id and component", () => {
    const c = ctx()
    dispatchUiCommand({ kind: "openPanel", params: { id: "logs" } }, c)
    dispatchUiCommand({ kind: "openPanel", params: { component: "log-viewer" } }, c)
    expect(c.__surface.__panels).toEqual([])
  })

  it("unknown kinds are silently ignored — no surface call, no throw", () => {
    const c = ctx()
    expect(() =>
      dispatchUiCommand({ kind: "explodeWorkbench", params: {} }, c),
    ).not.toThrow()
    expect(c.__surface.__opened).toEqual([])
    expect(c.__surface.__panels).toEqual([])
  })

  it("known kinds without a handler (navigateToLine, showNotification) are accepted-but-no-op", () => {
    const c = ctx()
    expect(() =>
      dispatchUiCommand({ kind: "navigateToLine", params: { file: "x.ts", line: 5 } }, c),
    ).not.toThrow()
    expect(() =>
      dispatchUiCommand({ kind: "showNotification", params: { msg: "hi" } }, c),
    ).not.toThrow()
    expect(c.__surface.__opened).toEqual([])
  })

  it("does nothing when surface is null (frontend mounted, dockview not ready yet)", () => {
    const c: DispatchContext = {
      surface: () => null,
      isWorkbenchOpen: () => true,
      openWorkbench: () => {},
    }
    expect(() => dispatchUiCommand({ kind: "openFile", params: { path: "x.ts" } }, c)).not.toThrow()
  })
})

describe("startUiCommandPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function makeFetcher(batches: Array<unknown[]>) {
    let i = 0
    return vi.fn(async () => {
      const batch = batches[i] ?? []
      i++
      return new Response(JSON.stringify(batch), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })
  }

  it("fetches /api/v1/ui/commands/next?poll=true on the configured interval", async () => {
    const fetcher = makeFetcher([[], []])
    const stop = startUiCommandPoller({
      intervalMs: 100,
      fetcher: fetcher as unknown as typeof fetch,
      ctx: ctx(),
    })

    // Let the first tick resolve.
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const firstCallArgs = fetcher.mock.calls[0] as unknown as [string, ...unknown[]] | undefined
    expect(firstCallArgs?.[0]).toBe("/api/v1/ui/commands/next?poll=true")

    // Advance past the interval — should fire again.
    await vi.advanceTimersByTimeAsync(150)
    expect(fetcher).toHaveBeenCalledTimes(2)

    stop()
  })

  it("dispatches commands returned by the poll", async () => {
    const surface = fakeSurface()
    const dispatchCtx: DispatchContext = {
      surface: () => surface,
      isWorkbenchOpen: () => true,
      openWorkbench: () => {},
    }
    const fetcher = makeFetcher([
      [
        { kind: "openFile", params: { path: "greeter.ts" }, seq: 1 },
        { kind: "openPanel", params: { id: "logs", component: "log-viewer" }, seq: 2 },
      ],
    ])

    const stop = startUiCommandPoller({
      intervalMs: 100,
      fetcher: fetcher as unknown as typeof fetch,
      ctx: dispatchCtx,
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(surface.__opened).toEqual(["greeter.ts"])
    expect(surface.__panels).toHaveLength(1)
    expect((surface.__panels[0] as { id: string }).id).toBe("logs")

    stop()
  })

  it("stop() prevents subsequent polls and aborts the in-flight request", async () => {
    const fetcher = makeFetcher([[], [], []])
    const stop = startUiCommandPoller({
      intervalMs: 100,
      fetcher: fetcher as unknown as typeof fetch,
      ctx: ctx(),
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).toHaveBeenCalledTimes(1)
    stop()
    await vi.advanceTimersByTimeAsync(500)
    // No further calls after stop().
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("recovers from a network error (continues polling on the next tick)", async () => {
    const surface = fakeSurface()
    const dispatchCtx: DispatchContext = {
      surface: () => surface,
      isWorkbenchOpen: () => true,
      openWorkbench: () => {},
    }
    let calls = 0
    const fetcher = vi.fn(async () => {
      calls++
      if (calls === 1) throw new Error("network down")
      return new Response(JSON.stringify([{ kind: "openFile", params: { path: "x.ts" } }]), {
        status: 200,
      })
    })

    const stop = startUiCommandPoller({
      intervalMs: 100,
      fetcher: fetcher as unknown as typeof fetch,
      ctx: dispatchCtx,
    })
    await vi.advanceTimersByTimeAsync(0) // first tick — throws
    await vi.advanceTimersByTimeAsync(150) // second tick — succeeds
    expect(surface.__opened).toEqual(["x.ts"])
    stop()
  })
})
