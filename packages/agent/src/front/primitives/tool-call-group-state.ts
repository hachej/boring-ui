export const TOOL_GROUP_VISUAL_STATES = ['running', 'settled', 'failed', 'aborted', 'approval-needed', 'workspace-not-ready'] as const
export type ToolGroupVisualState = typeof TOOL_GROUP_VISUAL_STATES[number]
export const RUNNING_TOOL_GROUP_VISUAL_STATE: ToolGroupVisualState = 'running'

export const TOOL_GROUP_VISUAL_PRESENTATION = {
  running: {
    verb: 'Using',
    dotClassName: 'bg-amber-500/70',
    triggerClassName: '',
  },
  settled: {
    verb: 'Used',
    dotClassName: 'bg-emerald-500/70',
    triggerClassName: '',
  },
  failed: {
    verb: 'Failed',
    dotClassName: 'bg-destructive ring-2 ring-destructive/20',
    triggerClassName: '',
  },
  aborted: {
    verb: 'Stopped',
    dotClassName: 'bg-muted-foreground/55',
    triggerClassName: 'border-border/50 text-muted-foreground/60 hover:text-muted-foreground/80',
  },
  'approval-needed': {
    verb: 'Needs approval',
    dotClassName: 'bg-amber-500/70',
    triggerClassName: '',
  },
  'workspace-not-ready': {
    verb: 'Waiting for',
    dotClassName: 'bg-amber-500/70',
    triggerClassName: '',
  },
} satisfies Record<ToolGroupVisualState, {
  verb: string
  dotClassName: string
  triggerClassName: string
}>
