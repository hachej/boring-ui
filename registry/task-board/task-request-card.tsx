'use client';

import type { MouseEvent, ReactNode } from 'react';
import type { TaskRecord, TaskState } from '@hachej/boring-ui-kit/task-board';
import { taskReference } from '@hachej/boring-ui-kit/task-board';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';

export const taskStateLabels: Readonly<Record<TaskState, string>> = { waiting: 'Waiting', working: 'Working', open: 'Open', done: 'Done', closed: 'Closed' };

export function TaskStatusChip({ task, labels = taskStateLabels }: { readonly task: Pick<TaskRecord, 'state' | 'status'>; readonly labels?: Readonly<Record<TaskState, string>> | undefined }) {
  return <Badge variant={task.state === 'working' ? 'default' : 'secondary'}>{task.status ?? labels[task.state]}</Badge>;
}
export interface TaskRequestCardProps {
  readonly task: TaskRecord;
  readonly variant?: 'card' | 'compact';
  readonly selected?: boolean;
  readonly href?: string;
  readonly onOpen?: ((task: TaskRecord) => void) | undefined;
  readonly actions?: ReactNode;
  readonly labels?: Readonly<Record<TaskState, string>> | undefined;
}

/** Shared by the board, detail and the PM's confirmation card; actions remain host-authorized. */
export function TaskRequestCard({ task, variant = 'card', selected, href, onOpen, actions, labels }: TaskRequestCardProps) {
  const activate = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onOpen || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); onOpen(task);
  };
  const link = href ? <a href={href} onClick={activate} data-task-open={task.id} aria-current={selected ? 'true' : undefined} /> : undefined;
  const rowLink = variant === 'compact' || !actions;
  const title = link && !rowLink ? <Button variant="link" className="min-h-11 min-w-0 justify-start whitespace-normal text-start" render={link}>{task.title}</Button> : <span>{task.title}</span>;
  return <div role="listitem"><Item variant="outline" size="sm" className="min-h-11" data-task-card={task.id} data-selected={selected || undefined} {...(link && rowLink ? { render: link } : {})}>
    <ItemContent className="min-w-0">
      <ItemTitle className="min-w-0">{title}</ItemTitle>
      {variant !== 'compact' && <>
        <ItemDescription>{taskReference(task)}</ItemDescription>
        {(task.screen || task.capture) && <ItemDescription>{[task.screen, task.capture].filter(Boolean).join(' · ')}</ItemDescription>}
        {(task.waiting_on || task.risk === 'high') && <div className="flex flex-wrap gap-2">
          {task.waiting_on && <Badge variant={task.waiting_on_you ? 'default' : 'outline'}>{task.waiting_on_you ? 'Waiting on you' : `On ${task.waiting_on.who}`}</Badge>}
          {task.risk === 'high' && <Badge variant="outline">High risk</Badge>}
        </div>}
      </>}
    </ItemContent>
    <TaskStatusChip task={task} labels={labels} />
    {variant !== 'compact' && actions && <div className="flex w-full flex-wrap gap-2">{actions}</div>}
  </Item></div>;
}
