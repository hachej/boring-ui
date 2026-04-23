import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { useViewportBreakpoint } from "../useViewportBreakpoint"
import { useResponsiveSidebarCollapse } from "../useResponsiveSidebarCollapse"

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  })
  window.dispatchEvent(new Event("resize"))
}

describe("useViewportBreakpoint", () => {
  beforeEach(() => {
    setViewportWidth(1280)
  })

  it("returns false when width is at or above breakpoint", () => {
    const { result } = renderHook(() => useViewportBreakpoint(1024))
    expect(result.current).toBe(false)
  })

  it("returns true when width drops below breakpoint", () => {
    const { result } = renderHook(() => useViewportBreakpoint(1024))
    act(() => {
      setViewportWidth(800)
    })
    expect(result.current).toBe(true)
  })

  it("reacts to resize transitions both directions", () => {
    const { result } = renderHook(() => useViewportBreakpoint(768))
    expect(result.current).toBe(false)

    act(() => {
      setViewportWidth(600)
    })
    expect(result.current).toBe(true)

    act(() => {
      setViewportWidth(1100)
    })
    expect(result.current).toBe(false)
  })
})

describe("useResponsiveSidebarCollapse", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("auto-collapses when entering narrow viewport", () => {
    const setCollapsed = vi.fn()

    const { rerender } = renderHook(
      ({ isNarrow, collapsed }: { isNarrow: boolean; collapsed: boolean }) =>
        useResponsiveSidebarCollapse({
          isNarrowViewport: isNarrow,
          isCollapsed: collapsed,
          setCollapsed,
        }),
      { initialProps: { isNarrow: false, collapsed: false } },
    )

    rerender({ isNarrow: true, collapsed: false })
    expect(setCollapsed).toHaveBeenCalledWith(true)
  })

  it("restores expanded state when leaving narrow viewport after auto-collapse", () => {
    const setCollapsed = vi.fn()

    const { rerender } = renderHook(
      ({ isNarrow, collapsed }: { isNarrow: boolean; collapsed: boolean }) =>
        useResponsiveSidebarCollapse({
          isNarrowViewport: isNarrow,
          isCollapsed: collapsed,
          setCollapsed,
        }),
      { initialProps: { isNarrow: false, collapsed: false } },
    )

    rerender({ isNarrow: true, collapsed: false })
    rerender({ isNarrow: true, collapsed: true })
    rerender({ isNarrow: false, collapsed: true })

    expect(setCollapsed).toHaveBeenNthCalledWith(1, true)
    expect(setCollapsed).toHaveBeenNthCalledWith(2, false)
  })

  it("manual override prevents auto-restore", () => {
    const setCollapsed = vi.fn()

    const { result, rerender } = renderHook(
      ({ isNarrow, collapsed }: { isNarrow: boolean; collapsed: boolean }) =>
        useResponsiveSidebarCollapse({
          isNarrowViewport: isNarrow,
          isCollapsed: collapsed,
          setCollapsed,
        }),
      { initialProps: { isNarrow: false, collapsed: false } },
    )

    rerender({ isNarrow: true, collapsed: false })
    act(() => {
      result.current()
    })
    rerender({ isNarrow: false, collapsed: true })

    expect(setCollapsed).toHaveBeenCalledTimes(1)
    expect(setCollapsed).toHaveBeenCalledWith(true)
  })
})
