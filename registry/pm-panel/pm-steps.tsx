'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import type { ConversationView, EntryRecord } from '@earendil-works/pi-durable';
import { CheckIcon } from 'lucide-react';
import type { NativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { Spinner } from '@/components/ui/spinner';
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceIcon, TraceLine, TraceTitle } from '@/components/ui/trace';
import type { PmText } from './pm-text';

/** One line of the app panel's step list: a tool the PM ran, in plain words. A failed or unfinished step is `stopped` (a neutral dot). */
export interface PmStep { readonly key: string; readonly label: string; readonly status: 'running' | 'done' | 'stopped' }
export interface PmTurnSteps {
  readonly steps: readonly PmStep[];
  /** The turn is the conversation's last and its run is still going. */
  readonly running: boolean;
  /** Reply text came after the last step: the list folds to its summary. */
  readonly replied: boolean;
}

/** The line of a tool: its own name in the map, then its `prefix_*` family, then `stepUnknown`. Never the raw name. */
export function stepLabel(name: string, text: PmText): string {
  const family = name.includes('_') ? `${name.slice(0, name.indexOf('_'))}_*` : undefined;
  return (Object.hasOwn(text.steps, name) ? text.steps[name] : family && Object.hasOwn(text.steps, family) ? text.steps[family] : undefined) ?? text.stepUnknown;
}

type Part = { readonly type?: unknown; readonly text?: unknown; readonly id?: unknown; readonly name?: unknown };
const record = (value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/**
 * The steps of the turn the user entry `turn` starts, up to the next user message: the tool calls of its committed rounds and of the live
 * generation (when it is the last turn), matched with their results. Read from the native view only; the chat's own rows are untouched.
 */
export function turnSteps(view: Pick<ConversationView, 'entries' | 'docs'> | undefined, turn: EntryRecord['id'], text: PmText): PmTurnSteps {
  const entries = view?.entries ?? [];
  const at = entries.findIndex(entry => entry.id === turn);
  if (at < 0) return { steps: [], running: false, replied: false };
  let end = entries.findIndex((entry, index) => index > at && entry.model?.some(message => message.role === 'user'));
  if (end < 0) end = entries.length;
  const live = record(view?.docs['pi.live']);
  const running = end === entries.length && Boolean(live?.['run']);
  const calls: { readonly id: string; readonly name: string }[] = [], results = new Map<string, boolean>();
  let textAfter = false;
  const read = (content: readonly Part[]) => {
    for (const part of content) {
      if (part.type === 'toolCall' && typeof part.id === 'string' && typeof part.name === 'string') { calls.push({ id: part.id, name: part.name }); textAfter = false; }
      else if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) textAfter = true;
    }
  };
  for (const entry of entries.slice(at + 1, end)) for (const message of entry.model ?? []) {
    if (message.role === 'assistant') read(message.content as readonly Part[]);
    else if (message.role === 'toolResult') results.set(message.toolCallId, message.isError);
  }
  const generation = record(record(live?.['generation'])?.['message']);
  if (running && Array.isArray(generation?.['content'])) read(generation['content'] as readonly Part[]);
  const steps = calls.map((call, index): PmStep => {
    const failed = results.get(call.id);
    return { key: `${index}:${call.id}`, label: stepLabel(call.name, text), status: failed === undefined ? running ? 'running' : 'stopped' : failed ? 'stopped' : 'done' };
  });
  return { steps, running, replied: textAfter };
}

/**
 * The app panel's calm step list for one turn (C7, decided 2026-10-29): muted 13px lines, a spinner, a check or a neutral dot, no arguments,
 * results or errors. Open while the PM works, folded to « n étapes ▸ » once the reply arrives or the run ends; a tap opens or folds it.
 * Before the first step of a running turn it is the one « Préparation… » line.
 */
export function PmSteps({ controller, turn, text }: { readonly controller: NativeChatController; readonly turn: EntryRecord['id']; readonly text: PmText }) {
  const view = useSyncExternalStore(controller.subscribe, () => controller.getSnapshot().view, () => controller.getSnapshot().view);
  const { steps, running, replied } = useMemo(() => turnSteps(view, turn, text), [view, turn, text]);
  const [chosen, setChosen] = useState<boolean>();
  // The calm type lives on this wrapper: 13px muted lines, 14px icons, a 44px tap target on the summary (the shadcn parts stay unstyled).
  const calm = 'text-[13px] [&_[data-slot=trace-line]]:text-[13px] [&_[data-slot=trace-line]]:min-h-6 [&_[data-slot=trace-collapsible-trigger]]:min-h-11 [&_svg]:size-3.5';
  if (!steps.length) return running ? <p role="status" data-testid="pm-preparing" className={`m-0 flex min-h-6 items-center gap-2 text-muted-foreground ${calm}`}><Spinner aria-hidden="true" />{text.preparing}</p> : null;
  const open = chosen ?? (running && !replied);
  return <div className={calm}><Trace data-testid="pm-steps" data-state={running ? 'running' : 'done'} data-open={open ? 'true' : 'false'} className="gap-0">
    <TraceCollapsible open={open} onOpenChange={setChosen}>
      <TraceCollapsibleTrigger data-testid="pm-steps-summary">
        <TraceLine><TraceTitle>{text.stepsSummary(steps.length)}</TraceTitle></TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="mt-0 flex flex-col gap-1">
        {steps.map(step => <TraceLine key={step.key} data-testid="pm-step" data-step-status={step.status}>
          <TraceIcon>{step.status === 'running' ? <Spinner /> : step.status === 'done' ? <CheckIcon /> : <span data-testid="pm-step-dot" className="size-1.5 rounded-pm-round bg-muted-foreground/60" />}</TraceIcon>
          <TraceTitle>{step.label}</TraceTitle>
        </TraceLine>)}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  </Trace></div>;
}
