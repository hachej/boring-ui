'use client';

import type { ReactNode } from 'react';
import type { TaskQuestion, TaskRecord, TaskState } from '@hachej/boring-ui-kit/task-board';
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
}
export function TaskDetail({ task, labels, actions, onAnswer }: TaskDetailProps) {
  return <div className="flex min-w-0 flex-col gap-4" data-task-detail={task.id}>
    <div role="list"><TaskRequestCard task={task} labels={labels} actions={actions} /></div>
    {task.spec && <p className="whitespace-pre-wrap break-words">{task.spec}</p>}
    {task.waiting_on?.question && <Item variant="outline"><ItemContent><ItemTitle>Waiting on {task.waiting_on.who}</ItemTitle><ItemDescription>{task.waiting_on.question}</ItemDescription></ItemContent></Item>}
    {task.questions?.map(question => <Item variant="outline" key={question.id} data-task-question={question.id}>
      <ItemContent className="min-w-0"><ItemTitle>{question.text}</ItemTitle>
        {question.answer !== undefined ? <ItemDescription>Answer: {question.answer}</ItemDescription> : <div className="flex flex-wrap gap-2">
          {question.options?.map((option, index) => {
            const value = typeof option === 'string' ? option : option.value;
            const label = typeof option === 'string' ? option : option.label;
            return onAnswer ? <Button key={index} variant={index === 0 ? 'default' : 'outline'} className="min-h-11 whitespace-normal" onClick={() => onAnswer(task, question, value)}>{label}</Button> : <Badge key={index} variant="outline">{label}</Badge>;
          })}
        </div>}
      </ItemContent>
    </Item>)}
    {!!task.history?.length && <section aria-label="Task history" className="flex flex-col gap-3"><h3>History</h3><ol className="flex flex-col gap-3">
      {task.history.map((entry, index) => <li key={entry.id ?? index} className="break-words"><p>{entry.note}</p><p className="text-muted-foreground">{entry.actor}{entry.at && <> · <time dateTime={entry.at}>{entry.at}</time></>}</p></li>)}
    </ol></section>}
  </div>;
}
