import { useCallback, useState, type RefObject } from 'react'
import { detectMention, type MentionState } from './primitives/mention-picker'

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

export function useComposerPickers({
  textareaRef,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>
}) {
  const [mentionState, setMentionState] = useState<MentionState | null>(null)
  const [slashQuery, setSlashQuery] = useState<string | null>(null)
  const [mentionedFiles, setMentionedFiles] = useState<string[]>([])

  const handleComposerChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget
    textareaRef.current = ta
    const cursor = ta.selectionStart ?? ta.value.length
    const before = ta.value.slice(0, cursor)
    const slashMatch = before.match(/^\/(\S*)$/)
    if (slashMatch) {
      setSlashQuery(slashMatch[1])
      setMentionState(null)
    } else {
      setSlashQuery(null)
      setMentionState(detectMention(ta.value, cursor))
    }
  }, [textareaRef])

  const selectMention = useCallback((path: string) => {
    const ta = textareaRef.current
    if (!ta || !mentionState) return
    const { anchorStart, anchorEnd } = mentionState
    const token = `@${path.split('/').pop() ?? path}`
    const newValue = ta.value.slice(0, anchorStart) + token + ta.value.slice(anchorEnd)
    setTextareaValue(ta, newValue)
    const newCursor = anchorStart + token.length
    ta.setSelectionRange(newCursor, newCursor)
    ta.focus()
    setMentionState(null)
    setMentionedFiles((prev) => prev.includes(path) ? prev : [...prev, path])
  }, [mentionState, textareaRef])

  const selectSlashCommand = useCallback((name: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const newValue = `/${name} `
    setTextareaValue(ta, newValue)
    ta.setSelectionRange(newValue.length, newValue.length)
    ta.focus()
    setSlashQuery(null)
  }, [textareaRef])

  const clearMentionedFiles = useCallback(() => {
    setMentionedFiles([])
  }, [])

  const dismissMention = useCallback(() => {
    setMentionState(null)
  }, [])

  const dismissSlash = useCallback(() => {
    setSlashQuery(null)
  }, [])

  return {
    mentionState,
    slashQuery,
    mentionedFiles,
    clearMentionedFiles,
    dismissMention,
    dismissSlash,
    handleComposerChange,
    selectMention,
    selectSlashCommand,
  }
}
