"use client"

import { useEffect, useState } from "react"

import { COMPACT_MAX_WIDTH } from "./breakpoints"

/**
 * Width assumed when there is no DOM (SSR / node test env).
 *
 * Kept at a desktop width deliberately. Every consumer of these hooks gates a
 * whole shell (`mobileShell`, dockview vs. sheet chrome) and both defaults are
 * wrong half the time; what differs is the cost of being wrong. The hosts in
 * this repo are client-rendered, so the value only shows up in a server-rendered
 * embedding, where the workspace is a desktop IDE surface first — flipping to
 * mobile would make the common case paint the mobile shell and snap to desktop
 * on hydration, and would tear down/rebuild the dockview tree while doing it.
 * A server-rendered host that knows better should render the compact shell from
 * its own request-side hint rather than from a guess made here.
 */
const SSR_FALLBACK_WIDTH = 1200

/** `max-width` is inclusive, so mirror `width < COMPACT_MAX_WIDTH` with -1px. */
const COMPACT_MEDIA_QUERY = `(max-width: ${COMPACT_MAX_WIDTH - 1}px)`

function readWidth(): number {
  return typeof window === "undefined" ? SSR_FALLBACK_WIDTH : window.innerWidth
}

function readHeight(): number {
  if (typeof window === "undefined") return 0
  // visualViewport excludes the software keyboard and the collapsed URL bar,
  // which is what layout actually has to fit into.
  return window.visualViewport?.height ?? window.innerHeight
}

/**
 * Current layout-viewport width in px.
 *
 * `resize` fires once per frame through an iOS rotate animation and on every
 * keyboard open, and each state change here re-renders a shell that relayouts
 * dockview. So the handler is rAF-coalesced and the state write is skipped when
 * the width did not actually change (height-only resizes are the common case).
 *
 * Prefer {@link useIsCompactViewport} when all you need is the breakpoint
 * boolean — it re-renders on the flip, not on every pixel.
 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(readWidth)

  useEffect(() => {
    let frame = 0
    const measure = () => {
      frame = 0
      setWidth((previous) => (previous === window.innerWidth ? previous : window.innerWidth))
    }
    const onResize = () => {
      if (frame === 0) frame = requestAnimationFrame(measure)
    }

    // The mount-time state was read before hydration/layout; re-read once.
    measure()
    window.addEventListener("resize", onResize)
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      window.removeEventListener("resize", onResize)
    }
  }, [])

  return width
}

/**
 * Current *visual* viewport height in px — i.e. excluding the software keyboard.
 *
 * Same rAF-coalescing and same-value dedupe as {@link useViewportWidth}. Use it
 * only when a measurement has to reach JS; pure styling should go through
 * `100dvh` and `--keyboard-inset` instead.
 */
export function useViewportHeight(): number {
  const [height, setHeight] = useState(readHeight)

  useEffect(() => {
    let frame = 0
    const measure = () => {
      frame = 0
      setHeight((previous) => {
        const next = readHeight()
        return previous === next ? previous : next
      })
    }
    const onResize = () => {
      if (frame === 0) frame = requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener("resize", onResize)
    const viewport = window.visualViewport
    viewport?.addEventListener("resize", onResize)
    viewport?.addEventListener("scroll", onResize)
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      window.removeEventListener("resize", onResize)
      viewport?.removeEventListener("resize", onResize)
      viewport?.removeEventListener("scroll", onResize)
    }
  }, [])

  return height
}

/**
 * True in the compact (mobile-shell) tier, driven by `matchMedia` so the
 * consumer re-renders on the breakpoint flip only — not once per resize frame.
 */
export function useIsCompactViewport(): boolean {
  const [compact, setCompact] = useState(() => {
    if (typeof window === "undefined") return SSR_FALLBACK_WIDTH < COMPACT_MAX_WIDTH
    return window.matchMedia?.(COMPACT_MEDIA_QUERY).matches ?? window.innerWidth < COMPACT_MAX_WIDTH
  })

  useEffect(() => {
    const query = window.matchMedia?.(COMPACT_MEDIA_QUERY)
    if (!query) return
    const onChange = (event: MediaQueryListEvent) => setCompact(event.matches)

    setCompact(query.matches)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [])

  return compact
}
