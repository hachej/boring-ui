"use client"

import { ChevronDownIcon } from 'lucide-react'
import { memo, useCallback, useMemo, useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@hachej/boring-ui-kit'
import {
  resolveToolRendererForPart,
  toToolPart,
  type ToolPart,
  type ToolRenderablePart,
  type ToolRendererOverrides,
} from '../bareToolRenderers'
import { cn } from '../lib'
import { Shimmer } from './shimmer'
import { getWorkspaceNotReadyStatus } from '../workspaceReadinessStatus'

export type GroupedToolEntry = { part: ToolRenderablePart; key: string }

function isSettledState(state: ToolPart['state']): boolean {
  return (
    state === 'output-available' ||
    state === 'output-error' ||
    state === 'output-denied' ||
    state === 'approval-responded' ||
    state === 'aborted'
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

function buildTitle(tools: ToolPart[], settled: boolean): string {
  const counts = new Map<string, number>()
  for (const part of tools) {
    counts.set(part.toolName, (counts.get(part.toolName) ?? 0) + 1)
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
  const toolParts = useMemo(() => tools
    .map(({ part, key }) => {
      const toolPart = toToolPart(part)
      return toolPart ? { part: toolPart, key } : null
    })
    .filter((entry): entry is { part: ToolPart; key: string } => Boolean(entry)), [tools])

  const isSettled = toolParts.every(({ part }) => isSettledState(part.state))

  const workspaceNotReady = toolParts.map(({ part }) => getWorkspaceNotReadyStatus(part.output)).find(Boolean)

  const hasError = toolParts.some(({ part }) => part.state === 'output-error') && !workspaceNotReady

  // Always start collapsed — the header is the live status.
  // User expands only when they want to inspect individual calls.
  const [isOpen, setIsOpen] = useState(false)

  const handleOpenChange = useCallback((open: boolean) => setIsOpen(open), [])

  const title = useMemo(() => buildTitle(toolParts.map(({ part }) => part), isSettled), [toolParts, isSettled])

  if (toolParts.length === 0) return null

  return (
    <Collapsible open={isOpen} onOpenChange={handleOpenChange} className="not-prose my-1.5">
      <CollapsibleTrigger
        className={cn(
          'group/trigger flex w-fit items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
          'border border-border/40 bg-card/40 text-muted-foreground/70',
          'hover:border-border/70 hover:bg-card/70 hover:text-muted-foreground',
          hasError && 'border-destructive/30 text-destructive/60 hover:text-destructive/80',
        )}
      >
        {/* State-coded dot: green settled, amber running, red error */}
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            hasError ? 'bg-destructive' : isSettled ? 'bg-emerald-500/70' : 'bg-amber-500/70',
          )}
        />
        <ChevronDownIcon
          className={cn(
            'size-3 shrink-0 transition-transform duration-150',
            isOpen && 'rotate-180',
          )}
        />
        {workspaceNotReady ? (
          <span>{workspaceNotReady.message}</span>
        ) : !isSettled ? (
          <Shimmer as="span" duration={1.5}>
            {title}
          </Shimmer>
        ) : (
          <span>{title}</span>
        )}
        <span className={cn(
          'ml-1 shrink-0 rounded-sm border border-border/40 px-1 tabular-nums',
          'text-[10px] text-muted-foreground/50',
        )}>
          {toolParts.length}
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-[boring-collapse-close_200ms_ease] data-[state=open]:animate-[boring-collapse-open_200ms_ease]">
        <div className="relative mt-1.5 pl-[18px]">
          <div className="absolute left-[5px] top-0 bottom-2 w-px bg-border/35" />
          <div className="flex flex-col gap-0">
            {toolParts.map(({ part, key }) => {
              const { renderer, part: resolvedPart, resolution } = resolveToolRendererForPart(part, mergedToolRenderers)
              return (
                <div
                  key={key}
                  className="min-w-0"
                  data-tool-call-id={resolvedPart.toolCallId}
                  data-tool-renderer-key={resolution.key}
                  data-tool-renderer-source={resolution.source}
                >
                  {renderer(resolvedPart)}
                </div>
              )
            })}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
})

ToolCallGroup.displayName = 'ToolCallGroup'
