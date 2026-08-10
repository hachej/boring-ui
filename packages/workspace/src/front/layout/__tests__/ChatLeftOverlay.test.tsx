import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ChatLeftOverlay } from "../ChatLeftOverlay"

const overlayPart = "[data-boring-workspace-part='chat-left-overlay']"

function overlay(): HTMLElement | null {
  return document.querySelector(overlayPart)
}

describe("ChatLeftOverlay transitions", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // React schedules the opening frame via rAF; run it on the fake clock.
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 0) as unknown as number)
    vi.stubGlobal("cancelAnimationFrame", (handle: number) =>
      clearTimeout(handle as unknown as ReturnType<typeof setTimeout>))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("animates in, keeps the outgoing surface mounted for the exit, then unmounts", () => {
    const { rerender } = render(<ChatLeftOverlay overlay={<div>Skills surface</div>} hidden={false} />)

    // Starts closed so the opening transition has a start value.
    expect(overlay()).toHaveAttribute("data-boring-state", "closed")
    act(() => { vi.advanceTimersByTime(0) })
    expect(overlay()).toHaveAttribute("data-boring-state", "open")

    rerender(<ChatLeftOverlay overlay={null} hidden={false} />)
    // Still mounted and now closing, so the exit is visible.
    expect(overlay()).toHaveAttribute("data-boring-state", "closed")
    expect(screen.getByText("Skills surface")).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(149) })
    expect(overlay()).not.toBeNull()

    act(() => { vi.advanceTimersByTime(1) })
    expect(overlay()).toBeNull()
  })

  it("survives rapid close/reopen toggling without a stale unmount", () => {
    const { rerender } = render(<ChatLeftOverlay overlay={<div>Plugins surface</div>} hidden={false} />)
    act(() => { vi.advanceTimersByTime(0) })

    rerender(<ChatLeftOverlay overlay={null} hidden={false} />)
    act(() => { vi.advanceTimersByTime(50) })

    // Reopen mid-exit: the pending unmount timer must be cancelled.
    rerender(<ChatLeftOverlay overlay={<div>Plugins surface</div>} hidden={false} />)
    act(() => { vi.advanceTimersByTime(200) })

    expect(overlay()).toHaveAttribute("data-boring-state", "open")
    expect(screen.getByText("Plugins surface")).toBeInTheDocument()

    // A subsequent close still completes on its own full duration.
    rerender(<ChatLeftOverlay overlay={null} hidden={false} />)
    act(() => { vi.advanceTimersByTime(149) })
    expect(overlay()).not.toBeNull()
    act(() => { vi.advanceTimersByTime(1) })
    expect(overlay()).toBeNull()
  })

  it("clears the pending unmount timer when it unmounts mid-exit", () => {
    const { rerender, unmount } = render(<ChatLeftOverlay overlay={<div>Tools surface</div>} hidden={false} />)
    act(() => { vi.advanceTimersByTime(0) })

    rerender(<ChatLeftOverlay overlay={null} hidden={false} />)
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    unmount()
    expect(vi.getTimerCount()).toBe(0)
    act(() => { vi.advanceTimersByTime(500) })
  })

  it("mirrors the collapsed chat column into aria-hidden", () => {
    render(<ChatLeftOverlay overlay={<div>Skills surface</div>} hidden />)
    expect(overlay()).toHaveAttribute("aria-hidden", "true")
  })
})
