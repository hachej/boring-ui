'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { selectTasks, taskFromUrl, taskReference, taskUrl, TASK_STATES } from '@hachej/boring-ui-kit/task-board';
import type { TaskFilter, TaskRecord, TaskState } from '@hachej/boring-ui-kit/task-board';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { cn } from '../utils/utils';
import { TaskRequestCard, taskStateLabels } from './task-request-card';
import { TaskDetail } from './task-detail';
import type { TaskDetailProps } from './task-detail';

export { TaskRequestCard, TaskStatusChip } from './task-request-card';
export { TaskDetail } from './task-detail';
export type { TaskRequestCardProps } from './task-request-card';
export type { TaskDetailProps } from './task-detail';
export type { TaskRecord, TaskFilter, TaskState } from '@hachej/boring-ui-kit/task-board';

const navigation = 'boring:task-navigation';
const subscribe = (changed: () => void) => {
  window.addEventListener('popstate', changed); window.addEventListener(navigation, changed);
  return () => { window.removeEventListener('popstate', changed); window.removeEventListener(navigation, changed); };
};
const readSelection = () => taskFromUrl(window.location.href);
const serverSelection = () => null;

export interface TaskBoardProps {
  readonly tasks: readonly TaskRecord[];
  readonly filter?: TaskFilter;
  readonly currentUser?: string;
  readonly limit?: number;
  readonly variant?: 'board' | 'compact';
  readonly title?: string;
  readonly labels?: Readonly<Record<TaskState, string>>;
  /** Omit to use ?task= with native history. A router may instead supply controlled selection. */
  readonly selectedTask?: string | null;
  readonly onSelectedTaskChange?: ((id: string | null) => void) | undefined;
  /** Optional host navigation/present path, particularly for compact lists inside the PM panel. */
  readonly onOpen?: ((task: TaskRecord) => void) | undefined;
  readonly actions?: ((task: TaskRecord) => ReactNode) | undefined;
  readonly onAnswer?: TaskDetailProps['onAnswer'];
  readonly className?: string;
}

/** Authorized records in; local presentation out. Container width, never the viewport, chooses list and side detail. */
export function TaskBoard({ tasks, filter = 'all', currentUser, limit, variant = 'board', title = 'Tasks', labels = taskStateLabels,
  selectedTask, onSelectedTaskChange, onOpen, actions, onAnswer, className }: TaskBoardProps) {
  const urlSelection = useSyncExternalStore(subscribe, readSelection, serverSelection);
  const selected = selectedTask === undefined ? onOpen ? null : urlSelection : selectedTask;
  const detail = selected === null ? undefined : tasks.find(task => task.id === selected || taskReference(task) === selected);
  const shown = selectTasks(tasks, { filter, ...(currentUser === undefined ? {} : { currentUser }), ...(limit === undefined ? {} : { limit }) });
  const root = useRef<HTMLElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (selected !== null) back.current?.focus();
    else if (previous.current !== null) {
      const id = previous.current;
      const links = root.current?.querySelectorAll<HTMLAnchorElement>('[data-task-open]');
      const link = [...links ?? []].find(candidate => candidate.dataset['taskOpen'] === id);
      const folded = link?.closest('details');
      if (folded) folded.open = true;
      link?.focus();
    }
    previous.current = detail?.id ?? selected;
  }, [selected, detail?.id]);
  const select = (id: string | null) => {
    if (selectedTask === undefined) {
      window.history.pushState(null, '', taskUrl(window.location.href, id));
      window.dispatchEvent(new Event(navigation));
    }
    onSelectedTaskChange?.(id);
  };
  const open = (task: TaskRecord) => { if (onOpen) onOpen(task); else select(task.id); };
  const href = (task: TaskRecord) => typeof window === 'undefined' ? `?task=${encodeURIComponent(task.id)}` : taskUrl(window.location.href, task.id);
  const card = (task: TaskRecord) => <TaskRequestCard key={task.id} task={task} variant={variant === 'compact' ? 'compact' : 'card'} selected={task.id === detail?.id} href={href(task)} onOpen={open} labels={labels} />;
  const empty = <Empty><EmptyHeader><EmptyTitle>No requests</EmptyTitle><EmptyDescription>No tasks match this view.</EmptyDescription></EmptyHeader></Empty>;
  return <section ref={root} data-boring="task-board" data-variant={variant} aria-label={title} className={cn('@container/task-board min-w-0', className)} onKeyDown={event => {
    if (event.key === 'Escape' && selected !== null && !event.defaultPrevented) { event.preventDefault(); select(null); }
  }}>
    <div className={cn('grid min-w-0 gap-4', selected !== null && '@4xl/task-board:grid-cols-[minmax(0,1fr)_22rem]')}>
      <div data-task-list className={cn('@container/task-rails min-w-0 flex-col gap-4', selected !== null ? 'hidden @4xl/task-board:flex' : 'flex')}>
        {variant === 'compact' ? <div role="list" aria-label={title} className="flex flex-col gap-2">{shown.length ? shown.map(card) : empty}</div> : <>
          <div className="grid min-w-0 gap-4 @2xl/task-rails:grid-cols-3">
            {TASK_STATES.slice(0, 3).map(state => <section key={state} data-task-column={state} className="flex min-w-0 flex-col gap-3" aria-label={labels[state]}>
              <h3>{labels[state]} · {shown.filter(task => task.state === state).length}</h3>
              <div role="list" className="flex flex-col gap-2">{shown.filter(task => task.state === state).sort((a, b) => Number(b.waiting_on_you === true) - Number(a.waiting_on_you === true)).map(card)}</div>
              {!shown.some(task => task.state === state) && <p className="text-muted-foreground">No tasks</p>}
            </section>)}
          </div>
          {TASK_STATES.slice(3).map(state => <details key={state} data-task-column={state} className="min-w-0">
            <summary className="min-h-11 cursor-pointer content-center">{labels[state]} · {shown.filter(task => task.state === state).length}</summary>
            <div role="list" className="flex flex-col gap-2">{shown.filter(task => task.state === state).map(card)}</div>
          </details>)}
        </>}
      </div>
      {selected !== null && <section aria-label="Task detail" data-task-side className="flex min-w-0 flex-col gap-4" aria-live="polite">
        <Button ref={back} variant="outline" className="min-h-11 self-start" onClick={() => select(null)}>Back to tasks</Button>
        {detail ? <TaskDetail task={detail} labels={labels} actions={actions?.(detail)} onAnswer={onAnswer} /> : <Empty><EmptyHeader><EmptyTitle>Task unavailable</EmptyTitle><EmptyDescription>The host has not supplied this task.</EmptyDescription></EmptyHeader></Empty>}
      </section>}
    </div>
  </section>;
}
