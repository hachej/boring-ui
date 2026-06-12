"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../lib'
import { usePickerKeyboard } from './use-picker-keyboard'

interface Command {
  name: string
  description: string
  source?: 'local' | 'extension' | 'prompt' | 'skill'
  sourcePlugin?: string
}

interface SlashCommandPickerProps {
  /** Initial filter text, seeded from what the user typed after `/`. */
  query: string
  commands: Command[]
  onSelect: (name: string) => void
  onDismiss: () => void
}

const ALL_PLUGINS = '__all__'

/** Group a command lives under for the plugin selector: its skill bucket, its
 *  originating plugin/package, or "built-in" for local commands. */
function commandGroup(cmd: Command): string {
  if (cmd.source === 'skill') return 'skills'
  if (cmd.sourcePlugin) return cmd.sourcePlugin
  return 'built-in'
}

export function SlashCommandPicker({ query, commands, onSelect, onDismiss }: SlashCommandPickerProps) {
  const [plugin, setPlugin] = useState<string>(ALL_PLUGINS)
  const [searchQuery, setSearchQuery] = useState(query)
  const [activeIdx, setActiveIdx] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync the internal search query when the textarea content changes.
  useEffect(() => { setSearchQuery(query) }, [query])

  // Distinct plugin groups, for the selector chips at the top of the menu.
  const groups = useMemo(() => {
    const set = new Set(commands.map(commandGroup))
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [commands])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return commands.filter((c) => {
      if (plugin !== ALL_PLUGINS && commandGroup(c) !== plugin) return false
      if (!q) return true
      return c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
    })
  }, [commands, searchQuery, plugin])

  // Keep the active row in range as the list changes.
  useEffect(() => {
    setActiveIdx((i) => (filtered.length === 0 ? 0 : Math.min(i, filtered.length - 1)))
  }, [filtered.length])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onDismiss()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onDismiss])

  usePickerKeyboard({
    count: filtered.length,
    activeIdx,
    setActiveIdx,
    listRef,
    onSelect: (idx) => { if (filtered[idx]) onSelect(filtered[idx].name) },
    onDismiss,
  })

  return (
    <div ref={containerRef} className="mb-1 w-full overflow-hidden rounded-lg border border-border/60 bg-popover shadow-lg">

      {/* Search input */}
      <input
        ref={inputRef}
        aria-label="Search commands"
        type="text"
        value={searchQuery}
        onChange={(e) => { setSearchQuery(e.target.value); setActiveIdx(0) }}
        className="w-full border-b border-border/50 bg-transparent px-3 py-1.5 text-[12px] outline-none"
        autoComplete="off"
      />

      {/* Plugin selection */}
      <div className="flex flex-wrap gap-1 border-b border-border/50 px-2 py-1.5" role="tablist" aria-label="Filter by plugin">
        {[ALL_PLUGINS, ...groups].map((g) => {
          const selected = plugin === g
          return (
            <button
              key={g}
              type="button"
              role="tab"
              aria-selected={selected}
              onMouseDown={(e) => { e.preventDefault(); setPlugin(g); setActiveIdx(0) }}
              className={cn(
                'rounded-full px-2 py-px text-[10px] font-medium transition-colors',
                selected ? 'bg-accent/15 text-accent-foreground' : 'bg-muted/60 text-muted-foreground hover:bg-muted',
              )}
            >
              {g === ALL_PLUGINS ? 'All' : g}
            </button>
          )
        })}
      </div>

      {/* Command list — sized to show ~8 rows before scrolling. */}
      {filtered.length === 0 ? (
        <div className="px-3 py-2 text-[11px] text-muted-foreground">No matching commands.</div>
      ) : (
        <ul ref={listRef} className="max-h-80 overflow-y-auto py-1" role="listbox" aria-label="Commands">
          {filtered.map((cmd, i) => (
            <li
              key={cmd.name}
              role="option"
              aria-selected={i === activeIdx}
              // Full (untruncated) description on hover — skill descriptions in
              // particular are long and clipped in the row.
              title={cmd.description || undefined}
              className={cn(
                'flex cursor-pointer flex-col gap-0.5 px-3 py-1.5 text-[12px]',
                // Single highlight: hovering moves the active row (onMouseEnter),
                // so the active style is the only highlight — no separate hover bg.
                i === activeIdx ? 'bg-accent/10 text-foreground' : 'text-muted-foreground',
              )}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={(e) => { e.preventDefault(); onSelect(cmd.name) }}
            >
              <span className="flex items-center gap-1.5">
                <span className="font-medium text-foreground/80">/{cmd.name}</span>
                {cmd.source === 'skill' ? (
                  <>
                    <span className="rounded-sm bg-accent/15 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-accent-foreground">
                      skill
                    </span>
                    {cmd.sourcePlugin ? (
                      <span className="rounded-sm bg-muted px-1 py-px text-[9px] font-medium text-muted-foreground">
                        {cmd.sourcePlugin}
                      </span>
                    ) : null}
                  </>
                ) : cmd.sourcePlugin ? (
                  // Originating plugin/package for non-skill commands.
                  <span className="rounded-sm bg-muted px-1 py-px text-[9px] font-medium text-muted-foreground">
                    {cmd.sourcePlugin}
                  </span>
                ) : null}
              </span>
              <span className="truncate text-[11px] opacity-50">{cmd.description}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
