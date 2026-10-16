'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ToolCall, ToolResultMessage } from '@earendil-works/pi-ai';
import { WrenchIcon } from 'lucide-react';
import { TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from '@/components/ui/trace';
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

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return <div className="space-y-1.5"><h4 className="m-0 text-xs font-medium tracking-wider text-muted-foreground uppercase">{title}</h4>{children}</div>;
}

/** A short live label for a call: "Reading notes/consultation.md", "Running bash", "Running working_git" (`labels.toolActivity`). */
export function liveLabel(call: ToolCall, labels: Pick<ChatLabels, 'toolActivity'> = defaultChatLabels): string {
  return labels.toolActivity(call.name, preview(call.arguments));
}

/** One Trace step. Failures open by default; quiet successful steps have no disclosure. */
export function ToolCard({ entry, onOpenImage, details = true }: { readonly entry: ToolEntry; readonly details?: boolean; readonly onOpenImage?: (image: Extract<ToolResultMessage['content'][number], { type: 'image' }>) => void }) {
  const { labels } = useChatText();
  const { call, result, status } = entry;
  const [chosen, setChosen] = useState<boolean | undefined>();
  const open = details && (chosen ?? status === 'failed');
  const hint = preview(call.arguments);
  const line = <TraceLine {...(status === 'running' ? { status: 'running' } : status === 'failed' ? { status: 'error' } : {})}>
    <TraceIcon><WrenchIcon /></TraceIcon>
    <TraceTitle><span data-testid="tool-name">{call.name}</span>{hint && ` · ${hint}`}</TraceTitle>
    <TraceDescription data-testid="tool-status" className="text-xs">{labels[STATUS_LABEL[status]]}</TraceDescription>
  </TraceLine>;
  return <TraceCollapsible data-testid="tool-card" data-boring="tool-card" data-status={status} data-tool={call.name} data-call-id={call.id} open={open} onOpenChange={setChosen}>
    {details ? <TraceCollapsibleTrigger className="min-h-8 max-sm:min-h-11 pointer-coarse:min-h-11">{line}</TraceCollapsibleTrigger> : line}
    {details && <TraceCollapsibleContent><div data-testid="tool-details" className="space-y-3 text-foreground">
      <Section title={labels.arguments}><pre className="m-0 max-h-60 overflow-auto rounded-md bg-muted/60 p-2.5 font-mono text-xs leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]">{JSON.stringify(call.arguments, null, 2)}</pre></Section>
      {result && <Section title={result.isError ? labels.error : labels.result}>
        <div role={result.isError ? 'alert' : undefined} className={cn('space-y-2 rounded-md p-2.5', result.isError ? 'bg-destructive/10 text-destructive' : 'bg-muted/60')}>
          {result.content.map((part, index) => part.type === 'text'
            ? <pre key={index} className="m-0 max-h-72 overflow-auto font-mono text-xs leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]">{part.text}</pre>
            : <button key={index} type="button" disabled={!onOpenImage} onClick={() => onOpenImage?.(part)} className="cursor-pointer rounded-md border border-border bg-background px-2 py-1 text-xs disabled:cursor-default">{labels.openImageResult}</button>)}
          {result.content.length === 0 && <span className="text-xs text-muted-foreground">{labels.emptyResult}</span>}
        </div></Section>}
    </div></TraceCollapsibleContent>}
  </TraceCollapsible>;
}

