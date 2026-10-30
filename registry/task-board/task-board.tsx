'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { selectTasks, taskFromUrl, taskReference, taskUrl, TASK_STATES } from '@hachej/boring-ui-kit/task-board';
import type { TaskFile, TaskFilter, TaskRecord, TaskState } from '@hachej/boring-ui-kit/task-board';
import { ChevronLeftIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Separator } from '@/components/ui/separator';
import { cn } from '../utils/utils';
import { TaskRequestCard, TaskStatusPill, taskMeta, taskStateLabels, taskTokens } from './task-request-card';
import type { TaskLocale, TaskViewerAction } from './task-request-card';
import { TaskDetail } from './task-detail';
import type { TaskDetailProps } from './task-detail';
import { compactLabels, compactTaskStatus } from './compact-presentation';

export { TaskRequestCard, TaskRequestCard as TaskCard, TaskStatusPill, TaskStatusChip, TaskAttention, taskMeta, taskTokens } from './task-request-card';
export { TaskDetail } from './task-detail';
export type { TaskRequestCardProps, TaskRequestCardProps as TaskCardProps, TaskLocale, TaskViewerAction } from './task-request-card';
export type { TaskDetailProps } from './task-detail';
export type { TaskFile, TaskRecord, TaskFilter, TaskState } from '@hachej/boring-ui-kit/task-board';

const navigation = 'boring:task-navigation';
const subscribe = (changed: () => void) => {
  window.addEventListener('popstate', changed); window.addEventListener(navigation, changed);
  return () => { window.removeEventListener('popstate', changed); window.removeEventListener(navigation, changed); };
};
const readSelection = () => taskFromUrl(window.location.href);
const serverSelection = () => null;
const BOARD_STATES = TASK_STATES.slice(0, 3);
type TaskList = 'open' | 'done' | 'closed';

export interface TaskFileViewApi {
  readonly fullscreen: boolean;
  readonly onFullscreenChange: (fullscreen: boolean) => void;
  readonly onClose: () => void;
  readonly onBack: () => void;
  /** The host's PM pointing service; absent unless onShowFile was supplied. */
  readonly onShowFile?: (() => void) | undefined;
}
export interface TaskBoardProps {
  readonly tasks: readonly TaskRecord[];
  /** Controlled Mine/All. Uncontrolled, the tasks bar starts on Mine when `currentUser` is known, otherwise All. */
  readonly filter?: TaskFilter;
  readonly onFilterChange?: ((filter: TaskFilter) => void) | undefined;
  readonly currentUser?: string;
  readonly limit?: number;
  readonly variant?: 'board' | 'compact';
  /** Compact-only presentation, never server authorization. Supply only records the viewer may already read. */
  readonly compactPresentation?: { readonly includeTechnical?: boolean };
  readonly title?: string;
  /** Column names, shown uppercase. */
  readonly labels?: Readonly<Record<TaskState, string>>;
  /** The tasks bar (« 5 open · Done 12 · Closed 1 », Mine/All). Hosts that draw it in their own header pass false. */
  readonly bar?: boolean;
  /** Host content at the start of the tasks bar, e.g. the collapsed Studio header's app name and « Show the app ». */
  readonly barStart?: ReactNode;
  readonly locale?: TaskLocale;
  /** Explicit host context for compact French labels (« À vous » or « À confirmer »). */
  readonly viewerAction?: TaskViewerAction;
  /** Omit to use ?task= with native history. A router may instead supply controlled selection. */
  readonly selectedTask?: string | null;
  readonly onSelectedTaskChange?: ((id: string | null) => void) | undefined;
  /** Optional host navigation/present path, particularly for compact lists inside the PM panel. */
  readonly onOpen?: ((task: TaskRecord) => void) | undefined;
  /** Host content under the detail's title card. */
  readonly actions?: ((task: TaskRecord) => ReactNode) | undefined;
  /** Host-authorized compact card actions (« Modifier », « Confirmer »). */
  readonly cardActions?: ((task: TaskRecord) => ReactNode) | undefined;
  readonly onAnswer?: TaskDetailProps['onAnswer'];
  readonly onOther?: TaskDetailProps['onOther'];
  readonly onDiscussQuestion?: TaskDetailProps['onDiscussQuestion'];
  readonly onAsk?: TaskDetailProps['onAsk'];
  /** Adapter paths only. The host reauthorizes them when opening the regular viewer. */
  readonly onOpenFile?: TaskDetailProps['onOpenFile'];
  readonly onShowFile?: TaskDetailProps['onOpenFile'];
  /** Supply the host's regular FileViewer; it opens 760px wide over the task detail. No second store or composer. */
  readonly renderFile?: ((task: TaskRecord, file: TaskFile, api: TaskFileViewApi) => ReactNode) | undefined;
  /** Host-owned overlay appearance (for example the host's overlay shadow token). */
  readonly overlayClassName?: string;
  readonly className?: string;
}

/**
 * The tasks panel (spec 3 §3–§5): tasks bar, WAITING · WORKING · OPEN, and panel-scoped overlays. The task detail opens 400px wide
 * from the right over the board, which keeps its columns; a file opens 760px wide over the detail. `variant="compact"` stacks C7 cards.
 */
export function TaskBoard({ tasks, filter, onFilterChange, currentUser, limit, variant = 'board', compactPresentation, title = 'Tasks', labels = taskStateLabels, bar = true, barStart, locale = 'en', viewerAction,
  selectedTask, onSelectedTaskChange, onOpen, actions, cardActions, onAnswer, onOther, onDiscussQuestion, onAsk, onOpenFile, onShowFile, renderFile, overlayClassName, className }: TaskBoardProps) {
  const urlSelection = useSyncExternalStore(subscribe, readSelection, serverSelection);
  const [ownFilter, setOwnFilter] = useState<TaskFilter>(currentUser === undefined ? 'all' : 'mine');
  const [list, setList] = useState<TaskList>('open');
  const shownFilter = filter ?? ownFilter;
  const selected = selectedTask === undefined ? onOpen ? null : urlSelection : selectedTask;
  const detail = selected === null ? undefined : tasks.find(task => task.id === selected || taskReference(task) === selected);
  const shown = selectTasks(tasks, { filter: shownFilter, ...(currentUser === undefined ? {} : { currentUser }), ...(limit === undefined ? {} : { limit }) });
  const [fileSelection, setFileSelection] = useState<{ readonly taskId: string; readonly path: string } | null>(null);
  const filePath = fileSelection?.path;
  const file = detail?.id === fileSelection?.taskId ? detail?.files?.find(candidate => candidate.path === filePath) : undefined;
  const fileOpen = !!file && !!renderFile;
  const [fileFullscreen, setFileFullscreen] = useState(false);
  const closeFile = () => { setFileSelection(null); setFileFullscreen(false); };
  const openFile = (task: TaskRecord, file: TaskFile) => { setFileSelection({ taskId: task.id, path: file.path }); onOpenFile?.(task, file); };
  const root = useRef<HTMLElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const previous = useRef<{ readonly id: string; readonly state: TaskState | undefined } | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const cardLink = (id: string) => [...root.current?.querySelectorAll<HTMLAnchorElement>('[data-task-open]') ?? []].find(candidate => candidate.dataset['taskOpen'] === id);
  useEffect(() => {
    if (selected !== null) back.current?.focus();
    else if (previous.current !== null) {
      const { id, state } = previous.current, link = cardLink(id);
      if (link) link.focus();
      else if (state === 'done' || state === 'closed') { pendingFocus.current = id; setList(state); }
    }
    previous.current = selected === null ? null : { id: detail?.id ?? selected, state: detail?.state };
  }, [selected, detail?.id, detail?.state]);
  useEffect(() => { if (pendingFocus.current !== null) { cardLink(pendingFocus.current)?.focus(); pendingFocus.current = null; } }, [list]);
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
  const card = (task: TaskRecord) => <TaskRequestCard key={task.id} task={task} variant={variant === 'compact' ? 'compact' : 'card'} selected={task.id === detail?.id} href={href(task)} onOpen={open}
    locale={locale} viewerAction={viewerAction} actions={variant === 'compact' ? cardActions?.(task) : undefined} />;
  const of = (state: TaskState) => shown.filter(task => task.state === state);
  const empty = <Empty><EmptyHeader><EmptyTitle>No requests</EmptyTitle><EmptyDescription>No tasks match this view.</EmptyDescription></EmptyHeader></Empty>;
  const switcher = (target: TaskList, text: string) => list === target ? <span data-task-list-link={target} aria-current="page">{text}</span>
    : <a href="#" data-task-list-link={target} className="text-foreground underline underline-offset-2" onClick={(event: MouseEvent) => { event.preventDefault(); setList(target); }}>{text}</a>;
  const chooseFilter = (next: TaskFilter) => (event: MouseEvent) => { event.preventDefault(); if (filter === undefined) setOwnFilter(next); onFilterChange?.(next); };
  if (variant === 'compact') {
    const strings = compactLabels[locale];
    // Filter hidden records and prioritize current viewer needs before applying the visible limit.
    const compact = selectTasks(tasks.filter(task => task.technical !== true || compactPresentation?.includeTechnical === true), { filter: shownFilter, ...(currentUser === undefined ? {} : { currentUser }) })
      .slice().sort((a, b) => Number(compactTaskStatus(b) === 'needs-you') - Number(compactTaskStatus(a) === 'needs-you'))
      .slice(0, limit);
    const ordinary = compact.filter(task => task.technical !== true && compactTaskStatus(task) !== 'closed');
    const closed = compact.filter(task => task.technical !== true && compactTaskStatus(task) === 'closed');
    const technical = compact.filter(task => task.technical === true);
    const group = (kind: 'closed' | 'technical', records: readonly TaskRecord[]) => records.length > 0 && <Collapsible data-task-group={kind}>
      <Separator />
      <CollapsibleTrigger render={<Button variant="ghost" />}>{kind === 'closed' ? strings.finished : strings.technical} · {records.length}</CollapsibleTrigger>
      <CollapsibleContent><div role="list" aria-label={kind === 'closed' ? strings.finished : strings.technical} className="flex flex-col gap-2">{records.map(card)}</div></CollapsibleContent>
    </Collapsible>;
    return <section ref={root} data-boring="task-board" data-variant="compact" aria-label={title} className={cn('flex min-w-0 flex-col gap-2', className)}>
      <div data-task-list role="list" aria-label={title} className="flex flex-col gap-2">{ordinary.map(card)}</div>
      {!compact.length && <Empty><EmptyHeader><EmptyTitle>{strings.empty}</EmptyTitle><EmptyDescription>{strings.emptyDescription}</EmptyDescription></EmptyHeader></Empty>}
      {group('closed', closed)}
      {group('technical', technical)}
    </section>;
  }
  return <section ref={root} data-boring="task-board" data-variant={variant} aria-label={title} className={cn('flex min-h-0 min-w-0 flex-col', className)} onKeyDown={event => {
    if (event.key === 'Escape' && selected !== null && !event.defaultPrevented) { event.preventDefault(); if (fileOpen) closeFile(); else select(null); }
  }}>
    {bar && <nav data-task-bar aria-label="Task lists" className="flex h-13 shrink-0 items-center gap-2.5 px-3.5 text-[13px] text-muted-foreground">
      {barStart}
      {switcher('open', `${BOARD_STATES.reduce((sum, state) => sum + of(state).length, 0)} open`)}<span aria-hidden="true">·</span>
      {switcher('done', `Done ${of('done').length}`)}<span aria-hidden="true">·</span>
      {switcher('closed', `Closed ${of('closed').length}`)}
      {currentUser !== undefined && <span className={cn('ml-auto flex items-center gap-2.5', taskTokens.pill)} data-task-filter={shownFilter}>
        {(['mine', 'all'] as const).map(value => <Badge key={value} variant={shownFilter === value ? 'default' : 'secondary'} render={<a href="#" aria-current={shownFilter === value ? 'true' : undefined} onClick={chooseFilter(value)} />}>{value === 'mine' ? 'Mine' : 'All'}</Badge>)}
      </span>}
    </nav>}
    <div data-task-stage className="relative min-h-0 flex-1 overflow-hidden">
      <div data-task-list className="@container/task-rails h-full min-w-0 overflow-auto">
        {list === 'open' ? <div className="grid min-w-0 content-start gap-2.5 p-3.5 @2xl/task-rails:grid-cols-3">
          {BOARD_STATES.map(state => {
            const column = of(state).sort((a, b) => Number(b.waiting_on_you === true) - Number(a.waiting_on_you === true));
            const onYou = column.filter(task => task.waiting_on_you === true).length;
            return <section key={state} data-task-column={state} aria-label={labels[state]} className={cn('flex min-w-0 flex-col gap-[7px] self-start bg-muted p-2', taskTokens.column)}>
              <h3 className="flex min-h-6 items-center justify-between gap-2 px-0.5 pb-0.5 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground"><span className="uppercase">{labels[state]} {column.length}</span>{onYou > 0 && <span className={cn('contents', taskTokens.pill)}><Badge data-task-on-you="">{onYou} on you</Badge></span>}</h3>
              <div role="list" className="flex flex-col gap-[7px]">{column.map(card)}</div>
            </section>;
          })}
        </div> : <section data-task-column={list} aria-label={labels[list]} className="flex max-w-xl min-w-0 flex-col gap-[7px] p-3.5">
          <div role="list" className="flex flex-col gap-[7px]">{of(list).map(card)}</div>
          {!of(list).length && empty}
        </section>}
      </div>
      {selected !== null && <aside aria-label="Task detail" data-task-side className={cn('absolute inset-y-0 right-0 flex w-[400px] max-w-full flex-col bg-popover text-popover-foreground', overlayClassName)} aria-live="polite">
        <Separator orientation="vertical" className="absolute inset-y-0 left-0" />
        <div className="flex h-10 shrink-0 items-center gap-2 pr-1.5 pl-3.5">
          <Button ref={back} variant="ghost" size="icon" data-task-back="" aria-label="Back to the tasks" title="Back to the tasks" onClick={() => select(null)}><ChevronLeftIcon aria-hidden="true" /></Button>
          {detail && <><span className="text-[11px] text-muted-foreground">{taskMeta(detail)}</span><TaskStatusPill task={detail} locale={locale} viewerAction={viewerAction} /></>}
        </div>
        <Separator />
        <div className="min-h-0 flex-1 overflow-auto p-3.5">
          {detail ? <TaskDetail key={detail.id} task={detail} actions={actions?.(detail)} onAnswer={onAnswer} onOther={onOther} onDiscussQuestion={onDiscussQuestion} onAsk={onAsk} onOpenFile={renderFile || onOpenFile ? openFile : undefined} />
            : <Empty><EmptyHeader><EmptyTitle>Task unavailable</EmptyTitle><EmptyDescription>The host has not supplied this task.</EmptyDescription></EmptyHeader></Empty>}
        </div>
      </aside>}
      {fileOpen && detail && file && <section aria-label="Task file viewer" data-task-file-pane={detail.id} className={cn('flex min-w-0 flex-col bg-background', fileFullscreen ? 'fixed inset-0 z-50' : 'absolute inset-y-0 right-0 w-[760px] max-w-full', overlayClassName)}>
        {renderFile!(detail, file, { fullscreen: fileFullscreen, onFullscreenChange: setFileFullscreen, onClose: closeFile, onBack: closeFile, onShowFile: onShowFile ? () => onShowFile(detail, file) : undefined })}
      </section>}
    </div>
  </section>;
}
