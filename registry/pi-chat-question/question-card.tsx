'use client';

import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { formAnswer, parseAnswer, parseQuestion, splitFormAnswer } from '@hachej/boring-ui-kit/chat-view';
import type { FormQuestion } from '@hachej/boring-ui-kit/chat-view';
import { useSubmitOutcome } from '@hachej/boring-ui-kit/chat-react';
import { CheckIcon, CircleSlashIcon, SendIcon } from '../_shared/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { InlineQuestion } from '../inline-question/inline-question';
import { useChatText } from '../pi-chat/labels';
import { ASK_USER_TOOL } from '../pi-chat/config';
import type { AnswerOutcome, QuestionCardProps } from '../pi-chat/config';

// The core owns the tool name and the props: it places the question row and shows its waiting notice without this item.
export { ASK_USER_TOOL };
export type { AnswerOutcome, QuestionCardProps };
// The grammar of `ask_user` arguments and answers is the kit's (chat-view); these stay exported from here for hosts that import them from the item.
export { formAnswer, parseAnswer, parseQuestion };
export type { FormQuestion };

/**
 * Human-in-the-loop question: writing (still generated, not answerable), pending (options and free text), then answered with the chosen
 * answer. With `questions` it is one form: each question has its option chips and a free-text field, and Answer sends one text
 * (`formAnswer`). It needs only a tool call and an `answer` callback, so a host can show it outside the chat too (for example in a
 * popover answering a request of its own); wrap it in `ChatTextProvider` for the chat's words there.
 */
export function QuestionCard({ call, result, answer, questionId, live = false }: QuestionCardProps) {
  const { labels } = useChatText();
  const question = parseQuestion(call);
  const settled = parseAnswer(result);
  const outcome = useSubmitOutcome({ send: value => answer!(questionId!, value), refused: labels.answerRefused, notSent: labels.answerNotSent });
  const { sent, sending, refusal } = outcome;
  const [values, setValues] = useState<readonly string[]>([]);
  const formId = useId();
  const setValue = (i: number, value: string) => setValues(previous => question.items.map((_, j) => j === i ? value : previous[j] ?? ''));
  const current = settled && 'answer' in settled ? settled.answer : sent;
  // `pending` means the question waits on the person; `writing` means the model is still generating it (options may be partial).
  const state = settled ? ('failure' in settled ? 'failed' : 'answered') : sent !== undefined ? 'sent' : live ? 'writing' : 'pending';
  const open = state === 'pending' || state === 'writing';

  async function submit(value: string) {
    const trimmed = value.trim();
    if (!answer || !questionId || live || !trimmed) return;
    await outcome.submit(trimmed);
  }
  const onSubmitForm = (event: FormEvent) => { event.preventDefault(); if (values.some(value => value.trim())) void submit(formAnswer(question.items, values, labels.skipped)); };
  const busy = sending !== undefined || live;

  const unavailable = !answer || !questionId || busy;
  // `m-0`: a host without a global preflight keeps the paragraph margin of ItemDescription.
  const wrap = 'm-0 line-clamp-none [overflow-wrap:anywhere]';

  if (!open) {
    const values = question.items.length > 0 && current !== undefined ? splitFormAnswer(question.items, current) : undefined;
    return <Item role="group" data-testid="question-card" data-state={state} data-call-id={call.id} aria-label={labels.question}>
      <ItemMedia variant="icon">
        {state === 'answered' ? <CheckIcon role="img" aria-label={labels.answered} /> : state === 'sent' ? <Spinner aria-label={labels.waitingForAgent} /> : <CircleSlashIcon role="img" aria-label={labels.notAnswered} />}
      </ItemMedia>
      <ItemContent className="min-w-0">
        {state === 'failed' && <ItemDescription data-testid="question-text" className={wrap}>{question.question || labels.askedQuestion}</ItemDescription>}
        {values ? <div className="flex min-w-0 flex-col gap-2">{question.items.map((item, i) => <div key={i} data-testid="question-answer-item" className="flex min-w-0 flex-col gap-1">
          <ItemDescription className={wrap}>{item.question}</ItemDescription>
          {values[i] === labels.skipped
            ? <ItemDescription data-testid="question-answer" data-skipped="true" className={wrap}>{values[i]}</ItemDescription>
            : <ItemTitle data-testid="question-answer" className={wrap}>{values[i]}</ItemTitle>}
        </div>)}</div>
          : current !== undefined && <ItemTitle className={wrap}><span className="sr-only">{labels.yourAnswer} </span><span data-testid="question-answer" className="whitespace-pre-line">{current}</span></ItemTitle>}
        {state === 'failed' && settled && 'failure' in settled && <ItemDescription role="alert" className={wrap}>{settled.failure || labels.questionNotAnswered}</ItemDescription>}
      </ItemContent>
    </Item>;
  }

  const option = (value: string, selected: boolean, onClick: () => void) => <Button key={value} variant={selected ? 'secondary' : 'outline'} data-testid="question-option" data-option={value}
    aria-pressed={question.items.length > 0 ? selected : undefined} disabled={unavailable} onClick={onClick} className="h-auto min-h-8 w-full justify-start @max-md:min-h-11 whitespace-normal text-start">
    {selected && <CheckIcon data-icon="inline-start" aria-hidden="true" />}{value}
  </Button>;

  // One waiting question is the shared InlineQuestion (one-tap choices, free text); the card keeps its test ids and state. A form (`questions`) stays below.
  const note = 'm-0 text-sm opacity-80';
  const hasNotice = live || !answer || !!refusal;
  const notice = hasNotice ? <>
    {live && <p className={note}>{labels.stillWritingQuestion}</p>}
    {!answer && !live && <p className={note}>{labels.answeringUnavailable}</p>}
    {refusal && <Alert variant="destructive" data-testid="question-refusal"><AlertDescription>{refusal}</AlertDescription></Alert>}
  </> : undefined;
  if (question.items.length === 0) return <div data-testid="question-card" data-state={state} data-call-id={call.id} className="my-2 text-start">
    <InlineQuestion tone="attention" className="bg-(--chat-warning-soft) text-(--chat-warning-soft-foreground)" id={questionId ?? call.id} kind="question" text={question.question || labels.askedQuestion} options={question.options} maxOptions={6} freeText={question.allowFreeText}
      disabled={unavailable} notice={notice} onAnswer={(_, value) => { void submit(value); }}
      labels={{ question: labels.questionForYou, send: labels.answer, placeholder: labels.typeAnswer, placeholderMore: labels.ownAnswer }} />
  </div>;
  // A form of several questions: the same flat warning tint as InlineQuestion.
  return <div role="group" data-testid="question-card" data-state={state} data-call-id={call.id} aria-label={labels.question} className="@container my-2 flex min-w-0 flex-col gap-3 rounded-(--radius) bg-(--chat-warning-soft) p-3 text-start text-(--chat-warning-soft-foreground)">
    <div className="flex min-w-0 flex-col gap-1">
      <p className="m-0 text-xs">{labels.questionForYou}</p>
      <p data-testid="question-text" className="m-0 text-sm font-medium [overflow-wrap:anywhere]">{question.question || labels.askedQuestion}</p>
    </div>
    <form data-testid="question-form" onSubmit={onSubmitForm} className="flex flex-col gap-4">
      {question.items.map((item, i) => <div key={i} role="group" aria-labelledby={`${formId}-${i}`} data-testid="question-item" className="flex min-w-0 flex-col gap-2">
        <p id={`${formId}-${i}`} className="m-0 [overflow-wrap:anywhere]">{i + 1}. {item.question}</p>
        {item.options.length > 0 && <div role="group" aria-label={labels.answerOptions} className="flex flex-col gap-2">
          {item.options.map(value => option(value, values[i] === value, () => setValue(i, values[i] === value ? '' : value)))}
        </div>}
        <Input data-testid="question-input" value={item.options.includes(values[i] ?? '') ? '' : values[i] ?? ''} maxLength={2000} disabled={unavailable}
          placeholder={item.options.length ? labels.ownAnswer : labels.typeAnswer} aria-label={`${labels.yourAnswerInput} ${i + 1}`} onChange={event => setValue(i, event.currentTarget.value)} />
      </div>)}
      <div><Button type="submit" className="@max-md:min-h-11 @max-md:w-full" data-testid="question-submit" disabled={unavailable || !values.some(value => value.trim())}><SendIcon data-icon="inline-start" aria-hidden="true" />{labels.answer}</Button></div>
    </form>
    {notice}
  </div>;
}
