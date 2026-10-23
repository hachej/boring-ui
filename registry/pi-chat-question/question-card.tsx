'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ToolCall, ToolResultMessage } from '@earendil-works/pi-ai';
import { CheckIcon, CircleSlashIcon, SendIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { useChatText } from '../pi-chat/labels';
import { ASK_USER_TOOL } from '../pi-chat/config';
import type { AnswerOutcome, QuestionCardProps } from '../pi-chat/config';

// The core owns the tool name and the props: it places the question row and shows its waiting notice without this item.
export { ASK_USER_TOOL };
export type { AnswerOutcome, QuestionCardProps };

/** One question of a form: its text and its options (chips); every question of a form also takes free text. */
export interface FormQuestion { readonly question: string; readonly options: readonly string[] }
interface Question {
  readonly question: string; readonly options: readonly string[]; readonly allowFreeText: boolean;
  /** Several questions in one form (`questions`), answered together as one text. Empty for a single question. */
  readonly items: readonly FormQuestion[];
}

const strings = (value: unknown, max: number) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, max) : [];

/**
 * Read `{ question, options?, allowFreeText?, questions? }` defensively: model arguments are untrusted input. Free text is allowed
 * unless `allowFreeText` is `false` (and always when there are no options). `questions` (up to 8) makes a form.
 */
export function parseQuestion(call: ToolCall): Question {
  const args = call.arguments as Record<string, unknown>;
  const options = strings(args['options'], 6);
  const items = Array.isArray(args['questions']) ? args['questions'].flatMap((item: unknown) => {
    const value = item !== null && typeof item === 'object' ? item as Record<string, unknown> : {};
    return typeof value['question'] === 'string' && value['question'] ? [{ question: value['question'], options: strings(value['options'], 6) }] : [];
  }).slice(0, 8) : [];
  return { question: typeof args['question'] === 'string' ? args['question'] : '', options, allowFreeText: args['allowFreeText'] !== false || options.length === 0, items };
}

/** The answers of a form as the one text the agent reads: each question, then its answer, or `skipped` when left blank. */
export function formAnswer(items: readonly FormQuestion[], values: readonly string[], skipped: string): string {
  return items.map((item, i) => `${i + 1}. ${item.question}\n→ ${values[i]?.trim() || skipped}`).join('\n\n');
}

/** The answers of a `formAnswer` text, one per question; undefined when the text does not have that shape (then it is shown whole). */
function splitFormAnswer(items: readonly FormQuestion[], text: string): readonly string[] | undefined {
  const values: string[] = [];
  let at = 0;
  for (let i = 0; i < items.length; i++) {
    const head = `${i + 1}. ${items[i]!.question}\n→ `;
    if (!text.startsWith(head, at)) return undefined;
    at += head.length;
    const end = i + 1 < items.length ? text.indexOf(`\n\n${i + 2}. ${items[i + 1]!.question}\n→ `, at) : text.length;
    if (end < 0) return undefined;
    values.push(text.slice(at, end));
    at = end + 2;
  }
  return values;
}

/** The answered text from a result such as `{"kind":"answered","answer":"..."}`; undefined when the call did not produce an answer. */
export function parseAnswer(result: ToolResultMessage | undefined): { readonly answer: string } | { readonly failure: string } | undefined {
  if (!result) return undefined;
  const text = result.content.map(part => part.type === 'text' ? part.text : '').join('');
  if (!result.isError) {
    try {
      const value: unknown = JSON.parse(text);
      if (value !== null && typeof value === 'object' && (value as { kind?: unknown }).kind === 'answered' && typeof (value as { answer?: unknown }).answer === 'string') return { answer: (value as { answer: string }).answer };
    } catch { /* fall through to the failure text */ }
  }
  return { failure: text || 'The question was not answered.' };
}


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
  const [sent, setSent] = useState<string | undefined>();
  const [sending, setSending] = useState<string | undefined>();
  const [refusal, setRefusal] = useState<string | undefined>();
  const [text, setText] = useState('');
  const [values, setValues] = useState<readonly string[]>([]);
  const formId = useId();
  const setValue = (i: number, value: string) => setValues(previous => question.items.map((_, j) => j === i ? value : previous[j] ?? ''));
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = settled && 'answer' in settled ? settled.answer : sent;
  // `pending` means the question waits on the person; `writing` means the model is still generating it (options may be partial).
  const state = settled ? ('failure' in settled ? 'failed' : 'answered') : sent !== undefined ? 'sent' : live ? 'writing' : 'pending';
  const open = state === 'pending' || state === 'writing';

  async function submit(value: string) {
    const trimmed = value.trim();
    if (!answer || !questionId || live || !trimmed || sending !== undefined) return;
    setRefusal(undefined); setSending(trimmed);
    try {
      const outcome = await answer(questionId, trimmed);
      if (outcome.kind === 'answered') setSent(trimmed);
      else setRefusal(outcome.reason || labels.answerRefused(outcome.kind));
    } catch (cause) { setRefusal(cause instanceof Error ? cause.message : labels.answerNotSent); }
    finally { if (mounted.current) setSending(undefined); }
  }
  const onSubmit = (event: FormEvent) => { event.preventDefault(); void submit(text); };
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
        <ItemDescription data-testid="question-text" className={wrap}>{question.question || labels.askedQuestion}</ItemDescription>
        {values ? <div className="flex min-w-0 flex-col gap-2">{question.items.map((item, i) => <div key={i} data-testid="question-answer-item" className="flex min-w-0 flex-col gap-1">
          <ItemDescription className={wrap}>{item.question}</ItemDescription>
          {values[i] === labels.skipped
            ? <ItemDescription data-testid="question-answer" data-skipped="true" className={wrap}>{values[i]}</ItemDescription>
            : <ItemTitle data-testid="question-answer" className={wrap}>{values[i]}</ItemTitle>}
        </div>)}</div>
          : current !== undefined && <ItemTitle className={wrap}><span className="sr-only">{labels.yourAnswer} </span><span data-testid="question-answer" className="whitespace-pre-line">{current}</span></ItemTitle>}
        {state === 'failed' && settled && 'failure' in settled && <ItemDescription role="alert" className={wrap}>{settled.failure}</ItemDescription>}
      </ItemContent>
    </Item>;
  }

  const option = (value: string, selected: boolean, onClick: () => void) => <Button key={value} variant={selected ? 'secondary' : 'outline'} data-testid="question-option" data-option={value}
    aria-pressed={question.items.length > 0 ? selected : undefined} disabled={unavailable} onClick={onClick} className="h-auto min-h-8 w-full justify-start whitespace-normal text-start">
    {selected && <CheckIcon data-icon="inline-start" aria-hidden="true" />}{value}
  </Button>;

  return <Card role="group" data-testid="question-card" data-state={state} data-call-id={call.id} aria-label={labels.question}>
    <CardHeader>
      <CardDescription>{labels.questionForYou}</CardDescription>
      <CardTitle data-testid="question-text" className="[overflow-wrap:anywhere]">{question.question || labels.askedQuestion}</CardTitle>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      {question.items.length > 0 ? <form data-testid="question-form" onSubmit={onSubmitForm} className="flex flex-col gap-4">
        {question.items.map((item, i) => <div key={i} role="group" aria-labelledby={`${formId}-${i}`} data-testid="question-item" className="flex min-w-0 flex-col gap-2">
          <p id={`${formId}-${i}`} className="m-0 [overflow-wrap:anywhere]">{i + 1}. {item.question}</p>
          {item.options.length > 0 && <div role="group" aria-label={labels.answerOptions} className="flex flex-col gap-2">
            {item.options.map(value => option(value, values[i] === value, () => setValue(i, values[i] === value ? '' : value)))}
          </div>}
          <Input data-testid="question-input" value={item.options.includes(values[i] ?? '') ? '' : values[i] ?? ''} maxLength={2000} disabled={unavailable}
            placeholder={item.options.length ? labels.ownAnswer : labels.typeAnswer} aria-label={`${labels.yourAnswerInput} ${i + 1}`} onChange={event => setValue(i, event.currentTarget.value)} />
        </div>)}
        <div><Button type="submit" data-testid="question-submit" disabled={unavailable || !values.some(value => value.trim())}><SendIcon data-icon="inline-start" aria-hidden="true" />{labels.answer}</Button></div>
      </form> : <>
        {question.options.length > 0 && <div role="group" aria-label={labels.answerOptions} className="flex flex-col gap-2">
          {question.options.map(value => option(value, false, () => { void submit(value); }))}
        </div>}
        {question.allowFreeText && <form onSubmit={onSubmit} className="flex gap-2">
          <Input data-testid="question-input" value={text} maxLength={2000} disabled={unavailable} placeholder={question.options.length ? labels.ownAnswer : labels.typeAnswer}
            aria-label={labels.yourAnswerInput} onChange={event => setText(event.currentTarget.value)} />
          <Button type="submit" data-testid="question-submit" disabled={unavailable || !text.trim()}><SendIcon data-icon="inline-start" aria-hidden="true" />{labels.answer}</Button>
        </form>}
      </>}
      {live && <CardDescription>{labels.stillWritingQuestion}</CardDescription>}
      {!answer && !live && <CardDescription>{labels.answeringUnavailable}</CardDescription>}
      {refusal && <Alert variant="destructive" data-testid="question-refusal"><AlertDescription>{refusal}</AlertDescription></Alert>}
    </CardContent>
  </Card>;
}
