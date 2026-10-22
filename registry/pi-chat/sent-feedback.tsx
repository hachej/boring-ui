'use client';

import { ChevronDownIcon } from 'lucide-react';
import { readableElement } from '@hachej/boring-feedback/format';
import type { FeedbackReport } from '@hachej/boring-feedback/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '../utils/utils';
import { useChatText } from './labels';

/** Sent page comments are inert text, not live page targets or evidence that a change was accepted. */
export function SentFeedback({ report, align = 'end' }: { readonly report: FeedbackReport; readonly align?: 'start' | 'end' }) {
  const { labels } = useChatText();
  const notes = (report.notes ?? []).filter(note => note.text.trim());
  if (!notes.length) return null;
  const title = labels.feedbackSent(notes.length);
  const long = notes.length > 3 || report.said.length + notes.reduce((length, note) => length + note.text.length, 0) > 400;
  const content = <CardContent className="flex flex-col gap-3">
    {report.said && <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{report.said}</p>}
    <ol className="m-0 flex list-none flex-col gap-3 p-0">
      {notes.map((note, at) => {
        const anchor = note.anchor === undefined ? undefined : report.anchors[note.anchor];
        const target = typeof anchor?.fallback === 'string' ? readableElement(anchor.fallback).name : undefined;
        return <li key={at} data-testid="message-feedback-note" className="flex min-w-0 flex-col gap-1 [overflow-wrap:anywhere]">
          {target && <CardDescription>{target}</CardDescription>}<p className="m-0 whitespace-pre-wrap">{note.text}</p>
        </li>;
      })}
    </ol>
  </CardContent>;
  // CardHeader is an inline-size container; a collapsed card cannot size itself from its title.
  const card = { size: 'sm' as const, 'data-testid': 'message-feedback', role: 'group', 'aria-label': title, className: cn('w-80 max-w-[85%]', align === 'end' && 'ml-auto') };
  if (!long) return <Card {...card}><CardHeader><CardTitle>{title}</CardTitle></CardHeader>{content}</Card>;
  return <Collapsible data-slot="card" render={<Card {...card} />}>
    <CardHeader><CardTitle><CollapsibleTrigger data-slot="button" render={<Button variant="ghost" className="group w-full justify-between whitespace-normal text-left" />}>
      {title}<ChevronDownIcon data-icon="inline-end" aria-hidden="true" className="group-aria-expanded:rotate-180" />
    </CollapsibleTrigger></CardTitle></CardHeader>
    <CollapsibleContent>{content}</CollapsibleContent>
  </Collapsible>;
}
