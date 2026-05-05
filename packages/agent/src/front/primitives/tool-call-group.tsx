"use client"

import { getToolName, isToolUIPart } from 'ai'
import type { UIMessage } from 'ai'
import { ChevronRightIcon } from 'lucide-react'
import { memo, useCallback, useMemo, useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@boring/ui'
import { resolveToolRenderer, type ToolPart, type ToolRendererOverrides } from '../bareToolRenderers'
import { cn } from '../lib'
import { Shimmer } from './shimmer'

export type GroupedToolEntry = { part: UIMessage['parts'][number]; key: string }

function isSettledState(state: string): boolean {
  return (
    state === 'output-available' ||
    state === 'output-error' ||
    state === 'output-denied' ||
    state === 'approval-responded'
  )
}

const TOOL_NOUNS: Record<string, string> = {
  bash: 'command',
  read: 'read',
  write: 'write',
  edit: 'edit',
  find: 'find',
  grep: 'search',
  ls: 'list',
  exec_ui: 'UI action',
  get_ui_state: 'UI state',
}

function buildTitle(tools: GroupedToolEntry[], settled: boolean): string {
  const counts = new Map<string, number>()
  for (const { part } of tools) {
    if (!isToolUIPart(part)) continue
    const name = getToolName(part as Parameters<typeof getToolName>[0])
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }

  const segments = [...counts.entries()].map(([name, count]) => {
    const noun = TOOL_NOUNS[name] ?? name
    return count > 1 ? `${noun} ×${count}` : noun
  })

  const verb = settled ? 'Used' : 'Using'
  return `${verb} ${segments.join(' · ')}`
}

interface ToolCallGroupProps {
  tools: GroupedToolEntry[]
  mergedToolRenderers: ToolRendererOverrides
}

export const ToolCallGroup = memo(({ tools, mergedToolRenderers }: ToolCallGroupProps) => {
  const isSettled = tools.every(({ part }) => {
    if (!isToolUIPart(part)) return true
    return isSettledState((part as unknown as ToolPart).state)
  })

  const hasError = tools.some(({ part }) => {
    if (!isToolUIPart(part)) return false
    return (part as unknown as ToolPart).state === 'output-error'
  })

  // Always start collapsed — the header is the live status.
  // User expands only when they want to inspect individual calls.
  const [isOpen, setIsOpen] = useState(false)

  const handleOpenChange = useCallback((open: boolean) => setIsOpen(open), [])

  const title = useMemo(() => buildTitle(tools, isSettled), [tools, isSettled])

  return (
    <Collapsible open={isOpen} onOpenChange={handleOpenChange} className="not-prose my-1.5">
      <CollapsibleTrigger
        className={cn(
          'group/trigger flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
          'border border-border/40 bg-card/40 text-muted-foreground/70',
          'hover:border-border/70 hover:bg-card/70 hover:text-muted-foreground',
          hasError && 'border-destructive/30 text-destructive/60 hover:text-destructive/80',
        )}
      >
        <ChevronRightIcon
          className={cn(
            'size-3 shrink-0 transition-transform duration-150',
            isOpen && 'rotate-90',
          )}
        />
        {!isSettled ? (
          <Shimmer as="span" duration={1.5}>
            {title}
          </Shimmer>
        ) : (
          <span>{title}</span>
        )}
        <span className="ml-0.5 tabular-nums text-muted-foreground/40">
          {tools.length}
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-[boring-collapse-close_200ms_ease] data-[state=open]:animate-[boring-collapse-open_200ms_ease]">
        <div className="relative mt-1.5 pl-[18px]">
          <div className="absolute left-[5px] top-0 bottom-2 w-px bg-border/35" />
          <div className="flex flex-col gap-0">
            {tools.map(({ part, key }) => {
              if (!isToolUIPart(part)) return null
              const tp = part as unknown as ToolPart
              const name = getToolName(part as Parameters<typeof getToolName>[0])
              const render = resolveToolRenderer(name, mergedToolRenderers)
              return <div key={key} className="min-w-0">{render({ ...tp, toolName: name })}</div>
            })}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
})

ToolCallGroup.displayName = 'ToolCallGroup'
