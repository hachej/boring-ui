'use client';

import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { Columns3, List, ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Toggle } from '@/components/ui/toggle';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Empty, EmptyDescription, EmptyContent } from '@/components/ui/empty';
import { cn, PHONE_BELOW } from '../utils/utils';
import { TASK_STATES, defaultTaskBoardLabels, groupTasks, relativeTaskTime, waitsOnViewer } from './model';
import type { TaskBoardLabels, TaskBoardProps, TaskCard, TaskLayout } from './model';

export { TASK_STATES, defaultTaskBoardLabels } from './model';
export type { TaskBoardProps, TaskBoardLabels, TaskCard, TaskLayout, TaskSource, TaskState } from './model';
export { TaskDetail } from './task-detail';
export type { TaskDetailProps } from './task-detail';

const stateDots = { open: 'text-muted-foreground', working: 'text-primary', waiting: 'text-[var(--warning,var(--muted-foreground))]', done: 'text-[var(--success,var(--primary))]', closed: 'text-muted-foreground' };
function subscribeViewport(cb: () => void) { window.addEventListener('resize', cb); return () => window.removeEventListener('resize', cb); }
function phoneSnapshot() { return typeof window !== 'undefined' && window.matchMedia(`(max-width: ${PHONE_BELOW - 1}px)`).matches; }
function serverSnapshot() { return false; }
function clientSnapshot() { return true; }
function subscribeHydration() { return () => {}; }
function readLayout(key: string | undefined, fallback: TaskLayout): TaskLayout {
  try { const value = key ? window.localStorage.getItem(key) : null; return value === 'kanban' || value === 'sections' ? value : fallback; }
  catch { return fallback; }
}

function DenseCard({ task, viewerId, labels, now, onOpen }: { readonly task: TaskCard; readonly viewerId: string | undefined; readonly labels: TaskBoardLabels; readonly now: number | undefined; readonly onOpen: TaskBoardProps['onOpen'] }) {
  const descriptionId = useId();
  const hasSignals = !!(task.state === 'waiting' && task.waiting_on || task.risk === 'high' || task.children);
  const content = <CardHeader>
    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
      <span className="font-mono">{task.id}</span>
      <time dateTime={Number.isFinite(Date.parse(task.updated_at ?? '')) ? task.updated_at : undefined} title={task.updated_at} className="shrink-0 tabular-nums">{relativeTaskTime(task.updated_at, now, labels)}</time>
    </div>
    <CardTitle><span className="line-clamp-2 whitespace-normal [overflow-wrap:anywhere]">{task.title}</span></CardTitle>
    {hasSignals && <div id={descriptionId} className="mt-2 flex flex-wrap items-center gap-1.5">
      {task.state === 'waiting' && task.waiting_on && <Badge variant={waitsOnViewer(task, viewerId) ? 'default' : 'secondary'} title={task.waiting_on.question}><span className="truncate">{waitsOnViewer(task, viewerId) ? labels.waitingOnYou : labels.waitingOn(task.waiting_on.who)}</span></Badge>}
      {task.state === 'waiting' && task.waiting_on?.question && <span className="sr-only">{task.waiting_on.question}</span>}
      {task.risk === 'high' && <Badge variant="destructive">{labels.highRisk}</Badge>}
      {task.children && <span className="text-xs text-muted-foreground tabular-nums">{labels.children(task.children.done, task.children.total)}</span>}
    </div>}
  </CardHeader>;
  return onOpen
    ? <Button render={<Card size="sm" />} nativeButton={false} variant="ghost" className="h-auto w-full items-stretch text-left whitespace-normal" data-task-id={task.id} aria-label={`${task.id}: ${task.title}`} aria-describedby={hasSignals ? descriptionId : undefined} onClick={() => onOpen(task)}>{content}</Button>
    : <Card size="sm" data-task-id={task.id}>{content}</Card>;
}

/** A read-only view. The host owns tasks, identity and every open action. */
export function TaskBoard({ tasks, layout, defaultLayout = 'kanban', onLayoutChange, storageKey, viewerId, showToolbar = true, labels: overrides, onOpen, renderCard, emptyAction, now: hostNow }: TaskBoardProps) {
  const labels = { ...defaultTaskBoardLabels, ...overrides };
  const phone = useSyncExternalStore(subscribeViewport, phoneSnapshot, serverSnapshot);
  const hydrated = useSyncExternalStore(subscribeHydration, clientSnapshot, serverSnapshot);
  const [preference, setPreference] = useState(() => ({ key: storageKey, value: defaultLayout, restored: false }));
  let preferred = preference.value;
  if (preference.key !== storageKey || hydrated && !preference.restored) {
    preferred = hydrated ? readLayout(storageKey, defaultLayout) : defaultLayout;
    setPreference({ key: storageKey, value: preferred, restored: hydrated });
  }
  preferred = layout ?? preferred;
  const effective = phone ? 'sections' : preferred;
  useEffect(() => { try { if (hydrated && preference.restored && storageKey) window.localStorage.setItem(storageKey, preferred); } catch { /* Storage is optional, including denied access. */ } }, [storageKey, preferred, hydrated, preference.restored]);
  const [clock, setClock] = useState(Date.now);
  useEffect(() => { if (hostNow !== undefined) return; const timer = setInterval(() => setClock(Date.now()), 60000); return () => clearInterval(timer); }, [hostNow]);
  const now = hostNow ?? (hydrated ? clock : undefined);
  const [collapsed, setCollapsed] = useState({ open: false, working: false, waiting: false, done: true, closed: true });
  const [search, setSearch] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [highRisk, setHighRisk] = useState(false);
  const [mine, setMine] = useState(false);
  const query = search.trim().toLocaleLowerCase();
  const filtered = tasks.filter(task => (!query || `${task.id} ${task.title}`.toLocaleLowerCase().includes(query)) && (!waiting || !viewerId || waitsOnViewer(task, viewerId)) && (!highRisk || task.risk === 'high') && (!mine || !viewerId || task.createdBy === viewerId));
  const groups = groupTasks(filtered, viewerId);
  const selectLayout = (values: unknown[]) => {
    const next = values[0];
    if (phone || (next !== 'kanban' && next !== 'sections') || next === preferred) return;
    if (layout === undefined) setPreference({ key: storageKey, value: next, restored: true });
    onLayoutChange?.(next);
  };
  return <section data-boring="task-board" data-layout={effective} data-preferred-layout={preferred} aria-label={labels.board} className="flex min-w-0 flex-col gap-4">
    {showToolbar && <div className="flex flex-wrap items-center gap-2" data-task-toolbar>
      {!phone && <ToggleGroup aria-label={labels.layout} value={[preferred]} onValueChange={selectLayout} size="sm">
        <ToggleGroupItem value="kanban" aria-label={labels.kanban}><Columns3 data-icon="inline-start" />{labels.kanban}</ToggleGroupItem>
        <ToggleGroupItem value="sections" aria-label={labels.sections}><List data-icon="inline-start" />{labels.sections}</ToggleGroupItem>
      </ToggleGroup>}
      <div className="min-w-0 flex-1 basis-48"><Input className="max-[640px]:min-h-11" type="search" aria-label={labels.search} placeholder={labels.search} value={search} onChange={event => setSearch(event.target.value)} /></div>
      <div role="group" aria-label={labels.filters} className="flex flex-wrap items-center gap-1">
        {viewerId && <Toggle className="max-[640px]:min-h-11" size="sm" pressed={waiting} onPressedChange={setWaiting}>{labels.waitingOnMe}</Toggle>}
        <Toggle className="max-[640px]:min-h-11" size="sm" pressed={highRisk} onPressedChange={setHighRisk}>{labels.highRisk}</Toggle>
        {viewerId && <Toggle className="max-[640px]:min-h-11" size="sm" pressed={mine} onPressedChange={setMine}>{labels.mine}</Toggle>}
      </div>
    </div>}
    {!filtered.length && <Empty><EmptyDescription>{tasks.length ? labels.noMatches : labels.empty}</EmptyDescription>{!tasks.length && emptyAction && <EmptyContent>{emptyAction}</EmptyContent>}</Empty>}
    {!!tasks.length && <ScrollArea className={cn('min-w-0', effective === 'kanban' ? '[&>[data-slot=scroll-area-viewport]]:snap-x [&>[data-slot=scroll-area-viewport]]:snap-proximity' : '[&>[data-slot=scroll-area-viewport]]:overflow-visible!')}>
      <div className={cn(effective === 'kanban' ? 'flex items-start gap-4 pb-4' : 'flex flex-col gap-4')} data-task-groups>
      {TASK_STATES.map(state => {
        const items = groups[state], folded = collapsed[state], rail = effective === 'kanban' && folded;
        const onYou = items.filter(task => waitsOnViewer(task, viewerId)).length;
        return <Collapsible key={state} open={!folded} onOpenChange={open => setCollapsed(current => ({ ...current, [state]: !open }))} data-task-state={state} className={cn('min-w-0', effective === 'kanban' && 'max-h-[calc(100dvh-12rem)] overflow-y-auto', effective === 'kanban' && (rail ? 'w-16 shrink-0 snap-start' : 'w-72 min-w-[260px] max-w-[340px] shrink-0 snap-start'))}>
          <div className="sticky top-0 bg-background py-2">
            <CollapsibleTrigger render={<Button variant="ghost" />} className={cn('w-full justify-start max-[640px]:min-h-11', rail && 'h-auto flex-col')} aria-label={folded ? labels.showGroup(items.length, labels[state]) : labels.hideGroup(items.length, labels[state])}>
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className={cn('shrink-0 text-xs', stateDots[state])}>●</span>
                {!rail && <span>{folded && effective === 'sections' ? labels.showGroup(items.length, labels[state]) : labels[state]}</span>}
                {!(folded && effective === 'sections') && <span className="text-muted-foreground tabular-nums">{labels.count(items.length)}</span>}
                {!rail && !!onYou && <span className="text-xs text-muted-foreground">{labels.onYou(onYou)}</span>}
                {folded ? <ChevronRight data-icon="inline-end" /> : <ChevronDown data-icon="inline-end" />}
              </span>
              {rail && <span className="py-3 text-sm text-muted-foreground [writing-mode:vertical-rl]">{labels[state]}</span>}
            </CollapsibleTrigger>
            {folded && !rail && <span className="sr-only">{labels.showGroup(items.length, labels[state])}</span>}
          </div>
          <CollapsibleContent className="flex flex-col gap-2">
            {items.length ? items.map(task => <div key={task.id} data-task-entry={task.id} className="p-px">{renderCard ? renderCard(task) : <DenseCard task={task} viewerId={viewerId} labels={labels} now={now} onOpen={onOpen} />}</div>) : <p className="px-3 py-2 text-sm text-muted-foreground" aria-label={labels.emptyGroupLabel}>{labels.emptyGroup}</p>}
          </CollapsibleContent>
        </Collapsible>;
      })}
      </div>
      {effective === 'kanban' && <ScrollBar orientation="horizontal" />}
    </ScrollArea>}
  </section>;
}
