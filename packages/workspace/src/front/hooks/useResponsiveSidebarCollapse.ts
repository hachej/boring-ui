"use client"

import { useCallback, useEffect, useRef } from "react"

export interface UseResponsiveSidebarCollapseOptions {
  isNarrowViewport: boolean
  isCollapsed: boolean
  setCollapsed: (collapsed: boolean) => void
}

export function useResponsiveSidebarCollapse({
  isNarrowViewport,
  isCollapsed,
  setCollapsed,
}: UseResponsiveSidebarCollapseOptions): () => void {
  const collapsedRef = useRef(isCollapsed)
  const autoCollapsedRef = useRef(false)
  const prevNarrowRef = useRef<boolean | null>(null)

  useEffect(() => {
    collapsedRef.current = isCollapsed
  }, [isCollapsed])

  useEffect(() => {
    const prevNarrow = prevNarrowRef.current
    const enteringNarrow = prevNarrow !== true && isNarrowViewport
    const leavingNarrow = prevNarrow === true && !isNarrowViewport

    prevNarrowRef.current = isNarrowViewport

    if (isNarrowViewport && enteringNarrow && !collapsedRef.current) {
      autoCollapsedRef.current = true
      setCollapsed(true)
      return
    }

    if (leavingNarrow && autoCollapsedRef.current) {
      autoCollapsedRef.current = false
      setCollapsed(false)
    }
  }, [isNarrowViewport, setCollapsed])

  return useCallback(() => {
    autoCollapsedRef.current = false
  }, [])
}
