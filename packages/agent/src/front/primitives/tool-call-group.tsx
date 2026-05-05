"use client"

import { getToolName, isToolUIPart } from 'ai'
import type { UIMessage } from 'ai'
import { ChevronRightIcon } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

  const [isOpen, setIsOpen] = useState(true)
  const hasAutoClosedRef = useRef(false)

  // Auto-close after all tools settle (brief delay so result is visible)
  useEffect(() => {
    if (isSettled && !hasAutoClosedRef.current) {
      hasAutoClosedRef.current = true
      const t = setTimeout(() => setIsOpen(false), 700)
      return () => clearTimeout(t)
    }
  }, [isSettled])

  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open)
    // Manual reopen = user wants it open; stop auto-close from firing again
    if (open) hasAutoClosedRef.current = true
  }, [])

  const title = useMemo(() => buildTitle(tools, isSettled), [tools, isSettled])

  return (
    <Collapsible open={isOpen} onOpenChange={handleOpenChange} className="not-prose my-2">
      <CollapsibleTrigger
        className={cn(
          'flex w-full items-center gap-1.5 text-left text-[11px] transition-opacity',
          'text-muted-foreground/60 hover:text-muted-foreground',
          isOpen ? 'opacity-100' : 'opacity-55 hover:opacity-80',
        )}
      >
        <ChevronRightIcon
          className={cn(
            'size-3 shrink-0 transition-transform duration-200',
            isOpen && 'rotate-90',
          )}
        />
        {!isSettled ? (
          <Shimmer as="span" duration={1.5} className="text-[11px] font-medium">
            {title}
          </Shimmer>
        ) : (
          <span className={cn('font-medium', hasError && 'text-destructive/70')}>{title}</span>
        )}
        {hasError && (
          <span className="ml-0.5 text-[10px] text-destructive/55">(with errors)</span>
        )}
      </CollapsibleTrigger>

      <CollapsibleContent
        className={cn(
          'data-[state=closed]:animate-out data-[state=open]:animate-in',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:slide-out-to-top-1 data-[state=open]:slide-in-from-top-1',
        )}
      >
        <div className="relative mt-2 pl-[18px]">
          {/* Vertical thread connecting tools to the group trigger */}
          <div className="absolute left-[5px] top-0 bottom-2 w-px bg-border/35" />
          <div className="flex flex-col gap-0">
            {tools.map(({ part, key }) => {
              if (!isToolUIPart(part)) return null
              const tp = part as unknown as ToolPart
              const name = getToolName(part as Parameters<typeof getToolName>[0])
              const render = resolveToolRenderer(name, mergedToolRenderers)
              return <div key={key}>{render({ ...tp, toolName: name })}</div>
            })}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
})

ToolCallGroup.displayName = 'ToolCallGroup'
