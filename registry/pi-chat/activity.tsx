'use client';

import { useState } from 'react';
import type { ToolResultMessage } from '@earendil-works/pi-ai';
import { AlertCircleIcon, BrainIcon, CheckIcon, ChevronDownIcon, CircleSlashIcon, Loader2Icon } from 'lucide-react';
import { Shimmer } from './shimmer';
import { ToolCard, liveLabel } from './tool';
import type { ToolStatus } from './tool';
import type { Step } from './rows';
import { cn } from '../utils/utils';
import { useChatText } from './labels';
import type { ChatLabels } from './labels';

type Image = Extract<ToolResultMessage['content'][number], { type: 'image' }>;
export type ActivityState = 'running' | 'done' | 'failed' | 'stopped';

const stepStatus = (step: Step): ToolStatus => step.kind === 'tool' ? step.entry.status : step.streaming ? 'running' : 'completed';

/** "Used read ×3 · working_git" for a few kinds of calls, "Worked through N steps" otherwise. */
function summary(steps: readonly Step[], labels: ChatLabels): string | undefined {
  const counts = new Map<string, number>();
  for (const step of steps) if (step.kind === 'tool') counts.set(step.entry.call.name, (counts.get(step.entry.call.name) ?? 0) + 1);
  if (counts.size === 0 || counts.size > 4) return undefined;
  return [...counts].map(([name, count]) => `${labels.toolNoun(name)}${count > 1 ? ` ×${count}` : ''}`).join(' · ');
}

/** The one line a block shows while collapsed. Running: only the current step, replaced in place. */
function header(steps: readonly Step[], state: ActivityState, streaming: boolean, labels: ChatLabels): string {
  if (state === 'running') {
    const running = steps.filter(step => stepStatus(step) === 'running');
    // While the model is still writing, the newest call is the current one; while calls execute, the first unfinished call is.
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

function Dot({ status }: { readonly status: ToolStatus }) {
  return <span aria-hidden="true" className={cn('relative z-10 mt-2 size-2 shrink-0 rounded-full ring-4 ring-background',
    status === 'running' ? 'animate-pulse bg-foreground motion-reduce:animate-none' : status === 'failed' ? 'bg-destructive' : status === 'completed' ? 'bg-muted-foreground/60' : 'bg-muted-foreground/30')} />;
}

function Thinking({ text, streaming, details }: { readonly text: string; readonly streaming: boolean; readonly details: boolean }) {
  const { labels } = useChatText();
  const [open, setOpen] = useState(false);
  return <div data-testid="reasoning" data-state={open ? 'open' : 'closed'} data-streaming={streaming ? 'true' : undefined}>
    <button type="button" aria-expanded={details ? open : undefined} disabled={!details} onClick={() => setOpen(value => !value)}
      className={cn('flex min-h-7 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset', details ? 'cursor-pointer hover:bg-muted/50' : 'cursor-default')}>
      <BrainIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <Shimmer active={streaming} className="flex-1">{streaming ? labels.thinking : labels.reasoning}</Shimmer>
      {details && <ChevronDownIcon className={cn('size-4 shrink-0 transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden="true" />}
    </button>
    {open && details && <div data-testid="reasoning-text" className="mx-2 mb-1 max-h-72 overflow-y-auto border-l-2 border-border pl-3 text-[13px] leading-6 whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{text}</div>}
  </div>;
}

/**
 * One activity block per uninterrupted run of steps in an assistant turn, after the "Chain of Thought" component of
 * Vercel AI Elements: a collapsible header and, inside, a vertical rail of steps with a status dot, a label and
 * optional detail. Collapsed it is one fixed-height line (the current step while running, a summary afterwards);
 * rows stay in the DOM, hidden. Failures open the block. `expert` rows have nothing to expand for successful calls.
 */
export function ActivityBlock({ steps, state, streaming, developer, onOpenImage }: {
  readonly steps: readonly Step[]; readonly state: ActivityState; readonly streaming: boolean; readonly developer: boolean; readonly onOpenImage?: (image: Image) => void;
}) {
  const { labels } = useChatText();
  const [chosen, setChosen] = useState<boolean | undefined>();
  const open = chosen ?? state === 'failed';
  const label = header(steps, state, streaming, labels);
  const Icon = state === 'running' ? null : state === 'failed' ? AlertCircleIcon : state === 'stopped' ? CircleSlashIcon : CheckIcon;
  return <div data-testid="activity" data-boring="activity" data-state={state} data-open={open ? 'true' : 'false'} className="my-1.5">
    <button type="button" aria-expanded={open} onClick={() => setChosen(!open)}
      className="flex h-9 w-full cursor-pointer items-center gap-2 max-sm:h-10 pointer-coarse:h-10 rounded-lg border border-border bg-muted/40 px-3 text-left text-[13px] text-muted-foreground outline-none transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none">
      {Icon ? <Icon aria-hidden="true" className={cn('size-3.5 shrink-0', state === 'failed' ? 'text-destructive' : state === 'done' ? 'text-emerald-600' : '')} />
        : <Loader2Icon aria-hidden="true" className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />}
      <span data-testid="activity-label" aria-live={state === 'running' ? 'off' : undefined} className={cn('min-w-0 flex-1 truncate', state === 'failed' && 'text-destructive')}>
        <Shimmer active={state === 'running'}>{label}</Shimmer></span>
      <span data-testid="activity-count" className="shrink-0 text-xs tabular-nums text-muted-foreground/80">{labels.steps(steps.length)}</span>
      <ChevronDownIcon aria-hidden="true" className={cn('size-4 shrink-0 transition-transform motion-reduce:transition-none', open && 'rotate-180')} />
    </button>
    <div hidden={!open} data-testid="activity-steps" className="relative mt-2 pl-1.5">
      <div aria-hidden="true" className="absolute top-3 bottom-3 left-[9px] w-px bg-border" />
      <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
        {steps.map(step => <li key={step.key} data-testid="activity-step" data-kind={step.kind} data-status={stepStatus(step)} className="flex min-w-0 gap-2">
          <Dot status={stepStatus(step)} />
          <div className="min-w-0 flex-1">{step.kind === 'tool'
            ? <ToolCard entry={step.entry} compact details={developer || step.entry.status === 'failed'} {...(onOpenImage ? { onOpenImage } : {})} />
            : <Thinking text={step.text} streaming={step.streaming} details={developer} />}</div>
        </li>)}
      </ol>
    </div>
  </div>;
}
