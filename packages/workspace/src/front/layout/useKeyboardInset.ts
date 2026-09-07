"use client"

import { useEffect } from "react"

/**
 * Public CSS contract: `--keyboard-inset` is the height, in px, of the strip at
 * the bottom of the layout viewport currently covered by the software keyboard.
 * It is always set and always a px length; it is `0px` on desktop, on hosts
 * without `visualViewport`, and whenever the keyboard is closed. Layout chrome
 * (composer, docked toolbars) should offset with
 * `calc(var(--keyboard-inset) + var(--sa-bottom))` rather than measuring itself.
 *
 * The `0px` default also lives on `:root` in `packages/workspace/src/globals.css`
 * so the variable resolves before this hook has ever mounted.
 */
export const KEYBOARD_INSET_PROPERTY = "--keyboard-inset"

/**
 * iOS never resizes the *layout* viewport for the keyboard, and Android Chrome
 * >= 108 only does so when the host opts in with
 * `interactive-widget=resizes-content`. In both cases `visualViewport` is the
 * only surface that reports the covered strip: `innerHeight` keeps describing
 * the layout viewport while `visualViewport.height` shrinks, and `offsetTop`
 * accounts for the amount Safari has already panned the page up.
 */
function readKeyboardInset(): number {
  const viewport = typeof window === "undefined" ? undefined : window.visualViewport
  if (!viewport) return 0
  // Pinch-zoom also shrinks `visualViewport.height` while `innerHeight` stands
  // still, which would publish a phantom keyboard inset mid-zoom. While the
  // user is zoomed in we freeze the last value; when scale returns to 1 the
  // accompanying `resize` re-runs this and converges on the real inset.
  if (viewport.scale > 1) return Number.NaN
  return Math.max(0, window.innerHeight - (viewport.height + viewport.offsetTop))
}

/**
 * Publishes `--keyboard-inset` on `<html>` for as long as the caller is mounted.
 *
 * Mount this once, as high in the tree as the shell that owns the viewport —
 * mounting it twice is harmless (both writers compute the same value) but
 * pointless.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const root = document.documentElement
    const viewport = window.visualViewport
    let frame = 0
    let last = ""

    const write = () => {
      frame = 0
      // Sub-pixel viewport heights are common on Android; rounding keeps the
      // style write (and any layout it triggers) out of the animation loop
      // once the keyboard has settled.
      const inset = readKeyboardInset()
      // Zoomed: keep the previously published value rather than writing a
      // phantom positive inset (see readKeyboardInset).
      if (Number.isNaN(inset)) return
      const next = `${Math.round(inset)}px`
      if (next === last) return
      last = next
      root.style.setProperty(KEYBOARD_INSET_PROPERTY, next)
    }

    // visualViewport fires `resize` and `scroll` on every frame of the keyboard
    // animation and of pinch-zoom panning; coalesce to one write per frame.
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(write)
    }

    write()
    viewport?.addEventListener("resize", schedule)
    viewport?.addEventListener("scroll", schedule)

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      viewport?.removeEventListener("resize", schedule)
      viewport?.removeEventListener("scroll", schedule)
      // Reset rather than remove: the contract says the property is always a
      // valid px length, including in hosts that never loaded globals.css.
      root.style.setProperty(KEYBOARD_INSET_PROPERTY, "0px")
    }
  }, [])
}
