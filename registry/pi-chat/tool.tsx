'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ToolCall, ToolResultMessage } from '@earendil-works/pi-ai';
import { AlertCircleIcon, CheckCircle2Icon, ChevronDownIcon, CircleDashedIcon, Loader2Icon, WrenchIcon } from 'lucide-react';
import { cn } from '../utils/utils';
import { defaultChatLabels, useChatText } from './labels';
import type { ChatLabels } from './labels';

export type ToolStatus = 'running' | 'completed' | 'failed' | 'unfinished';
export interface ToolEntry { readonly key: string; readonly call: ToolCall; readonly result: ToolResultMessage | undefined; readonly status: ToolStatus; readonly custom?: ReactNode }

const STATUS_LABEL = { running: 'toolRunning', completed: 'toolCompleted', failed: 'toolFailedStatus', unfinished: 'toolUnfinished' } as const satisfies Record<ToolStatus, keyof ChatLabels>;
const PREVIEW_KEYS = ['path', 'file_path', 'filePath', 'command', 'query', 'pattern', 'name', 'url', 'id'];

/** A short hint of what the call acts on, shown next to its name. */
export function preview(args: ToolCall['arguments']): string {
  const values = args as Record<string, unknown>;
  for (const key of PREVIEW_KEYS) { const value = values[key]; if (typeof value === 'string' && value) return value.replace(/\s+/g, ' ').slice(0, 90); }
  const first = Object.values(values).find(value => typeof value === 'string' && value);
  return typeof first === 'string' ? first.replace(/\s+/g, ' ').slice(0, 90) : '';
}

export function StatusIcon({ status, className }: { readonly status: ToolStatus; readonly className?: string }) {
  const cls = cn('size-4 shrink-0', className);
  if (status === 'running') return <Loader2Icon aria-hidden="true" className={cn(cls, 'animate-spin text-muted-foreground motion-reduce:animate-none')} />;
  if (status === 'completed') return <CheckCircle2Icon aria-hidden="true" className={cn(cls, 'text-emerald-600')} />;
  if (status === 'failed') return <AlertCircleIcon aria-hidden="true" className={cn(cls, 'text-destructive')} />;
  return <CircleDashedIcon aria-hidden="true" className={cn(cls, 'text-muted-foreground')} />;
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return <div className="space-y-1.5"><h4 className="m-0 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{title}</h4>{children}</div>;
}

/** A short live label for a call: "Reading notes/consultation.md", "Running bash", "Running working_git" (`labels.toolActivity`). */
export function liveLabel(call: ToolCall, labels: Pick<ChatLabels, 'toolActivity'> = defaultChatLabels): string {
  return labels.toolActivity(call.name, preview(call.arguments));
}

/**
 * One tool call: name, status, collapsible arguments and result. Failed calls open by default.
 * `compact` renders it as a row of an activity block (no card border); `details: false` (expert mode, successful call) has nothing to expand.
 */
export function ToolCard({ entry, onOpenImage, compact = false, details = true }: { readonly entry: ToolEntry; readonly compact?: boolean; readonly details?: boolean; readonly onOpenImage?: (image: Extract<ToolResultMessage['content'][number], { type: 'image' }>) => void }) {
  const { labels } = useChatText();
  const { call, result, status } = entry;
  const [chosen, setChosen] = useState<boolean | undefined>();
  const open = details && (chosen ?? status === 'failed');
  const setOpen = (update: (value: boolean) => boolean) => setChosen(update(open));
  const hint = preview(call.arguments);
  return <div data-testid="tool-card" data-boring="tool-card" data-status={status} data-tool={call.name} data-call-id={call.id}
    className={cn('overflow-hidden', compact ? 'rounded-md' : 'rounded-lg border bg-card text-card-foreground', !compact && (status === 'failed' ? 'border-destructive/40' : 'border-border'))}>
    <button type="button" aria-expanded={details ? open : undefined} disabled={!details} onClick={() => setOpen(value => !value)}
      className={cn('flex w-full items-center gap-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset motion-reduce:transition-none',
        compact ? 'min-h-7 px-2 py-1 pointer-coarse:min-h-10' : 'min-h-9 px-3 py-1.5 pointer-coarse:min-h-10', details ? 'cursor-pointer hover:bg-muted/50' : 'cursor-default')}>
      <WrenchIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <span data-testid="tool-name" className="shrink-0 font-mono text-[13px] font-medium">{call.name}</span>
      {hint && <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{hint}</span>}
      {!hint && <span className="flex-1" />}
      <span data-testid="tool-status" className={cn('inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium', status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
        <StatusIcon status={status} className="size-3" />{labels[STATUS_LABEL[status]]}</span>
      {details && <ChevronDownIcon aria-hidden="true" className={cn('size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', open && 'rotate-180')} />}
    </button>
    {details && <div hidden={!open} data-testid="tool-details" className="space-y-3 border-t border-border bg-muted/20 p-3">
      <Section title={labels.arguments}><pre className="m-0 max-h-60 overflow-auto rounded-md bg-muted/60 p-2.5 font-mono text-xs leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]">{JSON.stringify(call.arguments, null, 2)}</pre></Section>
      {result && <Section title={result.isError ? labels.error : labels.result}>
        <div role={result.isError ? 'alert' : undefined} className={cn('space-y-2 rounded-md p-2.5', result.isError ? 'bg-destructive/10 text-destructive' : 'bg-muted/60')}>
          {result.content.map((part, index) => part.type === 'text'
            ? <pre key={index} className="m-0 max-h-72 overflow-auto font-mono text-xs leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]">{part.text}</pre>
            : <button key={index} type="button" disabled={!onOpenImage} onClick={() => onOpenImage?.(part)} className="cursor-pointer rounded-md border border-border bg-background px-2 py-1 text-xs disabled:cursor-default">{labels.openImageResult}</button>)}
          {result.content.length === 0 && <span className="text-xs text-muted-foreground">{labels.emptyResult}</span>}
        </div></Section>}
    </div>}
  </div>;
}

