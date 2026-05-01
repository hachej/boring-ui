"use client"

import { useEffect, useState } from "react"

function readMatches(maxWidth: number): boolean {
  if (typeof window === "undefined") return false
  return window.innerWidth < maxWidth
}

export function useViewportBreakpoint(maxWidth = 1024): boolean {
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
