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
      result.current.reload()
    })
    expect(result.current.reloadKey).toBe(2)
  })
})
