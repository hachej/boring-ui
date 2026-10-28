'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import type { TaskFile, TaskQuestion, TaskRecord, TaskState } from '@hachej/boring-ui-kit/task-board';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { TaskRequestCard } from './task-request-card';

export interface TaskDetailProps {
  readonly task: TaskRecord;
  readonly labels?: Readonly<Record<TaskState, string>> | undefined;
  readonly actions?: ReactNode;
  /** The host reauthorizes and resolves the original question. Rendering never supplies approval. */
  readonly onAnswer?: ((task: TaskRecord, question: TaskQuestion, value: string) => void) | undefined;
  /** Opens the host's free-answer flow; no synthetic option value or approval is generated. */
  readonly onOther?: ((task: TaskRecord, question: TaskQuestion) => void) | undefined;
  readonly onDiscussQuestion?: ((task: TaskRecord, question: TaskQuestion) => void) | undefined;
  readonly onOpenFile?: ((task: TaskRecord, file: TaskFile) => void) | undefined;
}
const preview = (value: string) => value.length > 160 ? `${value.slice(0, 160)}…` : value;

function AnsweredQuestion({ question }: { readonly question: TaskQuestion }) {
  const [expanded, setExpanded] = useState(false);
  return <li data-task-answered={question.id} className="min-w-0">
    <Button variant="ghost" className="h-auto w-full min-w-0 justify-between text-start" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      <span className="flex min-w-0 flex-1 flex-col"><span className="truncate">{preview(question.text)}</span><span data-task-answer={question.id} className="truncate text-muted-foreground">{question.answeredBy ? `${preview(question.answeredBy)}: ` : ''}{preview(question.answer ?? '')}</span></span>
      {expanded ? <ChevronUpIcon className="shrink-0" aria-hidden="true" /> : <ChevronDownIcon className="shrink-0" aria-hidden="true" />}
    </Button>
    {expanded && <div data-task-answer-full className="whitespace-pre-wrap break-words p-3"><p>{question.text}</p><p>{question.answeredBy && <>{question.answeredBy}: </>}{question.answer}</p></div>}
  </li>;
}

export function TaskDetail({ task, labels, actions, onAnswer, onOther, onDiscussQuestion, onOpenFile }: TaskDetailProps) {
  const [showAll, setShowAll] = useState(false);
  const answered = task.questions?.filter(question => question.answer !== undefined).toReversed().sort((a, b) => (Date.parse(b.answeredAt ?? '') || 0) - (Date.parse(a.answeredAt ?? '') || 0)) ?? [];
  return <div className="flex min-w-0 flex-col gap-4" data-task-detail={task.id}>
    <div role="list"><TaskRequestCard task={task} labels={labels} actions={actions} /></div>
    {task.spec && <p className="whitespace-pre-wrap break-words">{task.spec}</p>}
    {task.waiting_on?.question && <Item variant="outline"><ItemContent><ItemTitle>Waiting on {task.waiting_on.who}</ItemTitle><ItemDescription>{task.waiting_on.question}</ItemDescription></ItemContent></Item>}
    {!!task.questions?.length && <h3>Questions</h3>}
    {task.questions?.filter(question => question.answer === undefined).map(question => <Item variant="outline" key={question.id} data-task-question={question.id}>
      <ItemContent className="min-w-0"><ItemTitle>{question.text}</ItemTitle>
        <div className="flex flex-wrap gap-2">
          {question.options?.map((option, index) => {
            const value = typeof option === 'string' ? option : option.value;
            const label = typeof option === 'string' ? option : option.label;
            return onAnswer ? <Button key={index} variant={index === 0 ? 'default' : 'outline'} className="min-h-11 whitespace-normal" onClick={() => onAnswer(task, question, value)}>{label}</Button> : <Badge key={index} variant="outline">{label}</Badge>;
          })}
          {onOther && <Button variant="outline" className="min-h-11" data-task-other={question.id} onClick={() => onOther(task, question)}>Other…</Button>}
        </div>
        {onDiscussQuestion && <Button variant="link" className="self-start" data-task-discuss={question.id} onClick={() => onDiscussQuestion(task, question)}>Discuss in chat</Button>}
      </ItemContent>
    </Item>)}
    {!!answered.length && <section aria-label="Answered questions" className="flex min-w-0 flex-col gap-2"><h3>Answered · {answered.length}</h3>
      <ul className="flex min-w-0 flex-col gap-2">{(showAll ? answered : answered.slice(0, 3)).map(question => <AnsweredQuestion key={question.id} question={question} />)}</ul>
      {answered.length > 3 && <Button variant="link" className="self-start" data-task-show-answers onClick={() => setShowAll(value => !value)}>{showAll ? 'Show latest 3' : `Show all ${answered.length}`}</Button>}
    </section>}
    {!!task.files?.length && <section aria-label="Task files" className="flex min-w-0 flex-col gap-2"><h3>Files</h3>
      {task.files.map(file => onOpenFile ? <Button key={file.path} variant="outline" className="min-h-11 justify-start whitespace-normal break-all" data-task-file={file.path} onClick={() => onOpenFile(task, file)}>{file.name ?? file.path.split('/').pop()}</Button> : <p key={file.path} className="break-all">{file.name ?? file.path}</p>)}
    </section>}
    {!!task.history?.length && <section aria-label="Task history" className="flex flex-col gap-3"><h3>History</h3><ol className="flex flex-col gap-3">
      {task.history.map((entry, index) => <li key={entry.id ?? index} className="break-words"><p>{entry.note}</p><p className="text-muted-foreground">{entry.actor}{entry.at && <> · <time dateTime={entry.at}>{entry.at}</time></>}</p></li>)}
    </ol></section>}
  </div>;
}
