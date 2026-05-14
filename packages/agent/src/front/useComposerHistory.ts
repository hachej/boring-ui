import { useCallback, useRef, type RefObject } from 'react'

const HISTORY_RESET_IGNORED_KEYS = ['Shift', 'Meta', 'Control', 'Alt', 'CapsLock']

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

export function useComposerHistory({
  userHistory,
  textareaRef,
  disabled,
}: {
  userHistory: string[]
  textareaRef: RefObject<HTMLTextAreaElement | null>
  disabled: boolean
}) {
  const historyIdxRef = useRef(-1)
  const draftRef = useRef('')

  return useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget
    textareaRef.current = ta
    if (disabled) return
    if (e.key === 'ArrowUp') {
      if (ta.selectionStart !== 0 || ta.selectionEnd !== 0) return
      if (userHistory.length === 0) return
      e.preventDefault()
      if (historyIdxRef.current === -1) draftRef.current = ta.value
      const next = Math.min(historyIdxRef.current + 1, userHistory.length - 1)
      historyIdxRef.current = next
      const text = userHistory[userHistory.length - 1 - next]
      setTextareaValue(ta, text)
      ta.setSelectionRange(0, 0)
    } else if (e.key === 'ArrowDown') {
      if (historyIdxRef.current === -1) return
      e.preventDefault()
      const next = historyIdxRef.current - 1
      historyIdxRef.current = next
      const text = next === -1 ? draftRef.current : userHistory[userHistory.length - 1 - next]
      setTextareaValue(ta, text)
      ta.setSelectionRange(text.length, text.length)
    } else if (!HISTORY_RESET_IGNORED_KEYS.includes(e.key)) {
      historyIdxRef.current = -1
    }
  }, [disabled, textareaRef, userHistory])
}
