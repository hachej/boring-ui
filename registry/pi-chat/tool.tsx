'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ToolCall, ToolResultMessage } from '@earendil-works/pi-ai';
import { AlertCircleIcon, CheckIcon, WrenchIcon } from 'lucide-react';
import type { Step as ChannelStep } from '@hachej/boring-ui-kit/shared-chat';
import { Spinner } from '@/components/ui/spinner';
import { TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from '@/components/ui/trace';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
export function ToolCard({ entry, onOpenImage, details = true }: { readonly entry: ToolEntry | { readonly key: string; readonly step: ChannelStep }; readonly details?: boolean; readonly onOpenImage?: (image: Extract<ToolResultMessage['content'][number], { type: 'image' }>) => void }) {
  const { labels } = useChatText();
  const [chosen, setChosen] = useState<boolean | undefined>();
  if ('step' in entry) {
    const { step } = entry;
    const Icon = step.status === 'running' ? Spinner : step.status === 'done' ? CheckIcon : AlertCircleIcon;
    return <TraceLine data-testid="host-step" {...(step.status === 'running' ? { status: 'running' } : step.status === 'failed' ? { status: 'error' } : {})}>
      <TraceIcon><Icon aria-hidden="true" /></TraceIcon><TraceTitle><div className="flex min-w-0 flex-col"><span>{step.label}</span>{step.detail && <pre data-testid="step-detail" className="m-0 text-xs font-mono whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{step.detail}</pre>}</div></TraceTitle>
    </TraceLine>;
  }
  const { call, result, status } = entry;
  const open = details && (chosen ?? status === 'failed');
  const hint = preview(call.arguments);
  const line = <TraceLine {...(status === 'running' ? { status: 'running' } : status === 'failed' ? { status: 'error' } : {})}>
    <TraceIcon><WrenchIcon /></TraceIcon>
    <TraceTitle><span data-testid="tool-name">{call.name}</span>{hint && ` · ${hint}`}</TraceTitle>
    <TraceDescription data-testid="tool-status">{labels[STATUS_LABEL[status]]}</TraceDescription>
  </TraceLine>;
  return <TraceCollapsible data-testid="tool-card" data-boring="tool-card" data-status={status} data-tool={call.name} data-call-id={call.id} open={open} onOpenChange={setChosen}>
    {details ? <TraceCollapsibleTrigger className="min-h-8 max-sm:min-h-11 pointer-coarse:min-h-11">{line}</TraceCollapsibleTrigger> : line}
    {details && <TraceCollapsibleContent><div data-testid="tool-details" className="flex flex-col gap-3">
      <Section title={labels.arguments}><Card><CardContent><pre className="m-0 max-h-60 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere]">{JSON.stringify(call.arguments, null, 2)}</pre></CardContent></Card></Section>
      {result && <Section title={result.isError ? labels.error : labels.result}>
        <Alert variant={result.isError ? 'destructive' : 'default'} role={result.isError ? 'alert' : 'status'}><AlertDescription>
          {result.content.map((part, index) => part.type === 'text'
            ? <pre key={index} className="m-0 max-h-72 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere]">{part.text}</pre>
            : <Button key={index} variant="outline" size="sm" disabled={!onOpenImage} onClick={() => onOpenImage?.(part)}>{labels.openImageResult}</Button>)}
          {result.content.length === 0 && <span>{labels.emptyResult}</span>}
        </AlertDescription></Alert></Section>}
    </div></TraceCollapsibleContent>}
  </TraceCollapsible>;
}

