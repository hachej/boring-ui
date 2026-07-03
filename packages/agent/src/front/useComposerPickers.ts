import { useCallback, useState, type RefObject } from 'react'
import { detectMention, type MentionState } from './primitives/mention-picker'

interface PickedMentionedFile {
  path: string
  token: string
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

function mentionToken(path: string): string {
  return `@${path.split('/').pop() ?? path}`
}

function disambiguatedMentionToken(path: string): string {
  const normalized = path.replace(/^\/+/, '')
  return `@${normalized || path}`
}

function tokenForPickedPath(path: string, existing: readonly PickedMentionedFile[]): string {
  const token = mentionToken(path)
  const collides = existing.some((file) => file.path !== path && file.token === token)
  return collides ? disambiguatedMentionToken(path) : token
}

function valueHasMentionToken(value: string, token: string): boolean {
  const mentionBoundary = '[^A-Za-z0-9_./-]'
  return new RegExp(`(^|${mentionBoundary})${escapeRegExp(token)}($|${mentionBoundary})`).test(value)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function useComposerPickers({
  textareaRef,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>
}) {
  const [mentionState, setMentionState] = useState<MentionState | null>(null)
  const [slashQuery, setSlashQuery] = useState<string | null>(null)
  const [mentionedFiles, setMentionedFiles] = useState<PickedMentionedFile[]>([])

  const reconcileMentionedFiles = useCallback((value: string) => {
    setMentionedFiles((prev) => prev.filter((file) => valueHasMentionToken(value, file.token)))
  }, [])

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
    reconcileMentionedFiles(ta.value)
  }, [reconcileMentionedFiles, textareaRef])

  const selectMention = useCallback((path: string) => {
    const ta = textareaRef.current
    if (!ta || !mentionState) return
    const { anchorStart, anchorEnd } = mentionState
    const token = tokenForPickedPath(path, mentionedFiles)
    const newValue = ta.value.slice(0, anchorStart) + token + ta.value.slice(anchorEnd)
    setTextareaValue(ta, newValue)
    const newCursor = anchorStart + token.length
    ta.setSelectionRange(newCursor, newCursor)
    ta.focus()
    setMentionState(null)
    setMentionedFiles((prev) => prev.some((file) => file.path === path) ? prev : [...prev, { path, token }])
  }, [mentionState, mentionedFiles, textareaRef])

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
    mentionedFiles: mentionedFiles.map((file) => file.path),
    clearMentionedFiles,
    dismissMention,
    dismissSlash,
    handleComposerChange,
    selectMention,
    selectSlashCommand,
  }
}
