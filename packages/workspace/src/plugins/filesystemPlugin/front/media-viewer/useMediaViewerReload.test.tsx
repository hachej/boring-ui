import { renderHook, act } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { events } from "../../../../front/events"
import { filesystemEvents } from "../../shared/events"
import { useMediaViewerReload } from "./useMediaViewerReload"

describe("useMediaViewerReload", () => {
  beforeEach(() => {
    events._reset()
  })

  it("increments reloadKey for matching filesystem change events and manual reloads", () => {
    const { result } = renderHook(() => useMediaViewerReload({ path: "docs/report.pdf" }))

    expect(result.current.reloadKey).toBe(0)

    act(() => {
      events.emit(filesystemEvents.changed, {
        cause: "remote",
        ts: Date.now(),
        path: "docs/other.pdf",
      })
    })
    expect(result.current.reloadKey).toBe(0)

    act(() => {
      events.emit(filesystemEvents.changed, {
        cause: "remote",
        ts: Date.now(),
        path: "docs/report.pdf",
      })
    })
    expect(result.current.reloadKey).toBe(1)

    act(() => {
      events.emit(filesystemEvents.created, {
        cause: "remote",
        ts: Date.now(),
        path: "docs/report.pdf",
        kind: "file",
      })
    })
    expect(result.current.reloadKey).toBe(2)

    act(() => {
      events.emit(filesystemEvents.moved, {
        cause: "remote",
        ts: Date.now(),
        from: "docs/old.pdf",
        to: "docs/report.pdf",
      })
    })
    expect(result.current.reloadKey).toBe(3)

    act(() => {
      result.current.reload()
    })
    expect(result.current.reloadKey).toBe(4)
  })
})
