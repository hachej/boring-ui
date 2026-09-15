import { useCallback, useEffect, useRef, useState } from 'react'
import type { MobileChatMode } from '../shared/stage'
import {
  CHAT_WIDTH_DEFAULT,
  clampChatHeight,
  clampChatWidth,
  readStoredChatHeight,
  readStoredChatWidth,
  storeChatHeight,
  storeChatWidth,
} from './resize'

const MOBILE_QUERY = '(max-width: 719px)'

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
  /** Current chat size along the drag axis on desktop. */
  size?: number
  orientation: 'vertical' | 'horizontal'
  onChange?: (size: number) => void
  onReset?: () => void
  onResizingChange: (resizing: boolean) => void
  /** Phone snap state. When present, drag commits to half/full/button. */
  mobileMode?: Exclude<MobileChatMode, 'button'>
  onExpand?: () => void
  onHide?: () => void
}

/**
 * The drag handle. Vertical orientation separates chat (left) from app
 * (right); horizontal separates app (top) from the chat sheet (bottom), so
 * dragging up makes the chat taller.
 */
export function Resizer({
  size = 0,
  orientation,
  onChange,
  onReset,
  onResizingChange,
  mobileMode,
  onExpand,
  onHide,
}: ResizerProps) {
  const startRef = useRef<{ pos: number; size: number; at: number; pointerId: number } | null>(null)
  const horizontal = orientation === 'horizontal'
  const pos = (event: React.PointerEvent) => (horizontal ? event.clientY : event.clientX)

  const clearTransform = (target: HTMLDivElement) => {
    target.closest<HTMLElement>('.one-chat-mobile-sheet')?.style.removeProperty('transform')
  }
  const finish = (target: HTMLDivElement) => {
    startRef.current = null
    clearTransform(target)
    onResizingChange(false)
  }
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || startRef.current) return
    event.currentTarget.setPointerCapture(event.pointerId)
    startRef.current = { pos: pos(event), size, at: performance.now(), pointerId: event.pointerId }
    onResizingChange(true)
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current
    if (!start || start.pointerId !== event.pointerId) return
    const delta = pos(event) - start.pos
    if (!mobileMode) {
      onChange?.(horizontal ? start.size - delta : start.size + delta)
      return
    }
    const sheet = event.currentTarget.closest<HTMLElement>('.one-chat-mobile-sheet')
    if (!sheet) return
    const visibleDelta = mobileMode === 'full'
      ? Math.max(0, delta)
      : Math.max(-window.innerHeight * 0.45, delta)
    sheet.style.transform = `translateY(${Math.round(visibleDelta)}px)`
  }
  const end = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current
    if (!start || start.pointerId !== event.pointerId) return
    const delta = pos(event) - start.pos
    const elapsed = Math.max(1, performance.now() - start.at)
    const velocity = delta / elapsed
    if (mobileMode === 'half' && (delta <= -80 || velocity <= -0.45)) onExpand?.()
    else {
      const downThreshold = mobileMode === 'full' ? window.innerHeight * 0.3 : 80
      if (mobileMode && (delta >= downThreshold || velocity >= 0.55)) onHide?.()
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    finish(event.currentTarget)
  }
  const cancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    finish(event.currentTarget)
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (mobileMode) {
      if (event.key === 'ArrowUp' || event.key === 'End') onExpand?.()
      else if (event.key === 'ArrowDown' || event.key === 'Home') onHide?.()
      else return
      event.preventDefault()
      return
    }
    const step = event.shiftKey ? 64 : 16
    const grow = horizontal ? 'ArrowUp' : 'ArrowRight'
    const shrink = horizontal ? 'ArrowDown' : 'ArrowLeft'
    if (event.key === shrink) onChange?.(size - step)
    else if (event.key === grow) onChange?.(size + step)
    else if (event.key === 'Home') onChange?.(0)
    else if (event.key === 'End') onChange?.(Number.MAX_SAFE_INTEGER)
    else return
    event.preventDefault()
  }

  return (
    <div
      className="one-chat-resizer"
      role="separator"
      aria-orientation={orientation}
      aria-label="Resize chat"
      {...(mobileMode
        ? { 'aria-valuetext': mobileMode === 'half' ? 'Half screen' : 'Full screen' }
        : { 'aria-valuenow': size })}
      tabIndex={0}
      title={mobileMode ? 'Drag up to expand or down to close.' : 'Drag to resize. Double-tap to reset.'}
      data-testid="one-chat-resizer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={cancel}
      onLostPointerCapture={(event) => {
        if (startRef.current) finish(event.currentTarget)
      }}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  )
}
