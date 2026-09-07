import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"

import { KEYBOARD_INSET_PROPERTY, useKeyboardInset } from "../useKeyboardInset"
import { useIsCompactViewport, useViewportWidth } from "../useViewportWidth"

/**
 * Both hooks exist to *not* do work: they coalesce a burst of viewport events
 * into one rAF and skip the write when the value is unchanged. Neither is
 * observable unless the frame queue is under test control, so rAF is stubbed
 * with a manual queue rather than advanced with fake timers.
 */
let frames: Array<(() => void) | null> = []

function flushFrames() {
  const pending = frames
  frames = []
  for (const frame of pending) frame?.()
}

/** jsdom has no visualViewport at all; every field the hooks read is stubbed. */
class FakeVisualViewport extends EventTarget {
  height = 800
  offsetTop = 0
  scale = 1
}

function setVisualViewport(viewport: FakeVisualViewport | undefined) {
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    writable: true,
    value: viewport,
  })
}

function setInnerHeight(height: number) {
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: height })
}

function setInnerWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width })
}

function readInset(): string {
  return document.documentElement.style.getPropertyValue(KEYBOARD_INSET_PROPERTY)
}

beforeEach(() => {
  frames = []
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => frames.push(callback))
  // Maps ids as `frames[id - 1]`, valid only while these tests are the sole
  // rAF schedulers in the environment (ids are 1-based indices into `frames`).
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames[id - 1] = null
  })
  setInnerHeight(800)
  setInnerWidth(1280)
})

afterEach(() => {
  vi.unstubAllGlobals()
  setVisualViewport(undefined)
  document.documentElement.style.removeProperty(KEYBOARD_INSET_PROPERTY)
})

describe("useKeyboardInset", () => {
  it("publishes 0px when the host has no visualViewport", () => {
    setVisualViewport(undefined)

    renderHook(() => useKeyboardInset())

    expect(readInset()).toBe("0px")
  })

  it("publishes the strip covered by the keyboard, coalesced to one frame", () => {
    const viewport = new FakeVisualViewport()
    setVisualViewport(viewport)

    renderHook(() => useKeyboardInset())
    expect(readInset()).toBe("0px")

    act(() => {
      viewport.height = 500
      viewport.dispatchEvent(new Event("resize"))
      viewport.dispatchEvent(new Event("scroll"))
      viewport.dispatchEvent(new Event("resize"))
    })

    // Three events, one queued frame, and nothing written until it runs.
    expect(frames).toHaveLength(1)
    expect(readInset()).toBe("0px")

    act(() => flushFrames())
    expect(readInset()).toBe("300px")
  })

  it("subtracts the amount Safari has already panned the page up", () => {
    const viewport = new FakeVisualViewport()
    viewport.height = 500
    viewport.offsetTop = 120
    setVisualViewport(viewport)

    renderHook(() => useKeyboardInset())

    expect(readInset()).toBe("180px")
  })

  it("never publishes a negative inset", () => {
    const viewport = new FakeVisualViewport()
    viewport.height = 900
    setVisualViewport(viewport)

    renderHook(() => useKeyboardInset())

    expect(readInset()).toBe("0px")
  })

  it("freezes the published inset while pinch-zoomed and converges on unzoom", () => {
    const viewport = new FakeVisualViewport()
    setVisualViewport(viewport)
    setInnerHeight(800)

    const { unmount } = renderHook(() => useKeyboardInset())

    // Keyboard open: the real inset.
    viewport.height = 400
    act(() => viewport.dispatchEvent(new Event("resize")))
    flushFrames()
    expect(readInset()).toBe("400px")

    // Pinch-zoom shrinks visualViewport too, but is not a keyboard: the last
    // real value must be frozen instead of publishing a phantom inset.
    viewport.scale = 2
    act(() => viewport.dispatchEvent(new Event("resize")))
    flushFrames()
    expect(readInset()).toBe("400px")

    // Unzooming fires another resize; the hook converges on the real value.
    viewport.scale = 1
    viewport.height = 800
    act(() => viewport.dispatchEvent(new Event("resize")))
    flushFrames()
    expect(readInset()).toBe("0px")

    unmount()
  })

  it("resets to 0px and detaches its listeners on unmount", () => {
    const viewport = new FakeVisualViewport()
    setVisualViewport(viewport)

    const { unmount } = renderHook(() => useKeyboardInset())
    act(() => {
      viewport.height = 500
      viewport.dispatchEvent(new Event("resize"))
      flushFrames()
    })
    expect(readInset()).toBe("300px")

    unmount()
    expect(readInset()).toBe("0px")

    viewport.height = 200
    viewport.dispatchEvent(new Event("resize"))
    expect(frames).toHaveLength(0)
    expect(readInset()).toBe("0px")
  })
})

describe("useViewportWidth", () => {
  it("coalesces a burst of resize events into a single frame", () => {
    const { result } = renderHook(() => useViewportWidth())
    expect(result.current).toBe(1280)

    act(() => {
      setInnerWidth(390)
      window.dispatchEvent(new Event("resize"))
      window.dispatchEvent(new Event("resize"))
      window.dispatchEvent(new Event("resize"))
    })

    expect(frames).toHaveLength(1)
    expect(result.current).toBe(1280)

    act(() => flushFrames())
    expect(result.current).toBe(390)
  })

  it("does not re-render when the width is unchanged", () => {
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useViewportWidth()
    })

    const baseline = renders
    act(() => {
      // A keyboard opening or a URL bar collapsing resizes the height only.
      setInnerHeight(500)
      window.dispatchEvent(new Event("resize"))
      flushFrames()
    })

    expect(renders).toBe(baseline)
    expect(result.current).toBe(1280)
  })

  it("cancels a pending frame on unmount", () => {
    const { unmount } = renderHook(() => useViewportWidth())

    act(() => {
      setInnerWidth(390)
      window.dispatchEvent(new Event("resize"))
    })
    expect(frames).toHaveLength(1)

    unmount()
    expect(frames[0]).toBeNull()

    window.dispatchEvent(new Event("resize"))
    expect(frames).toHaveLength(1)
  })
})

describe("useIsCompactViewport", () => {
  function stubMatchMedia(initialMatches: boolean) {
    const listeners = new Set<(event: MediaQueryListEvent) => void>()
    const query = {
      matches: initialMatches,
      media: "",
      addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener)
      },
      removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener)
      },
    }
    const matchMedia = vi.fn(() => query)
    vi.stubGlobal("matchMedia", matchMedia)
    return {
      matchMedia,
      emit(matches: boolean) {
        query.matches = matches
        for (const listener of listeners) listener({ matches } as MediaQueryListEvent)
      },
      listenerCount: () => listeners.size,
    }
  }

  it("queries the compact breakpoint with an exclusive upper bound", () => {
    const media = stubMatchMedia(false)

    renderHook(() => useIsCompactViewport())

    expect(media.matchMedia).toHaveBeenCalledWith("(max-width: 639px)")
  })

  it("flips on the media change alone, without any resize event", () => {
    const media = stubMatchMedia(false)

    const { result, unmount } = renderHook(() => useIsCompactViewport())
    expect(result.current).toBe(false)

    act(() => media.emit(true))
    expect(result.current).toBe(true)
    expect(frames).toHaveLength(0)

    unmount()
    expect(media.listenerCount()).toBe(0)
  })
})
