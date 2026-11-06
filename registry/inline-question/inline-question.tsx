'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '../utils/utils';
import { CheckIcon, MessageCircleQuestionIcon } from '../_shared/icons';

/** The stable values of a decision. The host stores these; the words on the buttons are labels and may be translated. */
export const DECISION_VALUES = ['approve', 'refuse'] as const;
export type DecisionValue = (typeof DECISION_VALUES)[number];

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
  /** Most one-tap choices shown (default 4). A longer list is a form, not an inline question. */
  maxOptions?: number;
  /** `false`: choices only, no free-text field (a question with options only). Default true; without options the field always shows. */
  freeText?: boolean;
  /** The host cannot take an answer now (still being written, sending, unavailable): every control is disabled. */
  disabled?: boolean;
  /** A line under the controls, for example why an answer was refused or why answering is unavailable. */
  notice?: ReactNode;
  /** Set once answered: the controls give way to the answer, so the question stays readable in the history. */
  answered?: string;
  /** The block sends nothing. The host posts the answer under the signed-in person's own login, never a shared token. */
  onAnswer: (id: string, value: string) => void; // decision: 'approve' | 'refuse' (stable, never a label); question: the option text or the typed text
  /** Opens the full chat for a longer reply. Shown only when given. */
  onReplyInChat?: () => void;
  labels?: Partial<InlineQuestionLabels>;
  className?: string;
};

const tap = 'min-h-11 md:min-h-8';

/** A waiting question shown where it is mentioned. No border: a soft info tint for a decision, a soft warning tint for a question. */
export function InlineQuestion({ id, kind, text, source, options, answered, onAnswer, onReplyInChat, labels, className, maxOptions = 4, freeText = true, disabled = false, notice }: InlineQuestionProps) {
  const t = { ...inlineQuestionLabels, ...labels };
  const [draft, setDraft] = useState('');
  const decision = kind === 'decision';
  const choices: readonly { value: string; label: string }[] = decision
    ? [{ value: DECISION_VALUES[0], label: t.approve }, { value: DECISION_VALUES[1], label: t.refuse }]
    : (options ?? []).slice(0, maxOptions).map(option => ({ value: option, label: option }));
  const showField = !decision && (freeText || choices.length === 0);
  const send = () => { const value = draft.trim(); if (value && !disabled) onAnswer(id, value); };
  if (answered !== undefined) {
    const said = decision && answered === 'approve' ? t.approved : decision && answered === 'refuse' ? t.refused : `${t.answered}: ${answered}`;
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
        <span data-testid="question-text">{text}</span>
      </div>
      {choices.length > 0 || onReplyInChat ? (
        <div className="flex flex-wrap gap-1">
          {choices.map((choice, index) => (
            <Button key={choice.value} variant={index === 0 ? 'default' : 'secondary'} size="sm" className={cn(tap, 'h-auto justify-start whitespace-normal text-start')} data-testid="question-option" data-option={choice.value} disabled={disabled} onClick={() => onAnswer(id, choice.value)}>{choice.label}</Button>
          ))}
          {onReplyInChat ? <Button variant="ghost" size="sm" className={tap} onClick={onReplyInChat}>{t.replyInChat}</Button> : null}
        </div>
      ) : null}
      {showField ? (
        <form className="flex gap-1" onSubmit={event => { event.preventDefault(); send(); }}>
          <Input data-testid="question-input" disabled={disabled} maxLength={2000} value={draft} onChange={event => setDraft(event.target.value)} placeholder={choices.length ? t.placeholderMore : t.placeholder} aria-label={t.placeholder} className="min-w-0 flex-1" />
          <Button type="submit" size="sm" variant="secondary" className={tap} data-testid="question-submit" disabled={disabled || !draft.trim()}>{t.send}</Button>
        </form>
      ) : null}
      {notice ? <div className="text-sm">{notice}</div> : null}
    </div>
  );
}
