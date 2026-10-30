'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { selectTasks, taskFromUrl, taskReference, taskUrl } from '@hachej/boring-ui-kit/task-board';
import type { TaskFile, TaskFilter, TaskRecord } from '@hachej/boring-ui-kit/task-board';
import { ChevronLeftIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Separator } from '@/components/ui/separator';
import { cn } from '../utils/utils';
import { TaskRequestCard, TaskStatusPill, taskMeta, taskTokens } from './task-request-card';
import type { TaskLocale, TaskViewerAction } from './task-request-card';
import { TaskDetail } from './task-detail';
import type { TaskDetailProps } from './task-detail';
import { columnLabels, compactLabels, compactTaskStatus, TASK_COLUMNS, taskColumn } from './compact-presentation';
import type { TaskColumn } from './compact-presentation';

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
const FOLDED = ['finished', 'technical'] as const;

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
  /** @deprecated Ignored: columns follow who acts next and `locale`. */
  readonly labels?: unknown;
  /** The tasks bar (host content, app filter, Mine/All). Hosts that draw it in their own header pass false. */
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
 * The one task board: columns by who acts next (needs you, blocked, in progress, recently live), finished and technical folded. The
 * panel's own width decides the layout, so a narrow pane or phone gets the same sections stacked. The detail opens 400px wide over the
 * board, whole-pane when narrower; a file opens 760px wide over the detail. `variant="compact"` stacks C7 cards.
 */
export function TaskBoard({ tasks, filter, onFilterChange, currentUser, limit, variant = 'board', compactPresentation, title = 'Tasks', bar = true, barStart, locale = 'en', viewerAction,
  selectedTask, onSelectedTaskChange, onOpen, actions, cardActions, onAnswer, onOther, onDiscussQuestion, onAsk, onOpenFile, onShowFile, renderFile, overlayClassName, className }: TaskBoardProps) {
  const urlSelection = useSyncExternalStore(subscribe, readSelection, serverSelection);
  const [ownFilter, setOwnFilter] = useState<TaskFilter>(currentUser === undefined ? 'all' : 'mine');
  const [unfolded, setUnfolded] = useState<ReadonlySet<TaskColumn>>(() => new Set());
  const [app, setApp] = useState<string | null>(null);
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
  const previous = useRef<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const cardLink = (id: string) => [...root.current?.querySelectorAll<HTMLAnchorElement>('[data-task-open]') ?? []].find(candidate => candidate.dataset['taskOpen'] === id);
  const unfold = (column: TaskColumn, open: boolean) => setUnfolded(current => { const next = new Set(current); if (open) next.add(column); else next.delete(column); return next; });
  useEffect(() => {
    if (selected !== null) back.current?.focus();
    else if (previous.current !== null) {
      const id = previous.current, link = cardLink(id), record = tasks.find(task => task.id === id);
      if (link) link.focus();
      else if (record) { pendingFocus.current = id; unfold(taskColumn(record), true); }
    }
    previous.current = selected === null ? null : detail?.id ?? selected;
  }, [selected, detail?.id]);
  useEffect(() => { if (pendingFocus.current !== null) { cardLink(pendingFocus.current)?.focus(); pendingFocus.current = null; } }, [unfolded]);
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
  const apps = [...new Set(shown.flatMap(task => task.app ? [task.app] : []))].sort();
  const listed = app === null ? shown : shown.filter(task => task.app === app);
  const words = columnLabels[locale];
  const of = (column: TaskColumn) => listed.filter(task => taskColumn(task) === column).sort((a, b) => (Date.parse(b.updated_at ?? '') || 0) - (Date.parse(a.updated_at ?? '') || 0));
  const appChip = (value: string | null, text: string) => <Badge key={text} data-task-app-filter={text} variant={app === value ? 'default' : 'secondary'} render={<a href="#" aria-current={app === value ? 'true' : undefined} onClick={(event: MouseEvent) => { event.preventDefault(); setApp(value); }} />}>{text}</Badge>;
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
      {apps.length > 1 && <span className={cn('flex min-w-0 flex-wrap items-center gap-1.5', taskTokens.pill)} data-task-apps="">{appChip(null, locale === 'fr' ? 'Toutes' : 'All apps')}{apps.map(name => appChip(name, name))}</span>}
      {currentUser !== undefined && <span className={cn('ml-auto flex items-center gap-2.5', taskTokens.pill)} data-task-filter={shownFilter}>
        {(['mine', 'all'] as const).map(value => <Badge key={value} variant={shownFilter === value ? 'default' : 'secondary'} render={<a href="#" aria-current={shownFilter === value ? 'true' : undefined} onClick={chooseFilter(value)} />}>{value === 'mine' ? 'Mine' : 'All'}</Badge>)}
      </span>}
    </nav>}
    <div data-task-stage className="relative min-h-0 flex-1 overflow-hidden">
      <div data-task-list className="@container/task-rails h-full min-w-0 overflow-auto">
        <div className="grid min-w-0 content-start gap-2.5 p-3.5 @3xl/task-rails:grid-cols-4">
          {TASK_COLUMNS.map(column => {
            const rows = of(column);
            // Stacked, an empty section is noise; side by side, a column keeps its place so the board does not shift.
            return <section key={column} data-task-column={column} aria-label={words[column]} className={cn('min-w-0 flex-col gap-[7px] self-start bg-muted p-2', rows.length ? 'flex' : 'hidden @3xl/task-rails:flex', taskTokens.column)}>
              <h3 className="flex min-h-6 items-center gap-1.5 px-0.5 pb-0.5 text-xs font-semibold text-muted-foreground">{words[column]}<span className="font-normal">{rows.length}</span></h3>
              <div role="list" className="flex flex-col gap-[7px]">{rows.map(card)}</div>
            </section>;
          })}
        </div>
        {!listed.length && empty}
        {FOLDED.map(column => {
          const rows = of(column);
          return rows.length > 0 && <Collapsible key={column} data-task-group={column} className="px-3.5 pb-2" open={unfolded.has(column)} onOpenChange={open => unfold(column, open)}>
            <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="text-muted-foreground" />}>{words[column]} · {rows.length}</CollapsibleTrigger>
            <CollapsibleContent><div role="list" aria-label={words[column]} className="grid gap-[7px] pt-1.5 @3xl/task-rails:grid-cols-4">{rows.map(card)}</div></CollapsibleContent>
          </Collapsible>;
        })}
      </div>
      {selected !== null && <aside aria-label="Task detail" data-task-side className={cn('absolute inset-y-0 right-0 flex w-[400px] max-w-full flex-col bg-popover text-popover-foreground', overlayClassName)} aria-live="polite">
        <Separator orientation="vertical" className="absolute inset-y-0 left-0" />
        <div className="flex h-10 shrink-0 items-center gap-2 pr-1.5 pl-3.5">
          <Button ref={back} variant="ghost" size="icon" data-task-back="" aria-label="Back to the tasks" title="Back to the tasks" onClick={() => select(null)}><ChevronLeftIcon aria-hidden="true" /></Button>
          {detail && <><span className="text-[11px] text-muted-foreground">{[detail.app, taskMeta(detail)].filter(Boolean).join(' · ')}</span><TaskStatusPill task={detail} locale={locale} viewerAction={viewerAction} /></>}
        </div>
        <Separator />
        <div className="min-h-0 flex-1 overflow-auto p-3.5">
          {detail ? <TaskDetail key={detail.id} task={detail} locale={locale} actions={actions?.(detail)} onAnswer={onAnswer} onOther={onOther} onDiscussQuestion={onDiscussQuestion} onAsk={onAsk} onOpenFile={renderFile || onOpenFile ? openFile : undefined} />
            : <Empty><EmptyHeader><EmptyTitle>Task unavailable</EmptyTitle><EmptyDescription>The host has not supplied this task.</EmptyDescription></EmptyHeader></Empty>}
        </div>
      </aside>}
      {fileOpen && detail && file && <section aria-label="Task file viewer" data-task-file-pane={detail.id} className={cn('flex min-w-0 flex-col bg-background', fileFullscreen ? 'fixed inset-0 z-50' : 'absolute inset-y-0 right-0 w-[760px] max-w-full', overlayClassName)}>
        {renderFile!(detail, file, { fullscreen: fileFullscreen, onFullscreenChange: setFileFullscreen, onClose: closeFile, onBack: closeFile, onShowFile: onShowFile ? () => onShowFile(detail, file) : undefined })}
      </section>}
    </div>
  </section>;
}
