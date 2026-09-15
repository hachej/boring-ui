import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CHAT_WIDTH_DEFAULT,
  clampChatHeight,
  clampChatWidth,
  readStoredChatHeight,
  readStoredChatWidth,
  storeChatHeight,
  storeChatWidth,
} from './resize'

const MOBILE_QUERY = '(max-width: 720px)'

/** True under the phone breakpoint; tracks the media query live. */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(MOBILE_QUERY).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setMobile(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return mobile
}

/**
 * Owns the chat size: width beside the app on wide screens, height as a bottom
 * sheet on phones. Exposed as CSS variables on the shell. While dragging, the
 * shell gets `data-resizing` so the stage's iframes stop swallowing the pointer.
 */
export function useChatSize(mobile: boolean) {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? CHAT_WIDTH_DEFAULT : readStoredChatWidth(window.innerWidth),
  )
  const [height, setHeight] = useState(() =>
    typeof window === 'undefined' ? 320 : readStoredChatHeight(window.innerHeight),
  )
  const [resizing, setResizing] = useState(false)

  const apply = useCallback(
    (next: number) => {
      if (mobile) {
        const clamped = clampChatHeight(next, window.innerHeight)
        setHeight(clamped)
        storeChatHeight(clamped)
      } else {
        const clamped = clampChatWidth(next, window.innerWidth)
        setWidth(clamped)
        storeChatWidth(clamped)
      }
    },
    [mobile],
  )

  useEffect(() => {
    const onResize = () => {
      setWidth((w) => clampChatWidth(w, window.innerWidth))
      setHeight((h) => clampChatHeight(h, window.innerHeight))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const reset = useCallback(() => {
    apply(mobile ? Number.NaN : CHAT_WIDTH_DEFAULT)
  }, [apply, mobile])

  return { size: mobile ? height : width, width, height, resizing, setResizing, apply, reset }
}

interface ResizerProps {
  /** Current chat size along the drag axis (width, or height on phones). */
  size: number
  orientation: 'vertical' | 'horizontal'
  onChange: (size: number) => void
  onReset: () => void
  onResizingChange: (resizing: boolean) => void
}

/**
 * The drag handle. Vertical orientation separates chat (left) from app
 * (right); horizontal separates app (top) from the chat sheet (bottom), so
 * dragging up makes the chat taller.
 */
export function Resizer({ size, orientation, onChange, onReset, onResizingChange }: ResizerProps) {
  const startRef = useRef<{ pos: number; size: number } | null>(null)
  const horizontal = orientation === 'horizontal'
  const pos = (e: React.PointerEvent) => (horizontal ? e.clientY : e.clientX)

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    startRef.current = { pos: pos(event), size }
    onResizingChange(true)
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current
    if (!start) return
    const delta = pos(event) - start.pos
    onChange(horizontal ? start.size - delta : start.size + delta)
  }
  const end = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return
    startRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    onResizingChange(false)
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16
    const grow = horizontal ? 'ArrowUp' : 'ArrowRight'
    const shrink = horizontal ? 'ArrowDown' : 'ArrowLeft'
    if (event.key === shrink) onChange(size - step)
    else if (event.key === grow) onChange(size + step)
    else if (event.key === 'Home') onChange(0)
    else if (event.key === 'End') onChange(Number.MAX_SAFE_INTEGER)
    else return
    event.preventDefault()
  }

  return (
    <div
      className="one-chat-resizer"
      role="separator"
      aria-orientation={orientation}
      aria-label="Resize chat"
      aria-valuenow={size}
      tabIndex={0}
      title="Drag to resize. Double-tap to reset."
      data-testid="one-chat-resizer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  )
}
