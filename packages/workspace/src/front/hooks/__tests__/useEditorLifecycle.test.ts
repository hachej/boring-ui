import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useEditorLifecycle, type EditorLifecycleAdapter } from "../useEditorLifecycle"
import { events, workspaceEvents } from "../../events"

function createAdapter(overrides: Partial<EditorLifecycleAdapter> = {}): EditorLifecycleAdapter {
  return {
    isDirty: vi.fn(() => true),
    save: vi.fn(async () => {}),
    getContent: vi.fn(() => "content"),
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("dirty state tracking", () => {
  it("starts clean", () => {
    const adapter = createAdapter()
    const { result } = renderHook(() =>
      useEditorLifecycle("/a.ts", { adapter, panelId: "p1" }),
    )
    expect(result.current.isDirty).toBe(false)
  })

  it("becomes dirty when markDirty is called", () => {
    const adapter = createAdapter()
    const { result } = renderHook(() =>
      useEditorLifecycle("/a.ts", { adapter, panelId: "p1" }),
    )
    act(() => result.current.markDirty())
    expect(result.current.isDirty).toBe(true)
  })

  it("fires onDirtyChange(path, true) on markDirty", () => {
    const onDirtyChange = vi.fn()
    const adapter = createAdapter()
    const { result } = renderHook(() =>
      useEditorLifecycle("/a.ts", { adapter, panelId: "p1", onDirtyChange }),
    )
    act(() => result.current.markDirty())
    expect(onDirtyChange).toHaveBeenCalledWith("/a.ts", true)
  })

  it("fires onDirtyChange(path, false) after save", async () => {
    const onDirtyChange = vi.fn()
    const adapter = createAdapter()
    const { result } = renderHook(() =>
      useEditorLifecycle("/a.ts", { adapter, panelId: "p1", onDirtyChange }),
    )
    act(() => result.current.markDirty())
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(onDirtyChange).toHaveBeenCalledWith("/a.ts", false)
    expect(result.current.isDirty).toBe(false)
  })

  it("markClean clears dirty state without saving", () => {
    const onDirtyChange = vi.fn()
    const adapter = createAdapter()
    const { result } = renderHook(() =>
      useEditorLifecycle("/a.ts", { adapter, panelId: "p1", onDirtyChange }),
    )

    act(() => result.current.markDirty())
    expect(result.current.isDirty).toBe(true)

    act(() => result.current.markClean())

    expect(result.current.isDirty).toBe(false)
    expect(adapter.save).not.toHaveBeenCalled()
    expect(onDirtyChange).toHaveBeenLastCalledWith("/a.ts", false)
  })

  it("does not mark dirty when path is null", () => {
    const adapter = createAdapter()
    const { result } = renderHook(() =>
      useEditorLifecycle(null, { adapter, panelId: "p1" }),
    )
    act(() => result.current.markDirty())
    expect(result.current.isDirty).toBe(false)
  })
})

describe("auto-save debounce", () => {
  it("does not save immediately on markDirty", () => {
    const adapter = createAdapter()
    const { result } = renderHook(() =>
      useEditorLifecycle("/a.ts", { adapter, panelId: "p1" }),
    )
    act(() => result.current.markDirty())
    expect(adapter.save).not.toHaveBeenCalled()
  })

  it("saves after 1000ms", async () => {
    const adapter = createAdapter()
    const { result } = renderHook(() =>
      useEditorLifecycle("/a.ts", { adapter, panelId: "p1" }),
    )
    act(() => result.current.markDirty())
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(adapter.save).toHaveBeenCalledOnce()
  })

  it("rapid changes within the debounce window produce only one save", async () => {
    const adapter = createAdapter()
    const { result } = renderHook(() =>
      useEditorLifecycle("/a.ts", { adapter, panelId: "p1" }),
    )
    act(() => result.current.markDirty())
    act(() => {
      // Stay strictly inside AUTO_SAVE_DELAY (250ms) so the timer hasn't fired yet.
      vi.advanceTimersByTime(100)
    })
    act(() => result.current.markDirty())
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(adapter.save).toHaveBeenCalledOnce()
  })

  it("does not save when adapter.isDirty returns false", async () => {
    const adapter = createAdapter({ isDirty: vi.fn(() => false) })
    const { result } = renderHook(() =>
      useEditorLifecycle("/a.ts", { adapter, panelId: "p1" }),
    )
    act(() => result.current.markDirty())
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(adapter.save).not.toHaveBeenCalled()
  })

  it("sets lastSavedAt after successful save", async () => {
    const adapter = createAdapter()
    const { result } = renderHook(() =>
      useEditorLifecycle("/a.ts", { adapter, panelId: "p1" }),
    )
    expect(result.current.lastSavedAt).toBeNull()
    act(() => result.current.markDirty())
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.lastSavedAt).toBeTypeOf("number")
  })
})

describe("flushSave", () => {
  it("cancels pending debounce and saves immediately", async () => {
    const adapter = createAdapter()
    const { result } = renderHook(() =>
      useEditorLifecycle("/a.ts", { adapter, panelId: "p1" }),
    )
    act(() => result.current.markDirty())
    await act(async () => {
      await result.current.flushSave()
    })
    expect(adapter.save).toHaveBeenCalledOnce()
  })

  it("is a no-op when not dirty", async () => {
    const adapter = createAdapter({ isDirty: vi.fn(() => false) })
    const { result } = renderHook(() =>
      useEditorLifecycle("/a.ts", { adapter, panelId: "p1" }),
    )
    await act(async () => {
      await result.current.flushSave()
    })
    expect(adapter.save).not.toHaveBeenCalled()
  })

  it("isDirty remains true if save fails", async () => {
    const adapter = createAdapter({
      save: vi.fn(async () => { throw new Error("fail") }),
    })
    const { result } = renderHook(() =>
      useEditorLifecycle("/a.ts", { adapter, panelId: "p1" }),
    )
    act(() => result.current.markDirty())
    await act(async () => {
      try { await result.current.flushSave() } catch {}
    })
    expect(result.current.isDirty).toBe(true)
  })

  it("deduplicates concurrent flushSave calls", async () => {
    const adapter = createAdapter()
    const { result } = renderHook(() =>
      useEditorLifecycle("/a.ts", { adapter, panelId: "p1" }),
    )
    act(() => result.current.markDirty())
    await act(async () => {
      await Promise.all([result.current.flushSave(), result.current.flushSave()])
    })
    expect(adapter.save).toHaveBeenCalledOnce()
  })
})

describe("isSaving state", () => {
  it("is false before and after save", async () => {
    const adapter = createAdapter()
    const { result } = renderHook(() =>
      useEditorLifecycle("/a.ts", { adapter, panelId: "p1" }),
    )
    expect(result.current.isSaving).toBe(false)
    act(() => result.current.markDirty())
    await act(async () => {
      await result.current.flushSave()
    })
    expect(result.current.isSaving).toBe(false)
    expect(adapter.save).toHaveBeenCalledOnce()
  })
})

describe("bus emissions", () => {
  beforeEach(() => events._reset())

  it("emits save start then save end around a successful save", async () => {
    const adapter = createAdapter()
    const start = vi.fn()
    const end = vi.fn()
    events.on(workspaceEvents.editorSaveStart, start)
    events.on(workspaceEvents.editorSaveEnd, end)

    const { result } = renderHook(() =>
      useEditorLifecycle("/a.ts", { adapter, panelId: "p9" }),
    )
    act(() => result.current.markDirty())
    await act(async () => {
      await result.current.flushSave()
    })

    expect(start).toHaveBeenCalledWith({ panelId: "p9" })
    expect(end).toHaveBeenCalledWith({ panelId: "p9" })
  })

  it("still emits save end when save throws (so spinner clears)", async () => {
    const adapter = createAdapter({
      save: vi.fn(async () => {
        throw new Error("disk full")
      }),
    })
    const end = vi.fn()
    events.on(workspaceEvents.editorSaveEnd, end)

    const { result } = renderHook(() =>
      useEditorLifecycle("/a.ts", { adapter, panelId: "p10" }),
    )
    act(() => result.current.markDirty())
    await act(async () => {
      await result.current.flushSave().catch(() => {})
    })

    expect(end).toHaveBeenCalledWith({ panelId: "p10" })
  })

  it("emits save end if the path changes while a save is still in flight", async () => {
    let resolveSave: (() => void) | undefined
    const adapter = createAdapter({
      save: vi.fn(() => new Promise<void>((resolve) => {
        resolveSave = resolve
      })),
    })
    const end = vi.fn()
    events.on(workspaceEvents.editorSaveEnd, end)

    const { result, rerender } = renderHook(
      ({ path }) => useEditorLifecycle(path, { adapter, panelId: "p11" }),
      { initialProps: { path: "/a.ts" } },
    )

    act(() => result.current.markDirty())
    await act(async () => {
      void result.current.flushSave()
      await Promise.resolve()
    })

    rerender({ path: "/b.ts" })
    expect(end).toHaveBeenCalledWith({ panelId: "p11" })

    await act(async () => {
      resolveSave?.()
      await Promise.resolve()
    })

    expect(end).toHaveBeenCalledTimes(1)
  })
})

describe("save watchdog", () => {
  // REGRESSION: a hung save (network drop, stuck mutation) used to never
  // emit saveEnd. The tab spinner + dirty marker stayed forever and
  // `saveInFlightRef` cached the hung promise so future save attempts
  // returned it instead of trying again. Now a watchdog (30s) trips,
  // saveEnd emits so the spinner clears, and dirty stays true so the next
  // keystroke triggers a fresh save attempt.
  it("hung save (never-resolving adapter) trips the watchdog and clears the tab spinner", async () => {
    const adapter = createAdapter({
      // Never resolves — mimics fetch hung on a dead connection.
      save: vi.fn(() => new Promise<void>(() => {})),
    })
    const end = vi.fn()
    events.on(workspaceEvents.editorSaveEnd, end)

    const { result } = renderHook(() =>
      useEditorLifecycle("/a.ts", { adapter, panelId: "p-hang" }),
    )
    act(() => result.current.markDirty())
    let flushPromise: Promise<unknown> | undefined
    act(() => { flushPromise = result.current.flushSave() })
    expect(result.current.isSaving).toBe(true)

    await act(async () => {
      vi.advanceTimersByTime(30_000)
      await flushPromise
    })

    expect(end).toHaveBeenCalledWith({ panelId: "p-hang" })
    expect(result.current.isSaving).toBe(false)
    expect(result.current.isDirty).toBe(true) // user's edits preserved
  })
})
