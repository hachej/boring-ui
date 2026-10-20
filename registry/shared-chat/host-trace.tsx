'use client';
import { useEffect, useState } from 'react';
import { AlertCircleIcon, CheckIcon, WrenchIcon } from 'lucide-react';
import type { Step } from '@hachej/boring-ui-kit/shared-chat';
import { Spinner } from '@/components/ui/spinner';
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceIcon, TraceLine, TraceTitle } from '@/components/ui/trace';
import { useChatText } from './text';

/** Host observations only. This trace neither creates Pi tool calls nor runs work. */
export function HostTrace({ steps, participant, streaming, active }: { readonly steps: readonly Step[]; readonly participant: string; readonly streaming: boolean; readonly active: boolean }) {
  const { labels } = useChatText();
  const [chosen, setChosen] = useState<boolean | undefined>();
  useEffect(() => setChosen(undefined), [participant, streaming]);
  const open = chosen ?? false;
  const state = streaming ? 'running' : steps.some(step => step.status === 'failed') ? 'failed' : 'done';
  const running = steps.reduce((found, step, index) => found === -1 && step.status === 'running' ? index : found, -1);
  const current = steps[running];
  const progress = current ? ` · ${current.label} (${running + 1}/${steps.length})` : '';
  const Icon = streaming ? Spinner : state === 'failed' ? AlertCircleIcon : CheckIcon;
  return <Trace data-testid="activity" data-boring="activity" data-state={state} data-open={open ? 'true' : 'false'} className="my-1.5">
    <TraceCollapsible open={open} onOpenChange={setChosen}>
      <TraceCollapsibleTrigger className="min-h-8 max-sm:min-h-11 pointer-coarse:min-h-11">
        <TraceLine {...(streaming ? { status: 'running' } : state === 'failed' ? { status: 'error' } : {})}>
          {!(open || streaming && !active) && <TraceIcon><Icon aria-hidden="true" /></TraceIcon>}
          <TraceTitle data-testid="activity-label">{streaming ? `${labels.sharedWorking(participant)}${progress}` : labels.steps(steps.length)}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent><Trace data-testid="activity-steps">
        {steps.map((step, index) => {
          const StepIcon = step.status === 'running' ? open && active && streaming && index === running ? Spinner : WrenchIcon : step.status === 'done' ? CheckIcon : AlertCircleIcon;
          return <div key={index} data-testid="activity-step" data-kind="host" data-status={step.status === 'done' ? 'completed' : step.status}>
            <TraceLine data-testid="host-step" {...(step.status === 'running' ? { status: 'running' } : step.status === 'failed' ? { status: 'error' } : {})}>
              <TraceIcon><StepIcon aria-hidden="true" /></TraceIcon><TraceTitle><div className="flex min-w-0 flex-col"><span>{step.label}</span>{step.detail && <pre data-testid="step-detail" className="m-0 text-xs font-mono whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{step.detail}</pre>}</div></TraceTitle>
            </TraceLine>
          </div>;
        })}
      </Trace></TraceCollapsibleContent>
    </TraceCollapsible>
  </Trace>;
}
