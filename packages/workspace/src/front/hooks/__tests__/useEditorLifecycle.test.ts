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

// External-mtime (SSE-echo) behavior — the area that produced the
// "banner stuck after Overwrite" and "banner re-raised by own-save echo"
// bugs. Previously zero coverage despite being the most race-prone path.
describe("external-mtime detection (shouldSync vs externalChangeWhileDirty)", () => {
  it("does NOT trigger sync on first serverMtime arrival (just anchors baseline)", () => {
    const adapter = createAdapter({ isDirty: vi.fn(() => false) })
    const { result } = renderHook(
      ({ serverMtime }) =>
        useEditorLifecycle("/a.ts", { adapter, panelId: "p1", serverMtime }),
      { initialProps: { serverMtime: 1000 as number | null } },
    )
    expect(result.current.shouldSync).toBe(false)
    expect(result.current.externalChangeWhileDirty).toBe(false)
  })

  it("triggers shouldSync when serverMtime changes while NOT dirty", () => {
    const adapter = createAdapter({ isDirty: vi.fn(() => false) })
    const { result, rerender } = renderHook(
      ({ serverMtime }) =>
        useEditorLifecycle("/a.ts", { adapter, panelId: "p1", serverMtime }),
      { initialProps: { serverMtime: 1000 as number | null } },
    )
    // Anchor at 1000, then bump to 2000 with no recent save and no dirty state.
    act(() => {
      vi.advanceTimersByTime(4000) // pass the STALE_SUPPRESSION window
    })
    rerender({ serverMtime: 2000 })
    expect(result.current.shouldSync).toBe(true)
    expect(result.current.externalChangeWhileDirty).toBe(false)
  })

  it("triggers externalChangeWhileDirty when serverMtime changes while DIRTY", () => {
    const adapter = createAdapter({ isDirty: vi.fn(() => true) })
    const { result, rerender } = renderHook(
      ({ serverMtime }) =>
        useEditorLifecycle("/a.ts", { adapter, panelId: "p1", serverMtime }),
      { initialProps: { serverMtime: 1000 as number | null } },
    )
    act(() => {
      result.current.markDirty()
      vi.advanceTimersByTime(4000)
    })
    rerender({ serverMtime: 2000 })
    expect(result.current.externalChangeWhileDirty).toBe(true)
    expect(result.current.shouldSync).toBe(false)
  })

  // REGRESSION: a successful save echoes back via SSE within
  // STALE_SUPPRESSION_MS. The lifecycle must absorb it silently, NOT
  // mistake it for an external change. Pre-fix, this re-raised the banner
  // a second time even though the user just saved.
  it("absorbs serverMtime echo within STALE_SUPPRESSION_MS of our own save (no false banner)", async () => {
    let savedMtime = 1000
    const adapter = createAdapter({
      isDirty: vi.fn(() => true),
      save: vi.fn(async () => {
        savedMtime = 2000
      }),
    })
    const { result, rerender } = renderHook(
      ({ serverMtime }) =>
        useEditorLifecycle("/a.ts", { adapter, panelId: "p1", serverMtime }),
      { initialProps: { serverMtime: 1000 as number | null } },
    )
    act(() => result.current.markDirty())
    await act(async () => {
      await result.current.flushSave()
    })
    // notifySaved is what the host adapter would call after a successful
    // write — sync the lifecycle's lastKnownMtimeRef to the new value.
    act(() => result.current.notifySaved(savedMtime))
    // Now SSE echoes back the new mtime within the 3s suppression window.
    rerender({ serverMtime: savedMtime })
    expect(result.current.shouldSync).toBe(false)
    expect(result.current.externalChangeWhileDirty).toBe(false)
  })

  // REGRESSION: notifySaved clears externalChangeWhileDirty so a banner
  // that fired in flight does NOT persist after the save lands.
  it("notifySaved clears externalChangeWhileDirty (banner clears post-save)", () => {
    const adapter = createAdapter({ isDirty: vi.fn(() => true) })
    const { result, rerender } = renderHook(
      ({ serverMtime }) =>
        useEditorLifecycle("/a.ts", { adapter, panelId: "p1", serverMtime }),
      { initialProps: { serverMtime: 1000 as number | null } },
    )
    act(() => {
      result.current.markDirty()
      vi.advanceTimersByTime(4000)
    })
    rerender({ serverMtime: 2000 })
    expect(result.current.externalChangeWhileDirty).toBe(true)
    act(() => result.current.notifySaved(2000))
    expect(result.current.externalChangeWhileDirty).toBe(false)
  })

  it("ackSync resets shouldSync (host has applied the external change)", () => {
    const adapter = createAdapter({ isDirty: vi.fn(() => false) })
    const { result, rerender } = renderHook(
      ({ serverMtime }) =>
        useEditorLifecycle("/a.ts", { adapter, panelId: "p1", serverMtime }),
      { initialProps: { serverMtime: 1000 as number | null } },
    )
    act(() => vi.advanceTimersByTime(4000))
    rerender({ serverMtime: 2000 })
    expect(result.current.shouldSync).toBe(true)
    act(() => result.current.ackSync())
    expect(result.current.shouldSync).toBe(false)
  })

  it("ackExternalChange resets externalChangeWhileDirty (host has shown the banner)", () => {
    const adapter = createAdapter({ isDirty: vi.fn(() => true) })
    const { result, rerender } = renderHook(
      ({ serverMtime }) =>
        useEditorLifecycle("/a.ts", { adapter, panelId: "p1", serverMtime }),
      { initialProps: { serverMtime: 1000 as number | null } },
    )
    act(() => {
      result.current.markDirty()
      vi.advanceTimersByTime(4000)
    })
    rerender({ serverMtime: 2000 })
    expect(result.current.externalChangeWhileDirty).toBe(true)
    act(() => result.current.ackExternalChange())
    expect(result.current.externalChangeWhileDirty).toBe(false)
  })

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

  it("repeated serverMtime equal to lastKnown is a no-op (no spurious sync)", () => {
    const adapter = createAdapter({ isDirty: vi.fn(() => false) })
    const { result, rerender } = renderHook(
      ({ serverMtime }) =>
        useEditorLifecycle("/a.ts", { adapter, panelId: "p1", serverMtime }),
      { initialProps: { serverMtime: 1000 as number | null } },
    )
    rerender({ serverMtime: 1000 })
    rerender({ serverMtime: 1000 })
    expect(result.current.shouldSync).toBe(false)
  })
})
