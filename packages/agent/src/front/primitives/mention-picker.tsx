"use client"

import { useEffect, useRef, useState, useCallback } from 'react'
import { cn } from '../lib'

export interface MentionState {
  query: string
  anchorStart: number
  anchorEnd: number
}

interface MentionPickerProps {
  mention: MentionState
  onSelect: (path: string) => void
  onDismiss: () => void
  /** Base URL prefix for the files search API */
  apiBaseUrl?: string
}

function basename(path: string): string {
  return path.split('/').pop() ?? path
}

function highlight(text: string, query: string): { before: string; match: string; after: string } | null {
  if (!query) return null
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return null
  return { before: text.slice(0, idx), match: text.slice(idx, idx + query.length), after: text.slice(idx + query.length) }
}

export function MentionPicker({ mention, onSelect, onDismiss, apiBaseUrl = '' }: MentionPickerProps) {
  const [results, setResults] = useState<string[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  // Fetch results with debounce
  useEffect(() => {
    setActiveIdx(0)
    const url = `${apiBaseUrl}/api/v1/files/search?q=${encodeURIComponent(mention.query || '*')}&limit=8`
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      fetch(url, { signal: ctrl.signal })
        .then((r) => r.ok ? r.json() : null)
        .then((data: { results?: string[] } | null) => {
          if (data?.results) setResults(data.results.slice(0, 8))
        })
        .catch(() => {})
    }, 120)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [mention.query, apiBaseUrl])

  // Keyboard navigation exposed via a native keydown on the window while open
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      if (results[activeIdx]) onSelect(results[activeIdx])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onDismiss()
    }
  }, [results, activeIdx, onSelect, onDismiss])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [handleKeyDown])

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.children[activeIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  if (results.length === 0) return null

  return (
    <div className="mb-1 w-full overflow-hidden rounded-lg border border-border/60 bg-popover shadow-lg">
      <ul ref={listRef} className="max-h-48 overflow-y-auto py-1" role="listbox" aria-label="File suggestions">
        {results.map((path, i) => {
          const hl = highlight(basename(path), mention.query)
          return (
            <li
              key={path}
              role="option"
              aria-selected={i === activeIdx}
              className={cn(
                'flex cursor-pointer flex-col gap-0.5 px-3 py-1.5 text-[12px]',
                i === activeIdx ? 'bg-accent/10 text-foreground' : 'text-muted-foreground hover:bg-muted/40',
              )}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={(e) => { e.preventDefault(); onSelect(path) }}
            >
              <span className="font-medium">
                {hl
                  ? <>{hl.before}<mark className="bg-transparent text-[color:var(--accent)]">{hl.match}</mark>{hl.after}</>
                  : basename(path)}
              </span>
              <span className="truncate text-[11px] opacity-50">{path}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Detects an `@mention` at/before the cursor position. Returns null if none. */
export function detectMention(value: string, cursorPos: number): MentionState | null {
  const before = value.slice(0, cursorPos)
  // Match @ at start or after whitespace, followed by non-whitespace chars up to cursor
  const match = before.match(/(^|[\s\n])@(\S*)$/)
  if (!match) return null
  const atIdx = before.lastIndexOf('@')
  return { query: match[2], anchorStart: atIdx, anchorEnd: cursorPos }
}
