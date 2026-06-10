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
        e.preventDefault()
        // Wrap around: past the last item loops back to the first.
        setActiveIdx((i) => (count === 0 ? 0 : (i + 1) % count))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        // Wrap around: up from the first item loops to the last.
        setActiveIdx((i) => (count === 0 ? 0 : (i - 1 + count) % count))
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (count > 0) {
          e.preventDefault()
          selectRef.current(activeIdx)
        } else {
          // No items to select — dismiss the picker and let the event fall through
          // so the underlying textarea can submit normally.
          dismissRef.current()
        }
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
