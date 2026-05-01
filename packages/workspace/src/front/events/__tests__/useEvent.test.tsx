import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useEvent } from "../useEvent"
import { events, workspaceEvents } from "../index"
import { userMeta } from "../types"
import { filesystemEvents } from "../../../plugins/filesystemPlugin/events"

describe("useEvent", () => {
  beforeEach(() => events._reset())

  it("subscribes on mount and unsubscribes on unmount", () => {
    const fn = vi.fn()
    const { unmount } = renderHook(() => useEvent(filesystemEvents.moved, fn))

    act(() => {
      events.emit(filesystemEvents.moved, { ...userMeta(), from: "a", to: "b" })
    })
    expect(fn).toHaveBeenCalledTimes(1)

    unmount()
    act(() => {
      events.emit(filesystemEvents.moved, { ...userMeta(), from: "x", to: "y" })
    })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("uses a stable subscription across handler re-renders", () => {
    let last: { from: string; to: string } | undefined
    const { rerender } = renderHook(
      ({ tag }: { tag: string }) =>
        useEvent(filesystemEvents.moved, (p) => {
          last = { from: `${tag}:${p.from}`, to: p.to }
        }),
      { initialProps: { tag: "v1" } },
    )

    rerender({ tag: "v2" })
    act(() => {
      events.emit(filesystemEvents.moved, { ...userMeta(), from: "src", to: "dst" })
    })
    // Latest handler closure (with tag=v2) was used — proves the ref
    // is updated between renders without re-subscribing.
    expect(last).toEqual({ from: "v2:src", to: "dst" })
  })

  it("passes the typed payload through unchanged", () => {
    const fn = vi.fn()
    renderHook(() => useEvent(workspaceEvents.editorSaveEnd, fn))
    act(() => {
      events.emit(workspaceEvents.editorSaveEnd, {
        panelId: "p1",
        ok: false,
        error: "disk full",
      })
    })
    expect(fn).toHaveBeenCalledWith({
      panelId: "p1",
      ok: false,
      error: "disk full",
    })
  })

  it("decoupled subscriptions for different event names", () => {
    const movedFn = vi.fn()
    const deletedFn = vi.fn()
    renderHook(() => {
      useEvent(filesystemEvents.moved, movedFn)
      useEvent(filesystemEvents.deleted, deletedFn)
    })
    act(() => {
      events.emit(filesystemEvents.deleted, { ...userMeta(), path: "x" })
    })
    expect(movedFn).not.toHaveBeenCalled()
    expect(deletedFn).toHaveBeenCalledTimes(1)
  })

  it("name-switch unsubscribes the old channel and subscribes the new", () => {
    const fn = vi.fn()
    type DynamicName = typeof filesystemEvents.moved | typeof filesystemEvents.deleted
    const { rerender } = renderHook(
      ({ name }: { name: DynamicName }) =>
        // Cast keeps the test ergonomic — production callers would
        // pass a literal name. We're only exercising the prop change.
        useEvent(name as typeof filesystemEvents.moved, fn as (p: unknown) => void),
      { initialProps: { name: filesystemEvents.moved as DynamicName } },
    )
    act(() => {
      events.emit(filesystemEvents.moved, { ...userMeta(), from: "a", to: "b" })
    })
    expect(fn).toHaveBeenCalledTimes(1)
    rerender({ name: filesystemEvents.deleted })
    // Old channel must no longer be subscribed
    act(() => {
      events.emit(filesystemEvents.moved, { ...userMeta(), from: "x", to: "y" })
    })
    expect(fn).toHaveBeenCalledTimes(1)
    // New channel must now be subscribed
    act(() => {
      events.emit(filesystemEvents.deleted, { ...userMeta(), path: "z" })
    })
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
