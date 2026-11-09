'use client';

// D-1978 slice 2: the question card above the agent bar. The agent asks (a title, the step, a few choices, one preselected); the person taps a choice
// and « Suivant », or answers in their own words from the bar, whose field then reads « Ou réponds ici » (AgentBar routes that text to `onAnswer`).
// The card's fill is `--agent-question` and its ink `--agent-question-foreground` (the block's CSS falls back to `--accent` and `--accent-foreground`): a host sets them in its theme, for example `--agent-question: var(--cta)`. Nothing here is a colour literal.
import { useState } from 'react';
import { CheckIcon } from '../_shared/icons';
import { Button } from '@/components/ui/button';
import { cn } from '../utils/utils';

export interface AgentQuestionLabels {
  readonly later: string;
  readonly next: string;
  readonly hint: string;
  readonly answerHere: string;
}

export const agentQuestionLabels: AgentQuestionLabels = {
  later: 'Plus tard',
  next: 'Suivant',
  hint: 'ou réponds avec tes mots, dans la barre ↓',
  answerHere: 'Ou réponds ici',
};

/** What the person answered: the tapped (or confirmed) choice, or the words sent from the bar. */
export interface AgentAnswer { readonly text: string; readonly source: 'choice' | 'bar' }

export interface AgentQuestionData {
  readonly title: string;
  /** The small line above the title, « Tarte · 1 sur 2 ». */
  readonly step?: string;
  /** What was answered at the previous step, shown with a check. */
  readonly answered?: string;
  /** A sentence under the title or the step (« Tu as dit : … »). */
  readonly note?: string;
  /** Label and value rows (a measured answer); values are bold and right-aligned. */
  readonly details?: readonly { readonly label: string; readonly value: string }[];
  readonly footnote?: string;
  readonly choices: readonly string[];
  /** The choice that starts selected (and is the main action when `submit` is null). */
  readonly preselected?: string;
  /** The confirm button's words (« Suivant », « Valider »). `null`: no confirm, a tap on a choice answers at once. */
  readonly submit?: string | null;
  readonly onAnswer: (answer: AgentAnswer) => void;
  /** Shows « Plus tard » (left of the confirm button). */
  readonly onLater?: () => void;
}

export interface AgentQuestionProps {
  readonly question: AgentQuestionData;
  /** Shows « ou réponds avec tes mots, dans la barre ↓ »; false for a card the bar does not answer. */
  readonly hint?: boolean;
  readonly labels?: Partial<AgentQuestionLabels>;
  readonly className?: string;
}

export function AgentQuestion({ question, hint = true, labels, className }: AgentQuestionProps) {
  const words = { ...agentQuestionLabels, ...labels };
  const [selected, setSelected] = useState(question.preselected);
  const confirm = question.submit === undefined ? words.next : question.submit;
  const choose = (choice: string) => { if (confirm === null) question.onAnswer({ text: choice, source: 'choice' }); else setSelected(choice); };
  return <section data-slot="agent-bar" data-part="question" data-testid="agent-question" aria-label={question.title} className={cn('flex flex-col gap-3 rounded-(--radius-3xl) p-4 shadow-lg', className)}>
    <div className="flex flex-col gap-1.5">
      {question.step ? <p data-testid="agent-question-step" className="text-xs font-medium">{question.step}</p> : null}
      {question.answered ? <p data-testid="agent-question-answered" className="flex items-center gap-1.5 text-sm"><CheckIcon className="size-3.5 shrink-0" aria-hidden="true" />{question.answered}</p> : null}
      {question.note ? <p className="text-sm">{question.note}</p> : null}
      <h2 className="text-base font-semibold">{question.title}</h2>
    </div>
    {question.details?.length ? <dl className="flex flex-col gap-1 text-sm">
      {question.details.map(row => <div key={row.label} className="flex justify-between gap-3"><dt>{row.label}</dt><dd className="font-semibold">{row.value}</dd></div>)}
    </dl> : null}
    <div className="flex flex-wrap gap-2">
      {question.choices.map(choice => {
        const on = choice === selected;
        return <Button key={choice} type="button" variant="ghost" data-agent-bar="" data-choice="" data-selected={on ? '' : undefined} {...(confirm === null ? {} : { 'aria-pressed': on })} onClick={() => choose(choice)}>{choice}</Button>;
      })}
    </div>
    {question.footnote ? <p className="text-xs">{question.footnote}</p> : null}
    {hint ? <p data-testid="agent-question-hint" className="text-xs">{words.hint}</p> : null}
    {confirm !== null || question.onLater ? <div className="flex items-center justify-between gap-2">
      {question.onLater ? <Button type="button" variant="ghost" data-agent-bar="" onClick={question.onLater}>{words.later}</Button> : <span />}
      {confirm !== null ? <Button type="button" data-agent-bar="" data-choice="" data-selected="" data-testid="agent-question-submit" disabled={selected === undefined} onClick={() => { if (selected !== undefined) question.onAnswer({ text: selected, source: 'choice' }); }}>{confirm}</Button> : null}
    </div> : null}
  </section>;
}
