import { Children, cloneElement, isValidElement, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export default function Tooltip({
  label,
  shortcut = '',
  side = 'top',
  children,
  disabled = false,
}) {
  const anchorRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const tooltipId = useId().replace(/:/g, '')
  const showTimerRef = useRef(null)

  const content = useMemo(() => {
    const text = String(label || '').trim()
    if (!text) return ''
    const shortcutText = String(shortcut || '').trim()
    return shortcutText ? `${text} (${shortcutText})` : text
  }, [label, shortcut])

  const updatePosition = useCallback(() => {
    const node = anchorRef.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    const gap = 8
    const top = side === 'bottom' ? rect.bottom + gap : rect.top - gap
    const left = rect.left + (rect.width / 2)
    setPosition({ top, left })
  }, [side])

  const show = () => {
    if (disabled || !content) return
    updatePosition()
    setOpen(true)
  }

  const showWithDelay = () => {
    if (disabled || !content) return
    if (showTimerRef.current) clearTimeout(showTimerRef.current)
    showTimerRef.current = setTimeout(show, 400)
  }

  const hide = () => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return undefined
    const handleReposition = () => updatePosition()
    window.addEventListener('scroll', handleReposition, true)
    window.addEventListener('resize', handleReposition)
    return () => {
      window.removeEventListener('scroll', handleReposition, true)
      window.removeEventListener('resize', handleReposition)
    }
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return undefined
    const handleEscape = (event) => {
      if (event.key === 'Escape') hide()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [open])

  useEffect(() => {
    return () => {
      if (showTimerRef.current) {
        clearTimeout(showTimerRef.current)
      }
    }
  }, [])

  const tooltipDomId = `ui-tooltip-${tooltipId}`
  const describedBy = open ? tooltipDomId : undefined
  const child = Children.only(children)
  const enhancedChild = isValidElement(child)
    ? (() => {
        const existing = String(child.props['aria-describedby'] || '').trim()
        const merged = [existing, describedBy].filter(Boolean).join(' ')
        return cloneElement(child, { 'aria-describedby': merged || undefined })
      })()
    : child

  return (
    <span
      ref={anchorRef}
      className="ui-tooltip-anchor"
      onMouseEnter={showWithDelay}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {enhancedChild}
      {open && content && createPortal(
        <span
          id={tooltipDomId}
          role="tooltip"
          className={`ui-tooltip ui-tooltip-${side}`}
          style={{
            top: `${position.top}px`,
            left: `${position.left}px`,
          }}
        >
          <span className="ui-tooltip-label">{label}</span>
          {shortcut ? <kbd className="ui-tooltip-shortcut">{shortcut}</kbd> : null}
        </span>,
        document.body,
      )}
    </span>
  )
}
