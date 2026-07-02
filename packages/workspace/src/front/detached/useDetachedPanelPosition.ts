"use client"

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import type { DetachedPanelPosition, DetachedPanelSize } from "./detachedPanelTypes"

const DEFAULT_SIZE: DetachedPanelSize = { width: 520, height: 720 }
const VIEWPORT_PADDING = 16

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function clampPosition(position: DetachedPanelPosition, size: DetachedPanelSize): DetachedPanelPosition {
  if (typeof window === "undefined") return position
  const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - size.width - VIEWPORT_PADDING)
  const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - size.height - VIEWPORT_PADDING)
  return {
    left: clamp(position.left, VIEWPORT_PADDING, maxLeft),
    top: clamp(position.top, VIEWPORT_PADDING, maxTop),
  }
}

export function useDetachedPanelPosition(initialPosition: DetachedPanelPosition, size: Partial<DetachedPanelSize> = {}) {
  const resolvedSize = { ...DEFAULT_SIZE, ...size }
  const [position, setPosition] = useState(() => clampPosition(initialPosition, resolvedSize))
  const dragRef = useRef<{ x: number; y: number } | null>(null)

  const stopDrag = useCallback(() => {
    dragRef.current = null
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
  }, [])

  const onPointerMove = useCallback((event: PointerEvent) => {
    const last = dragRef.current
    if (!last) return
    const dx = event.clientX - last.x
    const dy = event.clientY - last.y
    dragRef.current = { x: event.clientX, y: event.clientY }
    setPosition((current) => clampPosition({ left: current.left + dx, top: current.top + dy }, resolvedSize))
  }, [resolvedSize.height, resolvedSize.width])

  const startDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null
    if (target?.closest("button,a,input,textarea,select")) return
    dragRef.current = { x: event.clientX, y: event.clientY }
    document.body.style.cursor = "grabbing"
    document.body.style.userSelect = "none"
  }, [])

  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", stopDrag)
    return () => {
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", stopDrag)
      stopDrag()
    }
  }, [onPointerMove, stopDrag])

  useEffect(() => {
    setPosition(clampPosition(initialPosition, resolvedSize))
  }, [initialPosition.left, initialPosition.top, resolvedSize.height, resolvedSize.width])

  return { position, size: resolvedSize, startDrag }
}
