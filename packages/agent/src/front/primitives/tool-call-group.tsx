"use client"

import { ChevronDownIcon } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@hachej/boring-ui-kit'
import {
  resolveToolRendererForPart,
  toToolPart,
  type ToolPart,
  type ToolRenderablePart,
  type ToolRendererOverrides,
} from '../bareToolRenderers'
import { cn } from '../lib'
import { getWorkspaceNotReadyStatus } from '../workspaceReadinessStatus'
import {
  RUNNING_TOOL_GROUP_VISUAL_STATE,
  TOOL_GROUP_VISUAL_PRESENTATION,
  type ToolGroupVisualState,
} from './tool-call-group-state'
export { RUNNING_TOOL_GROUP_VISUAL_STATE, TOOL_GROUP_VISUAL_STATES, type ToolGroupVisualState } from './tool-call-group-state'

export type GroupedToolEntry = { part: ToolRenderablePart; key: string }

function isInputRunningState(state: ToolPart['state']): boolean {
  return state === 'input-streaming' || state === 'input-available'
}

function isApprovalRequestedState(state: ToolPart['state']): boolean {
  return state === 'approval-requested'
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

function buildTitle(tools: ToolPart[], visualState: ToolGroupVisualState): string {
  const counts = new Map<string, number>()
  for (const part of tools) {
    counts.set(part.toolName, (counts.get(part.toolName) ?? 0) + 1)
  }

  const segments = [...counts.entries()].map(([name, count]) => {
    const noun = TOOL_NOUNS[name] ?? name
    return count > 1 ? `${noun} ×${count}` : noun
  })

  return `${TOOL_GROUP_VISUAL_PRESENTATION[visualState].verb} ${segments.join(' · ')}`
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainingSeconds}s`
}

interface ToolCallGroupProps {
  tools: GroupedToolEntry[]
  mergedToolRenderers: ToolRendererOverrides
}

function resolveVisualState({
  hasRunningTool,
  approvalNeeded,
  workspaceNotReady,
  hasError,
  hasAborted,
}: {
  hasRunningTool: boolean
  approvalNeeded: boolean
  workspaceNotReady: boolean
  hasError: boolean
  hasAborted: boolean
}): ToolGroupVisualState {
  if (hasRunningTool) return RUNNING_TOOL_GROUP_VISUAL_STATE
  if (approvalNeeded) return 'approval-needed'
  if (workspaceNotReady) return 'workspace-not-ready'
  if (hasError) return 'failed'
  if (hasAborted) return 'aborted'
  return 'settled'
}

export const ToolCallGroup = memo(({ tools, mergedToolRenderers }: ToolCallGroupProps) => {
  const toolParts = useMemo(() => tools
    .map(({ part, key }) => {
      const toolPart = toToolPart(part)
      return toolPart ? { part: toolPart, key } : null
    })
    .filter((entry): entry is { part: ToolPart; key: string } => Boolean(entry)), [tools])

  const workspaceNotReady = toolParts.map(({ part }) => getWorkspaceNotReadyStatus(part.output)).find(Boolean)

  const hasError = toolParts.some(({ part }) => part.state === 'output-error') && !workspaceNotReady
  const hasAborted = toolParts.some(({ part }) => part.state === 'aborted') && !workspaceNotReady
  const hasRunningTool = toolParts.some(({ part }) => isInputRunningState(part.state) && !getWorkspaceNotReadyStatus(part.output))
  const approvalNeeded = toolParts.some(({ part }) => isApprovalRequestedState(part.state))

  // Always start collapsed — the header is the live status.
  // User expands only when they want to inspect individual calls.
  const [isOpen, setIsOpen] = useState(false)

  const handleOpenChange = useCallback((open: boolean) => setIsOpen(open), [])

  const visualState = resolveVisualState({
    hasRunningTool,
    approvalNeeded,
    workspaceNotReady: Boolean(workspaceNotReady),
    hasError,
    hasAborted,
  })
  const isRunning = visualState === RUNNING_TOOL_GROUP_VISUAL_STATE
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const title = useMemo(() => buildTitle(toolParts.map(({ part }) => part), visualState), [toolParts, visualState])
  const elapsedLabel = isRunning ? `Running ${formatElapsed(elapsedSeconds)}` : null

  useEffect(() => {
    if (!isRunning) {
      setElapsedSeconds(0)
      return
    }

    const startedAt = Date.now()
    setElapsedSeconds(0)
    const interval = window.setInterval(() => {
      setElapsedSeconds(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)))
    }, 1000)
    return () => window.clearInterval(interval)
  }, [isRunning])

  if (toolParts.length === 0) return null

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={handleOpenChange}
      className="not-prose my-1.5"
      data-boring-agent-tool-state={visualState}
    >
      <CollapsibleTrigger
        aria-label={`Tool calls: ${title}`}
        className={cn(
          'group/trigger flex min-h-10 w-full items-center gap-2 rounded-[var(--radius-md)] px-2 py-1 text-[13px] font-normal',
          'border border-border/60 bg-muted/45 text-muted-foreground',
          'transition-colors hover:bg-muted/70 hover:text-foreground motion-reduce:transition-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          TOOL_GROUP_VISUAL_PRESENTATION[visualState].triggerClassName,
        )}
      >
        {/* State-coded dot: green settled, amber pending, red failed. */}
        <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
          <span
            data-boring-agent-part="tool-group-state-dot"
            className={cn(
              'size-1.5 rounded-full',
              TOOL_GROUP_VISUAL_PRESENTATION[visualState].dotClassName,
            )}
          />
        </span>
        <span data-boring-agent-part="tool-group-title">
          {workspaceNotReady ? workspaceNotReady.message : title}
        </span>
        {elapsedLabel ? (
          <span className="ml-1 shrink-0 tabular-nums text-[12px] text-muted-foreground/70">
            {elapsedLabel}
          </span>
        ) : null}
        <span className="ml-1 shrink-0 tabular-nums text-[12px] text-muted-foreground/70">
          {toolParts.length}
        </span>
        <ChevronDownIcon
          className={cn(
            'ml-auto size-4 shrink-0 transition-transform duration-150 motion-reduce:transition-none',
            isOpen && 'rotate-180',
          )}
        />
      </CollapsibleTrigger>

      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-[boring-collapse-close_200ms_ease] data-[state=open]:animate-[boring-collapse-open_200ms_ease]">
        <div
          data-boring-agent-part="tool-group-details"
          className="relative mt-1.5 w-full max-w-2xl pl-[18px]"
        >
          <div className="absolute left-[5px] top-0 bottom-2 w-px bg-border/35" />
          <div className="flex min-w-0 flex-col gap-1.5 [&_[data-boring-agent-part=tool-card]]:!my-0">
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
