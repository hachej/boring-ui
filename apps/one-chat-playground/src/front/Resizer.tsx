import { useCallback, useEffect, useRef, useState } from 'react'
import { CHAT_WIDTH_DEFAULT, clampChatWidth, readStoredChatWidth, storeChatWidth } from './resize'

/**
 * Owns the chat-column width: exposes it as a CSS variable on the shell and
 * renders the drag handle. While dragging, the shell gets `data-resizing` so
 * the stage's iframes stop swallowing pointer events.
 */
export function useChatWidth() {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? CHAT_WIDTH_DEFAULT : readStoredChatWidth(window.innerWidth),
  )
  const [resizing, setResizing] = useState(false)

  const apply = useCallback((next: number) => {
    const clamped = clampChatWidth(next, window.innerWidth)
    setWidth(clamped)
    storeChatWidth(clamped)
  }, [])

  useEffect(() => {
    const onResize = () => setWidth((w) => clampChatWidth(w, window.innerWidth))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return { width, resizing, setResizing, apply }
}

interface ResizerProps {
  width: number
  onChange: (width: number) => void
  onResizingChange: (resizing: boolean) => void
}

export function Resizer({ width, onChange, onResizingChange }: ResizerProps) {
  const startRef = useRef<{ x: number; width: number } | null>(null)

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    startRef.current = { x: event.clientX, width }
    onResizingChange(true)
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current
    if (!start) return
    onChange(start.width + (event.clientX - start.x))
  }
  const end = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return
    startRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    onResizingChange(false)
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16
    if (event.key === 'ArrowLeft') onChange(width - step)
    else if (event.key === 'ArrowRight') onChange(width + step)
    else if (event.key === 'Home') onChange(0)
    else if (event.key === 'End') onChange(Number.MAX_SAFE_INTEGER)
    else return
    event.preventDefault()
  }

  return (
    <div
      className="one-chat-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat"
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      data-testid="one-chat-resizer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onChange(CHAT_WIDTH_DEFAULT)}
      onKeyDown={onKeyDown}
    />
  )
}
