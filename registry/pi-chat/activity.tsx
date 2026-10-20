'use client';

import { useEffect, useState } from 'react';
import type { ToolResultMessage } from '@earendil-works/pi-ai';
import { AlertCircleIcon, BrainIcon, CheckIcon, CircleSlashIcon } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from '@/components/ui/trace';
import { ToolCard, liveLabel } from './tool';
import type { ToolStatus } from './tool';
import type { Step } from './rows';
import { useChatText } from './labels';
import type { ChatLabels } from './labels';

type Image = Extract<ToolResultMessage['content'][number], { type: 'image' }>;
export type ActivityState = 'running' | 'done' | 'failed' | 'stopped';

const stepStatus = (step: Step): ToolStatus => step.kind === 'tool' ? step.entry.status : step.kind === 'host' ? step.step.status === 'done' ? 'completed' : step.step.status : step.streaming ? 'running' : 'completed';

function summary(steps: readonly Step[], labels: ChatLabels): string | undefined {
  const counts = new Map<string, number>();
  for (const step of steps) if (step.kind === 'tool') counts.set(step.entry.call.name, (counts.get(step.entry.call.name) ?? 0) + 1);
  if (counts.size === 0 || counts.size > 4) return undefined;
  return [...counts].map(([name, count]) => `${labels.toolNoun(name)}${count > 1 ? ` ×${count}` : ''}`).join(' · ');
}

function header(steps: readonly Step[], state: ActivityState, streaming: boolean, labels: ChatLabels): string {
  if (state === 'running') {
    const running = steps.filter(step => stepStatus(step) === 'running');
    const current = streaming ? running[running.length - 1] : running[0];
    if (!current) return labels.thinkingStep;
    return current.kind === 'tool' ? liveLabel(current.entry.call, labels) : labels.thinkingStep;
  }
  if (state === 'failed') {
    const failed = steps.flatMap(step => step.kind === 'tool' && step.entry.status === 'failed' ? [step.entry.call.name] : []);
    return labels.activityFailed(failed.length, [...new Set(failed)].join(' · '));
  }
  const used = summary(steps, labels);
  const tools = steps.some(step => step.kind === 'tool');
  if (used === undefined && state !== 'stopped') return tools ? labels.activityMany(steps.length) : labels.activityThought;
  return labels.activityUsed(used ?? (tools ? labels.activityMany(steps.length) : labels.activityThought), state === 'stopped');
}

function Thinking({ text, streaming, details }: { readonly text: string; readonly streaming: boolean; readonly details: boolean }) {
  const { labels } = useChatText();
  const [open, setOpen] = useState(false);
  const line = <TraceLine {...(streaming ? { status: 'running' } : {})}>
    <TraceIcon><BrainIcon /></TraceIcon><TraceTitle>{streaming ? labels.thinking : labels.reasoning}</TraceTitle>
  </TraceLine>;
  return <TraceCollapsible data-testid="reasoning" data-state={open ? 'open' : 'closed'} data-streaming={streaming ? 'true' : undefined} open={details && open} onOpenChange={setOpen}>
    {details ? <TraceCollapsibleTrigger className="min-h-8 max-sm:min-h-11 pointer-coarse:min-h-11">{line}</TraceCollapsibleTrigger> : line}
    {details && <TraceCollapsibleContent><div data-testid="reasoning-text" className="max-h-72 overflow-y-auto text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</div></TraceCollapsibleContent>}
  </TraceCollapsible>;
}

/** Presentation only: native Pi steps and host cards keep their existing ownership and order. */
export function ActivityBlock({ steps, state, streaming, developer, onOpenImage, participant, active = true }: {
  readonly active?: boolean;
  /** Shared traces default closed and show one working indicator, in the summary or the active step. */
  readonly participant?: string;
  readonly steps: readonly Step[]; readonly state: ActivityState; readonly streaming: boolean; readonly developer: boolean; readonly onOpenImage?: (image: Image) => void;
}) {
  const { labels } = useChatText();
  const [chosen, setChosen] = useState<boolean | undefined>();
  useEffect(() => { if (participant) setChosen(undefined); }, [participant, streaming]);
  const open = chosen ?? (!participant && state === 'failed');
  const runningIndex = steps.reduce((found, step, index) => found === -1 && stepStatus(step) === 'running' ? index : found, -1);
  const current = steps[runningIndex];
  const progress = current?.kind === 'host' ? ` · ${current.step.label} (${runningIndex + 1}/${steps.length})` : '';
  const Icon = state === 'running' ? Spinner : state === 'failed' ? AlertCircleIcon : state === 'stopped' ? CircleSlashIcon : CheckIcon;
  return <Trace data-testid="activity" data-boring="activity" data-state={state} data-open={open ? 'true' : 'false'} className="my-1.5">
    <TraceCollapsible open={open} onOpenChange={setChosen}>
      <TraceCollapsibleTrigger className="min-h-8 max-sm:min-h-11 pointer-coarse:min-h-11">
        <TraceLine {...(state === 'running' ? { status: 'running' } : state === 'failed' ? { status: 'error' } : {})}>
          {!(participant && (open || state === 'running' && !active)) && <TraceIcon><Icon aria-hidden="true" /></TraceIcon>}
          <TraceTitle data-testid="activity-label">{participant ? streaming ? `${labels.sharedWorking(participant)}${progress}` : labels.steps(steps.length) : header(steps, state, streaming, labels)}</TraceTitle>
          {!participant && <TraceDescription data-testid="activity-count">{labels.steps(steps.length)}</TraceDescription>}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Trace data-testid="activity-steps">
          {steps.map((step, index) => <div key={step.key} data-testid="activity-step" data-kind={step.kind} data-status={stepStatus(step)}>
            {step.kind === 'host' ? <ToolCard entry={{ key: step.key, step: step.step }} details={false} active={!participant || open && active && streaming && index === runningIndex} /> : step.kind === 'tool'
              ? <ToolCard entry={step.entry} details={developer || step.entry.status === 'failed'} {...(onOpenImage ? { onOpenImage } : {})} />
              : <Thinking text={step.text} streaming={step.streaming} details={developer} />}
          </div>)}
        </Trace>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  </Trace>;
}
