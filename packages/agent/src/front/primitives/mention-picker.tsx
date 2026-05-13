"use client"

import { useEffect, useRef, useState, useCallback } from 'react'
import { cn } from '../lib'
import { usePickerKeyboard } from './use-picker-keyboard'

export interface MentionState {
  query: string
  anchorStart: number
  anchorEnd: number
}

interface MentionPickerProps {
  mention: MentionState
  onSelect: (path: string) => void
  onDismiss: () => void
  apiBaseUrl?: string
}

export function mentionSearchGlob(query: string): string {
  const trimmed = query.trim().replaceAll('*', '').replaceAll('?', '')
  if (!trimmed) return '*'
  return `*${trimmed}*`
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

  useEffect(() => {
    setActiveIdx(0)
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      fetch(`${apiBaseUrl}/api/v1/files/search?q=${encodeURIComponent(mentionSearchGlob(mention.query))}&limit=8`, { signal: ctrl.signal })
        .then((r) => r.ok ? r.json() : null)
        .then((data: { results?: string[] } | null) => {
          if (data?.results) setResults(data.results.slice(0, 8))
        })
        .catch(() => {})
    }, 120)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [mention.query, apiBaseUrl])

  const handleSelect = useCallback((idx: number) => {
    if (results[idx]) onSelect(results[idx])
  }, [results, onSelect])

  usePickerKeyboard({ count: results.length, activeIdx, setActiveIdx, listRef, onSelect: handleSelect, onDismiss })

  if (results.length === 0) return null

  return (
    <div className="mb-1 w-full overflow-hidden rounded-lg border border-border/60 bg-popover shadow-lg">
      <ul ref={listRef} className="max-h-48 overflow-y-auto py-1" role="listbox" aria-label="File suggestions">
        {results.map((path, i) => {
          const name = path.split('/').pop() ?? path
          const hl = highlight(name, mention.query)
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
                  : name}
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
  const match = before.match(/(^|[\s\n])@(\S*)$/)
  if (!match) return null
  const atIdx = before.lastIndexOf('@')
  return { query: match[2], anchorStart: atIdx, anchorEnd: cursorPos }
}
