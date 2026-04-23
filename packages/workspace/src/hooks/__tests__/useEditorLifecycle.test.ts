import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useEditorLifecycle, type EditorLifecycleAdapter } from "../useEditorLifecycle"

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

  it("rapid changes within 1000ms produce only one save", async () => {
    const adapter = createAdapter()
    const { result } = renderHook(() =>
      useEditorLifecycle("/a.ts", { adapter, panelId: "p1" }),
    )
    act(() => result.current.markDirty())
    act(() => {
      vi.advanceTimersByTime(500)
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

describe("external file change detection", () => {
  it("sets shouldSync when serverMtime changes while not dirty", () => {
    const adapter = createAdapter()
    const { result, rerender } = renderHook(
      ({ mtime }: { mtime: number | null }) =>
        useEditorLifecycle("/a.ts", { adapter, panelId: "p1", serverMtime: mtime }),
      { initialProps: { mtime: 100 } },
    )
    rerender({ mtime: 200 })
    expect(result.current.shouldSync).toBe(true)
  })

  it("does not set shouldSync when dirty", () => {
    const adapter = createAdapter()
    const { result, rerender } = renderHook(
      ({ mtime }: { mtime: number | null }) =>
        useEditorLifecycle("/a.ts", { adapter, panelId: "p1", serverMtime: mtime }),
      { initialProps: { mtime: 100 } },
    )
    act(() => result.current.markDirty())
    rerender({ mtime: 200 })
    expect(result.current.shouldSync).toBe(false)
  })

  it("suppresses stale reads within 3s of save", async () => {
    const adapter = createAdapter()
    const { result, rerender } = renderHook(
      ({ mtime }: { mtime: number | null }) =>
        useEditorLifecycle("/a.ts", { adapter, panelId: "p1", serverMtime: mtime }),
      { initialProps: { mtime: 100 } },
    )
    act(() => result.current.markDirty())
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    // save happened, now change mtime within 3s window
    rerender({ mtime: 200 })
    expect(result.current.shouldSync).toBe(false)
  })

  it("does not advance baseline during suppression window", async () => {
    const adapter = createAdapter()
    const { result, rerender } = renderHook(
      ({ mtime }: { mtime: number | null }) =>
        useEditorLifecycle("/a.ts", { adapter, panelId: "p1", serverMtime: mtime }),
      { initialProps: { mtime: 100 } },
    )
    act(() => result.current.markDirty())
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    // change during suppression — should NOT sync
    rerender({ mtime: 200 })
    expect(result.current.shouldSync).toBe(false)
    // after suppression, a further mtime bump triggers sync
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    rerender({ mtime: 300 })
    expect(result.current.shouldSync).toBe(true)
  })

  it("detects changes after 3s window", async () => {
    const adapter = createAdapter()
    const { result, rerender } = renderHook(
      ({ mtime }: { mtime: number | null }) =>
        useEditorLifecycle("/a.ts", { adapter, panelId: "p1", serverMtime: mtime }),
      { initialProps: { mtime: 100 } },
    )
    act(() => result.current.markDirty())
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    // advance past 3s suppression window
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    rerender({ mtime: 200 })
    expect(result.current.shouldSync).toBe(true)
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
