'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '../utils/utils';
import { CheckIcon, MessageCircleQuestionIcon } from '../_shared/icons';

/** A `decision` is a gate or a review: approve or refuse. A `question` takes a choice or free text. */
export type InlineQuestionKind = 'decision' | 'question';

export type InlineQuestionLabels = { decision: string; question: string; approve: string; refuse: string; send: string; placeholder: string; placeholderMore: string; replyInChat: string; approved: string; refused: string; answered: string };

export const inlineQuestionLabels: InlineQuestionLabels = {
  decision: 'Decision', question: 'Question', approve: 'Approve', refuse: 'Refuse', send: 'Send', placeholder: 'Type your answer', placeholderMore: 'Or type an answer',
  replyInChat: 'Reply in chat', approved: 'Approved', refused: 'Refused', answered: 'Answered',
};

export type InlineQuestionProps = {
  /** Identifies the question to the host; echoed back by `onAnswer`. */
  id: string;
  kind: InlineQuestionKind;
  /** The question as the agent asked it, in the person's language. */
  text: string;
  /** Who is asking (an agent or a gate), shown small above the question. */
  source?: string;
  /** A `question` with options offers up to four one-tap choices plus a free-text field; without options it is free text only. A `decision` ignores them. */
  options?: readonly string[];
  /** Set once answered: the controls give way to the answer, so the question stays readable in the history. */
  answered?: string;
  /** The block sends nothing. The host posts the answer under the signed-in person's own login, never a shared token. */
  onAnswer: (id: string, value: string) => void;
  /** Opens the full chat for a longer reply. Shown only when given. */
  onReplyInChat?: () => void;
  labels?: Partial<InlineQuestionLabels>;
  className?: string;
};

const tap = 'min-h-11 md:min-h-8';

/** A waiting question shown where it is mentioned. No border: a soft info tint for a decision, a soft warning tint for a question. */
export function InlineQuestion({ id, kind, text, source, options, answered, onAnswer, onReplyInChat, labels, className }: InlineQuestionProps) {
  const t = { ...inlineQuestionLabels, ...labels };
  const [draft, setDraft] = useState('');
  const decision = kind === 'decision';
  const choices = decision ? [t.approve, t.refuse] : (options ?? []).slice(0, 4);
  const send = () => { const value = draft.trim(); if (value) onAnswer(id, value); };
  if (answered !== undefined) {
    const said = decision ? (answered === t.approve ? t.approved : t.refused) : `${t.answered}: ${answered}`;
    return (
      <div role="group" aria-label={text} className={cn('flex min-w-0 flex-col gap-1 rounded-(--radius) bg-muted p-3 text-muted-foreground', className)}>
        <div className="flex items-start gap-2 text-sm font-medium"><CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" /><span>{text}</span></div>
        <span className="font-mono text-xs">{said}</span>
      </div>
    );
  }
  return (
    <div role="group" aria-label={text} className={cn('flex min-w-0 flex-col gap-2 rounded-(--radius) p-3', decision ? 'bg-info-soft text-info-soft-foreground' : 'bg-warning-soft text-warning-soft-foreground', className)}>
      <div className="flex min-w-0 items-center gap-2 font-mono text-xs">
        <span className="rounded-(--radius) bg-card px-2 text-card-foreground">{decision ? t.decision : t.question}</span>
        {source ? <span className="truncate opacity-80">{source}</span> : null}
      </div>
      <div className="flex min-w-0 items-start gap-2 text-sm font-medium">
        <MessageCircleQuestionIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{text}</span>
      </div>
      {choices.length > 0 || onReplyInChat ? (
        <div className="flex flex-wrap gap-1">
          {choices.map((choice, index) => (
            <Button key={choice} variant={index === 0 ? 'default' : 'secondary'} size="sm" className={tap} onClick={() => onAnswer(id, choice)}>{choice}</Button>
          ))}
          {onReplyInChat ? <Button variant="ghost" size="sm" className={tap} onClick={onReplyInChat}>{t.replyInChat}</Button> : null}
        </div>
      ) : null}
      {decision ? null : (
        <form className="flex gap-1" onSubmit={event => { event.preventDefault(); send(); }}>
          <Input value={draft} onChange={event => setDraft(event.target.value)} placeholder={choices.length ? t.placeholderMore : t.placeholder} aria-label={t.placeholder} className="min-w-0 flex-1" />
          <Button type="submit" size="sm" variant="secondary" className={tap} disabled={!draft.trim()}>{t.send}</Button>
        </form>
      )}
    </div>
  );
}
