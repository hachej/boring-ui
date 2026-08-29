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

function fireKeyFrom(element: HTMLElement, key: string, opts: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  })
  element.dispatchEvent(event)
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

  it("does not fire inside editable targets by default", () => {
    const handler = vi.fn()
    const input = document.createElement("input")
    document.body.appendChild(input)
    input.focus()
    renderHook(() =>
      useKeyboardShortcuts({ shortcuts: [{ key: "p", mod: true, handler }] }),
    )
    fireKeyFrom(input, "p", { metaKey: true })
    expect(handler).not.toHaveBeenCalled()
    input.remove()
  })

  it("can opt into shortcuts inside editable targets", () => {
    const handler = vi.fn()
    const input = document.createElement("input")
    document.body.appendChild(input)
    input.focus()
    renderHook(() =>
      useKeyboardShortcuts({
        shortcuts: [{ key: "p", mod: true, allowInEditable: true, handler }],
      }),
    )
    fireKeyFrom(input, "p", { metaKey: true })
    expect(handler).toHaveBeenCalledOnce()
    input.remove()
  })

  it("treats descendants inside role=textbox as editable", () => {
    const handler = vi.fn()
    const host = document.createElement("div")
    host.setAttribute("role", "textbox")
    const child = document.createElement("span")
    child.textContent = "inside"
    host.appendChild(child)
    document.body.appendChild(host)

    renderHook(() =>
      useKeyboardShortcuts({ shortcuts: [{ key: "p", mod: true, handler }] }),
    )

    fireKeyFrom(child, "p", { metaKey: true })
    expect(handler).not.toHaveBeenCalled()
    host.remove()
  })
})

describe("useKeyboardShortcuts shouldHandle (#1391 regression)", () => {
  // Simulates Radix's DismissableLayer: a document-level, capture-phase
  // keydown listener that is registered *after* this hook's own listener
  // (mirroring an on-demand dropdown that opens after the app shell has
  // already mounted its global shortcuts), and that only dismisses when
  // the event has not already been marked defaultPrevented by an earlier
  // capture-phase listener on the same node. This is the actual event
  // wiring that broke in production: a naive jsdom keydown against the
  // dropdown alone never exercises this race, since there's no competing
  // listener to lose to.
  function mountFakeDismissableLayer(onDismiss: () => void) {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (!event.defaultPrevented) onDismiss()
    }
    document.addEventListener("keydown", handleKeyDown, { capture: true })
    return () => document.removeEventListener("keydown", handleKeyDown, { capture: true })
  }

  it("without a guard, an unconditional Escape shortcut blocks a later-registered dismissable layer from closing", () => {
    // This reproduces the pre-fix bug: ChatLayout's Escape binding had no
    // shouldHandle guard, so it always preventDefault()'d first.
    const focusChat = vi.fn()
    renderHook(() =>
      useKeyboardShortcuts({ shortcuts: [{ key: "Escape", allowInEditable: true, handler: focusChat }] }),
    )
    const onDismiss = vi.fn()
    const unmountLayer = mountFakeDismissableLayer(onDismiss)

    fireKey("Escape")

    expect(focusChat).toHaveBeenCalledOnce()
    expect(onDismiss).not.toHaveBeenCalled() // the bug: the "overlay" never closes

    unmountLayer()
  })

  it("with shouldHandle guarding an open overlay, Escape reaches the dismissable layer instead", () => {
    const focusChat = vi.fn()
    let overlayOpen = true
    renderHook(() =>
      useKeyboardShortcuts({
        shortcuts: [{
          key: "Escape",
          allowInEditable: true,
          shouldHandle: () => !overlayOpen,
          handler: focusChat,
        }],
      }),
    )
    const onDismiss = vi.fn()
    const unmountLayer = mountFakeDismissableLayer(onDismiss)

    fireKey("Escape")

    expect(focusChat).not.toHaveBeenCalled()
    expect(onDismiss).toHaveBeenCalledOnce() // the fix: the overlay closes itself

    unmountLayer()
  })

  it("shouldHandle true still lets the shortcut fire and preventDefault as before", () => {
    const focusChat = vi.fn()
    const overlayOpen = false
    renderHook(() =>
      useKeyboardShortcuts({
        shortcuts: [{
          key: "Escape",
          allowInEditable: true,
          shouldHandle: () => !overlayOpen,
          handler: focusChat,
        }],
      }),
    )
    const onDismiss = vi.fn()
    const unmountLayer = mountFakeDismissableLayer(onDismiss)

    fireKey("Escape")

    expect(focusChat).toHaveBeenCalledOnce()
    expect(onDismiss).not.toHaveBeenCalled()

    unmountLayer()
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
