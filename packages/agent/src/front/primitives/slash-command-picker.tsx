"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../lib'
import { usePickerKeyboard } from './use-picker-keyboard'

interface Command {
  name: string
  description: string
}

interface SlashCommandPickerProps {
  query: string
  commands: Command[]
  onSelect: (name: string) => void
  onDismiss: () => void
}

export function SlashCommandPicker({ query, commands, onSelect, onDismiss }: SlashCommandPickerProps) {
  const filtered = useMemo(
    () => commands.filter((c) => c.name.toLowerCase().startsWith(query.toLowerCase())),
    [commands, query],
  )
  const [activeIdx, setActiveIdx] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  // Reset selection when filter changes
  useEffect(() => setActiveIdx(0), [filtered.length])

  const handleSelect = useCallback((idx: number) => {
    if (filtered[idx]) onSelect(filtered[idx].name)
  }, [filtered, onSelect])

  usePickerKeyboard({ count: filtered.length, activeIdx, setActiveIdx, listRef, onSelect: handleSelect, onDismiss })

  if (filtered.length === 0) return null

  return (
    <div className="mb-1 w-full overflow-hidden rounded-lg border border-border/60 bg-popover shadow-lg">
      <ul ref={listRef} className="max-h-48 overflow-y-auto py-1" role="listbox" aria-label="Commands">
        {filtered.map((cmd, i) => (
          <li
            key={cmd.name}
            role="option"
            aria-selected={i === activeIdx}
            className={cn(
              'flex cursor-pointer flex-col gap-0.5 px-3 py-1.5 text-[12px]',
              i === activeIdx ? 'bg-accent/10 text-foreground' : 'text-muted-foreground hover:bg-muted/40',
            )}
            onMouseEnter={() => setActiveIdx(i)}
            onMouseDown={(e) => { e.preventDefault(); onSelect(cmd.name) }}
          >
            <span className="font-medium text-foreground/80">/{cmd.name}</span>
            <span className="truncate text-[11px] opacity-50">{cmd.description}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
