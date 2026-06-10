"use client"

import { useEffect, useRef } from 'react'

/**
 * Shared keyboard navigation hook for floating pickers (mention, slash command).
 * Attaches to window in capture phase so the underlying textarea keeps focus.
 * Uses refs for callbacks so we only re-register when count/activeIdx changes.
 */
export function usePickerKeyboard({
  count,
  activeIdx,
  setActiveIdx,
  listRef,
  onSelect,
  onDismiss,
}: {
  count: number
  activeIdx: number
  setActiveIdx: React.Dispatch<React.SetStateAction<number>>
  listRef: React.RefObject<HTMLElement | null>
  onSelect: (idx: number) => void
  onDismiss: () => void
}) {
  const selectRef = useRef(onSelect)
  const dismissRef = useRef(onDismiss)
  useEffect(() => { selectRef.current = onSelect }, [onSelect])
  useEffect(() => { dismissRef.current = onDismiss }, [onDismiss])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        if (count <= 0) return
        e.preventDefault()
        setActiveIdx((i) => Math.min(i + 1, count - 1))
      } else if (e.key === 'ArrowUp') {
        if (count <= 0) return
        e.preventDefault()
        setActiveIdx((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (count <= 0) return
        e.preventDefault()
        selectRef.current(activeIdx)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        dismissRef.current()
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [count, activeIdx, setActiveIdx])

  useEffect(() => {
    const el = listRef.current?.children[activeIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, listRef])
}
