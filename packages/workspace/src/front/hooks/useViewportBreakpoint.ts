"use client"

import { useEffect, useState } from "react"

import { WIDE_MIN_WIDTH } from "../layout/breakpoints"

function readMatches(maxWidth: number): boolean {
  if (typeof window === "undefined") return false
  return window.innerWidth < maxWidth
}

export function useViewportBreakpoint(maxWidth: number = WIDE_MIN_WIDTH): boolean {
  const [matches, setMatches] = useState(() => readMatches(maxWidth))

  useEffect(() => {
    const onResize = () => {
      setMatches(readMatches(maxWidth))
    }

    onResize()
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("resize", onResize)
    }
  }, [maxWidth])

  return matches
}
