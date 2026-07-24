import { describe, it, expect, vi } from "vitest"
import { dispatchUiCommand, WORKSPACE_SURFACE_OPEN_SKIPPED_EVENT, type DispatchContext } from "../uiCommandDispatcher"
import { SurfaceUnavailableError, type SurfaceShellApi, type SurfaceShellSnapshot } from "../../chrome/artifact-surface/SurfaceShell"

function fakeSurface(): SurfaceShellApi & {
  __opened: string[]
  __surfaces: unknown[]
  __panels: unknown[]
  __expanded: string[]
  __leftClosed: number
  __openFileCalls: Array<{ path: string; filesystem?: string }>
} {
  const opened: string[] = []
  const openFileCalls: Array<{ path: string; filesystem?: string }> = []
  const surfaces: unknown[] = []
  const panels: unknown[] = []
  const expanded: string[] = []
  const surface: SurfaceShellApi & {
    __opened: string[]
    __surfaces: unknown[]
    __panels: unknown[]
    __expanded: string[]
    __leftClosed: number
    __openFileCalls: Array<{ path: string; filesystem?: string }>
  } = {
    openFile: (path: string, options?: { filesystem?: string }) => {
      opened.push(path)
      openFileCalls.push({ path, filesystem: options?.filesystem })
    },
    openSurface: (request: unknown) => surfaces.push(request),
    openPanel: (cfg: unknown) => panels.push(cfg),
    expandToFile: (path: string) => expanded.push(path),
    closeWorkbenchLeftPane: () => {
      surface.__leftClosed += 1
    },
    getSnapshot: (): SurfaceShellSnapshot => ({ openTabs: [], activeTab: null }),
    __opened: opened,
    __openFileCalls: openFileCalls,
    __surfaces: surfaces,
    __panels: panels,
    __expanded: expanded,
    __leftClosed: 0,
  }
  return surface
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
  it("openFile calls surface.openFile with the path and legacy user filesystem", () => {
    const c = ctx()
    dispatchUiCommand({ kind: "openFile", params: { path: "greeter.ts" } }, c)
    expect(c.__surface.__opened).toEqual(["greeter.ts"])
    expect(c.__surface.__openFileCalls).toEqual([{ path: "greeter.ts", filesystem: "user" }])
  })

  it("retires a dead surface and replays the file open after recovery", () => {
    const stale = fakeSurface()
    vi.spyOn(stale, "openFile").mockImplementation(() => { throw new SurfaceUnavailableError() })
    const queued: Array<(surface: SurfaceShellApi) => void> = []
    const recoverSurface = vi.fn()
    const c = ctx({ recoverSurface, enqueue: (run) => queued.push(run) }, stale)

    dispatchUiCommand({ kind: "openFile", params: { path: "README.md" } }, c)

    expect(recoverSurface).toHaveBeenCalledWith(stale)
    expect(queued).toHaveLength(1)
    const replacement = fakeSurface()
    queued[0]!(replacement)
    expect(replacement.__opened).toEqual(["README.md"])
  })

  it("caps dead-surface recovery at one remount for a persistently failing operation", () => {
    const dead = () => {
      const surface = fakeSurface()
      vi.spyOn(surface, "openSurface").mockImplementation(() => { throw new SurfaceUnavailableError() })
      return surface
    }
    const queued: Array<(surface: SurfaceShellApi) => void> = []
    const recoverSurface = vi.fn()
    const first = dead()
    const c = ctx({ recoverSurface, enqueue: (run) => queued.push(run) }, first)

    dispatchUiCommand({ kind: "openSurface", params: { kind: "questions", target: "q1" } }, c)
    expect(queued).toHaveLength(1)
    queued.shift()!(dead())

    expect(recoverSurface).toHaveBeenCalledTimes(1)
    expect(queued).toHaveLength(0)
  })

  it("openFile forwards explicit company_context filesystem", () => {
    const c = ctx()
    dispatchUiCommand({ kind: "openFile", params: { path: "/company/hr/policy.md", filesystem: "company_context" } }, c)
    expect(c.__surface.__openFileCalls).toEqual([{ path: "/company/hr/policy.md", filesystem: "company_context" }])
  })

  it("openFile is a no-op when path is missing or non-string", () => {
    const c = ctx()
    dispatchUiCommand({ kind: "openFile", params: {} }, c)
    dispatchUiCommand({ kind: "openFile", params: { path: 42 as unknown as string } }, c)
    expect(c.__surface.__opened).toEqual([])
  })

  it("openFile catches surface errors so dispatch stays alive", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const surface = fakeSurface()
    surface.openFile = () => {
      throw new Error("invalid path")
    }
    const c = ctx({}, surface)

    expect(() =>
      dispatchUiCommand({ kind: "openFile", params: { path: "../secret.txt" } }, c),
    ).not.toThrow()
    expect(warn).toHaveBeenCalledWith(
      "[uiCommandDispatcher] openFile dispatch failed:",
      "invalid path",
    )
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

  it("openSurface calls surface.openSurface with the generic target", () => {
    const c = ctx()
    dispatchUiCommand(
      {
        kind: "openSurface",
        params: {
          kind: "data-catalog.open-row",
          target: "orders_daily",
          meta: { catalogId: "metrics" },
        },
      },
      c,
    )
    expect(c.__surface.__surfaces).toEqual([
      {
        kind: "data-catalog.open-row",
        target: "orders_daily",
        filesystem: "user",
        meta: { catalogId: "metrics" },
      },
    ])
  })

  it("openSurface forwards explicit filesystem for path surfaces", () => {
    const c = ctx()
    dispatchUiCommand(
      {
        kind: "openSurface",
        params: {
          kind: "workspace.open.path",
          target: "/company/hr/policy.md",
          filesystem: "company_context",
        },
      },
      c,
    )
    expect(c.__surface.__surfaces).toEqual([
      {
        kind: "workspace.open.path",
        target: "/company/hr/policy.md",
        filesystem: "company_context",
        meta: undefined,
      },
    ])
  })

  it("skips openSurface when the host policy rejects it and notifies listeners", () => {
    const openWorkbench = vi.fn()
    const skipped = vi.fn()
    window.addEventListener(WORKSPACE_SURFACE_OPEN_SKIPPED_EVENT, skipped)
    const c = ctx({ openWorkbench, shouldOpenSurface: () => false })
    try {
      dispatchUiCommand({ kind: "openSurface", params: { kind: "questions", target: "q1", meta: { openOnlyWhenSessionOpen: true } } }, c)
    } finally {
      window.removeEventListener(WORKSPACE_SURFACE_OPEN_SKIPPED_EVENT, skipped)
    }
    expect(c.__surface.__surfaces).toEqual([])
    expect(openWorkbench).not.toHaveBeenCalled()
    expect(skipped).toHaveBeenCalledWith(expect.objectContaining({ detail: { kind: "questions", target: "q1", filesystem: "user", meta: { openOnlyWhenSessionOpen: true } } }))
  })

  it("skips session-gated openSurface when no host policy is available", () => {
    const openWorkbench = vi.fn()
    const skipped = vi.fn()
    window.addEventListener(WORKSPACE_SURFACE_OPEN_SKIPPED_EVENT, skipped)
    const c = ctx({ openWorkbench })
    try {
      dispatchUiCommand({ kind: "openSurface", params: { kind: "questions", target: "q1", meta: { sessionId: "s1", openOnlyWhenSessionOpen: true } } }, c)
    } finally {
      window.removeEventListener(WORKSPACE_SURFACE_OPEN_SKIPPED_EVENT, skipped)
    }
    expect(c.__surface.__surfaces).toEqual([])
    expect(openWorkbench).not.toHaveBeenCalled()
    expect(skipped).toHaveBeenCalledWith(expect.objectContaining({ detail: { kind: "questions", target: "q1", filesystem: "user", meta: { sessionId: "s1", openOnlyWhenSessionOpen: true } } }))
  })

  it("marks openSurface as ephemeral when it had to open a closed workbench", () => {
    const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => { cb(0); return 0 })
    const surface = fakeSurface()
    let open = false
    const c = ctx({ isWorkbenchOpen: () => open, openWorkbench: () => { open = true } }, surface)
    dispatchUiCommand({ kind: "openSurface", params: { kind: "questions", target: "q1" } }, c)
    expect(c.__surface.__surfaces).toEqual([{ kind: "questions", target: "q1", filesystem: "user", meta: { closeWorkbenchOnDone: true } }])
    raf.mockRestore()
  })

  it("openSurface requires kind and target", () => {
    const c = ctx()
    dispatchUiCommand({ kind: "openSurface", params: { kind: "x" } }, c)
    dispatchUiCommand({ kind: "openSurface", params: { target: "y" } }, c)
    expect(c.__surface.__surfaces).toEqual([])
  })

  it("openPanel requires both id and component", () => {
    const c = ctx()
    dispatchUiCommand({ kind: "openPanel", params: { id: "logs" } }, c)
    dispatchUiCommand({ kind: "openPanel", params: { component: "log-viewer" } }, c)
    expect(c.__surface.__panels).toEqual([])
  })

  it("expandToFile reveals a tree path without opening a file", () => {
    const openWorkbenchSources = vi.fn()
    const c = ctx({ openWorkbenchSources })
    dispatchUiCommand({ kind: "expandToFile", params: { path: "src" } }, c)
    expect(openWorkbenchSources).toHaveBeenCalledOnce()
    expect(c.__surface.__expanded).toEqual(["src"])
    expect(c.__surface.__opened).toEqual([])
  })

  it("expandToFile opens the workbench and sources when closed", () => {
    const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => { cb(0); return 0 })
    const surface = fakeSurface()
    const openWorkbenchSources = vi.fn()
    let open = false
    const c = ctx({ isWorkbenchOpen: () => open, openWorkbench: () => { open = true }, openWorkbenchSources }, surface)
    dispatchUiCommand({ kind: "expandToFile", params: { path: "src" } }, c)
    expect(open).toBe(true)
    expect(openWorkbenchSources).toHaveBeenCalledOnce()
    expect(c.__surface.__expanded).toEqual(["src"])
    raf.mockRestore()
  })

  it("closeWorkbenchLeftPane closes the workbench left pane", () => {
    const c = ctx()
    dispatchUiCommand({ kind: "closeWorkbenchLeftPane", params: {} }, c)
    expect(c.__surface.__leftClosed).toBe(1)
  })

  it("closeWorkbenchLeftPane retries when the workbench is open but the surface mounts late", () => {
    let surface: ReturnType<typeof fakeSurface> | null = null
    const mountedSurface = fakeSurface()
    const rafQueue: FrameRequestCallback[] = []
    const originalRaf = global.requestAnimationFrame
    global.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafQueue.push(cb)
      return rafQueue.length
    }) as typeof requestAnimationFrame
    const c: DispatchContext = {
      surface: () => surface,
      isWorkbenchOpen: () => true,
      openWorkbench: () => {},
    }

    try {
      dispatchUiCommand({ kind: "closeWorkbenchLeftPane", params: {} }, c)
      expect(mountedSurface.__leftClosed).toBe(0)
      surface = mountedSurface
      rafQueue.shift()?.(0)
      expect(mountedSurface.__leftClosed).toBe(1)
    } finally {
      global.requestAnimationFrame = originalRaf
    }
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

  it("opens the workbench and retries until a late surface is ready", () => {
    let workbenchOpen = false
    let surface: ReturnType<typeof fakeSurface> | null = null
    const openedSurface = fakeSurface()
    const rafQueue: FrameRequestCallback[] = []
    const originalRaf = global.requestAnimationFrame
    global.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafQueue.push(cb)
      return rafQueue.length
    }) as typeof requestAnimationFrame
    const c: DispatchContext = {
      surface: () => surface,
      isWorkbenchOpen: () => workbenchOpen,
      openWorkbench: () => {
        workbenchOpen = true
      },
    }

    try {
      dispatchUiCommand({ kind: "openFile", params: { path: "x.ts" } }, c)
      expect(workbenchOpen).toBe(true)
      expect(openedSurface.__opened).toEqual([])
      rafQueue.shift()?.(0)
      expect(openedSurface.__opened).toEqual([])
      surface = openedSurface
      rafQueue.shift()?.(0)
      expect(openedSurface.__opened).toEqual(["x.ts"])
    } finally {
      global.requestAnimationFrame = originalRaf
    }
  })
})
