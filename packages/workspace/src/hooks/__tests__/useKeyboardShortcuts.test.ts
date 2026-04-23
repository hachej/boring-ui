import { describe, it, expect, vi, afterEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useKeyboardShortcuts, formatShortcut } from "../useKeyboardShortcuts"

function fireKey(key: string, opts: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  })
  document.dispatchEvent(event)
  return event
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("useKeyboardShortcuts", () => {
  it("calls handler on matching keydown", () => {
    const handler = vi.fn()
    renderHook(() =>
      useKeyboardShortcuts({ shortcuts: [{ key: "p", mod: true, handler }] }),
    )
    fireKey("p", { metaKey: true })
    expect(handler).toHaveBeenCalledOnce()
  })

  it("does not call handler when mod key is missing", () => {
    const handler = vi.fn()
    renderHook(() =>
      useKeyboardShortcuts({ shortcuts: [{ key: "p", mod: true, handler }] }),
    )
    fireKey("p")
    expect(handler).not.toHaveBeenCalled()
  })

  it("matches ctrlKey as mod alternative", () => {
    const handler = vi.fn()
    renderHook(() =>
      useKeyboardShortcuts({ shortcuts: [{ key: "b", mod: true, handler }] }),
    )
    fireKey("b", { ctrlKey: true })
    expect(handler).toHaveBeenCalledOnce()
  })

  it("does not fire when enabled=false", () => {
    const handler = vi.fn()
    renderHook(() =>
      useKeyboardShortcuts({
        shortcuts: [{ key: "p", mod: true, handler }],
        enabled: false,
      }),
    )
    fireKey("p", { metaKey: true })
    expect(handler).not.toHaveBeenCalled()
  })

  it("handles shift modifier", () => {
    const handler = vi.fn()
    renderHook(() =>
      useKeyboardShortcuts({
        shortcuts: [{ key: "p", mod: true, shift: true, handler }],
      }),
    )
    fireKey("p", { metaKey: true, shiftKey: true })
    expect(handler).toHaveBeenCalledOnce()
  })

  it("does not match when shift is required but not pressed", () => {
    const handler = vi.fn()
    renderHook(() =>
      useKeyboardShortcuts({
        shortcuts: [{ key: "p", mod: true, shift: true, handler }],
      }),
    )
    fireKey("p", { metaKey: true })
    expect(handler).not.toHaveBeenCalled()
  })

  it("matches first shortcut when multiple are registered", () => {
    const h1 = vi.fn()
    const h2 = vi.fn()
    renderHook(() =>
      useKeyboardShortcuts({
        shortcuts: [
          { key: "b", mod: true, handler: h1 },
          { key: "s", mod: true, handler: h2 },
        ],
      }),
    )
    fireKey("s", { metaKey: true })
    expect(h1).not.toHaveBeenCalled()
    expect(h2).toHaveBeenCalledOnce()
  })

  it("cleans up listener on unmount", () => {
    const handler = vi.fn()
    const { unmount } = renderHook(() =>
      useKeyboardShortcuts({ shortcuts: [{ key: "p", mod: true, handler }] }),
    )
    unmount()
    fireKey("p", { metaKey: true })
    expect(handler).not.toHaveBeenCalled()
  })

  it("case-insensitive key matching", () => {
    const handler = vi.fn()
    renderHook(() =>
      useKeyboardShortcuts({ shortcuts: [{ key: "P", mod: true, handler }] }),
    )
    fireKey("p", { metaKey: true })
    expect(handler).toHaveBeenCalledOnce()
  })
})

describe("formatShortcut", () => {
  it("formats mod+key", () => {
    const result = formatShortcut({ key: "b", mod: true })
    expect(result).toMatch(/B/)
  })

  it("formats mod+shift+key", () => {
    const result = formatShortcut({ key: "p", mod: true, shift: true })
    expect(result).toMatch(/P/)
  })

  it("formats key without mod", () => {
    const result = formatShortcut({ key: "p" })
    expect(result).toBe("P")
  })
})
