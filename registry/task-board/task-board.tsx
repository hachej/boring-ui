'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { selectTasks, taskFromUrl, taskReference, taskUrl, TASK_STATES } from '@hachej/boring-ui-kit/task-board';
import type { TaskFile, TaskFilter, TaskRecord, TaskState } from '@hachej/boring-ui-kit/task-board';
import { ArrowLeftIcon } from 'lucide-react';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
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
export type { TaskFile, TaskRecord, TaskFilter, TaskState } from '@hachej/boring-ui-kit/task-board';

const navigation = 'boring:task-navigation';
const subscribe = (changed: () => void) => {
  window.addEventListener('popstate', changed); window.addEventListener(navigation, changed);
  return () => { window.removeEventListener('popstate', changed); window.removeEventListener(navigation, changed); };
};
const readSelection = () => taskFromUrl(window.location.href);
const serverSelection = () => null;

export interface TaskFileViewApi {
  readonly onClose: () => void;
  readonly onBack: () => void;
  /** The host's PM pointing service; absent unless onShowFile was supplied. */
  readonly onShowFile?: (() => void) | undefined;
}
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
  readonly onOther?: TaskDetailProps['onOther'];
  readonly onDiscussQuestion?: TaskDetailProps['onDiscussQuestion'];
  /** Adapter paths only. The host reauthorizes them when opening the regular viewer. */
  readonly onOpenFile?: TaskDetailProps['onOpenFile'];
  readonly onShowFile?: TaskDetailProps['onOpenFile'];
  /** Supply the host's regular FileViewer in a wider overlay over task detail; no second store or composer. */
  readonly renderFile?: ((task: TaskRecord, file: TaskFile, api: TaskFileViewApi) => ReactNode) | undefined;
  readonly className?: string;
}

/** Authorized records in; container-responsive board beneath stacked shadcn task/file overlays. */
export function TaskBoard({ tasks, filter = 'all', currentUser, limit, variant = 'board', title = 'Tasks', labels = taskStateLabels,
  selectedTask, onSelectedTaskChange, onOpen, actions, onAnswer, onOther, onDiscussQuestion, onOpenFile, onShowFile, renderFile, className }: TaskBoardProps) {
  const urlSelection = useSyncExternalStore(subscribe, readSelection, serverSelection);
  const selected = selectedTask === undefined ? onOpen ? null : urlSelection : selectedTask;
  const detail = selected === null ? undefined : tasks.find(task => task.id === selected || taskReference(task) === selected);
  const shown = selectTasks(tasks, { filter, ...(currentUser === undefined ? {} : { currentUser }), ...(limit === undefined ? {} : { limit }) });
  const [fileSelection, setFileSelection] = useState<{ readonly taskId: string; readonly path: string } | null>(null);
  const filePath = fileSelection?.path;
  const file = detail?.id === fileSelection?.taskId ? detail?.files?.find(candidate => candidate.path === filePath) : undefined;
  const fileOpen = !!file && !!renderFile;
  const closeFile = () => setFileSelection(null);
  const openFile = (task: TaskRecord, file: TaskFile) => { setFileSelection({ taskId: task.id, path: file.path }); onOpenFile?.(task, file); };
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
    closeFile();
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
    if (event.key === 'Escape' && selected !== null && !event.defaultPrevented) { event.preventDefault(); if (fileOpen) closeFile(); else select(null); }
  }}>
    <Drawer open={selected !== null} onOpenChange={next => { if (!next) select(null); }} modal={false} swipeDirection="right">
      <div data-task-list className="@container/task-rails flex min-w-0 flex-col gap-4">
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
      <DrawerContent initialFocus={back} finalFocus={false} className="shadow-xl" style={{ '--drawer-content-width': 'min(100vw, 32rem)' } as React.CSSProperties}>
        <DrawerTitle className="sr-only">Task detail</DrawerTitle>
        <section aria-label="Task detail" data-task-side className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-auto p-4" aria-live="polite">
          <Button ref={back} variant="outline" className="min-h-11 self-start" onClick={() => select(null)}><ArrowLeftIcon aria-hidden="true" />Back to tasks</Button>
          {detail ? <TaskDetail key={detail.id} task={detail} labels={labels} actions={actions?.(detail)} onAnswer={onAnswer} onOther={onOther} onDiscussQuestion={onDiscussQuestion} onOpenFile={renderFile || onOpenFile ? openFile : undefined} /> : <Empty><EmptyHeader><EmptyTitle>Task unavailable</EmptyTitle><EmptyDescription>The host has not supplied this task.</EmptyDescription></EmptyHeader></Empty>}
          <Drawer open={fileOpen} onOpenChange={next => { if (!next) closeFile(); }} modal={false} swipeDirection="right">
            <DrawerContent className="shadow-xl" style={{ '--drawer-content-width': 'min(100vw, 56rem)' } as React.CSSProperties}>
              <DrawerTitle className="sr-only">Task file viewer</DrawerTitle>
              {fileOpen && detail && file && <section aria-label="Task file viewer" data-task-file-pane={detail.id} className="h-dvh min-w-0 flex-1 overflow-hidden">
                {renderFile!(detail, file, { onClose: closeFile, onBack: closeFile, onShowFile: onShowFile ? () => onShowFile(detail, file) : undefined })}
              </section>}
            </DrawerContent>
          </Drawer>
        </section>
      </DrawerContent>
    </Drawer>
  </section>;
}
