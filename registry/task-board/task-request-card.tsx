'use client';

import type { MouseEvent, ReactNode } from 'react';
import type { TaskRecord, TaskState } from '@hachej/boring-ui-kit/task-board';
import { deriveTaskStatus, taskReference, taskStatusLabel } from '@hachej/boring-ui-kit/task-board';
import { Badge } from '@/components/ui/badge';
import { Item } from '@/components/ui/item';
import { cn } from '../utils/utils';
import { compactLabels, compactTaskStatus, compactTaskTitle, taskAge, taskCardLine } from './compact-presentation';

export type TaskLocale = 'en' | 'fr';
export type TaskViewerAction = 'question' | 'confirmation';
export const taskStateLabels: Readonly<Record<TaskState, string>> = { waiting: 'Waiting', working: 'Working', open: 'Open', done: 'Done', closed: 'Closed' };
/**
 * Task-board tokens, set by the host theme. Each falls back to the stock shadcn value, so a host without them looks unchanged.
 * `--task-pill-height` / `--task-pill-font-size` (pills), `--task-control-height` (question controls), `--task-column-radius`,
 * `--task-card-padding-y` / `--task-card-padding-x` (board cards).
 */
export const taskTokens = {
  pill: '*:h-[var(--task-pill-height,1.25rem)] *:text-[length:var(--task-pill-font-size,0.75rem)]',
  control: '*:h-[var(--task-control-height,2rem)]',
  card: '[&_[data-slot=item]]:px-[var(--task-card-padding-x,0.75rem)] [&_[data-slot=item]]:py-[var(--task-card-padding-y,0.625rem)]',
  column: 'rounded-[var(--task-column-radius,var(--radius-xl))]',
} as const;

/** `id · age`, e.g. « D-201 · 12m ». */
export const taskMeta = (task: TaskRecord) => [taskReference(task), task.age].filter(Boolean).join(' · ');

/**
 * One pill per task: viewer, explicit builder, then high risk (`deriveTaskStatus`); none renders nothing. Colours are theme roles:
 * primary (waiting on you), secondary (builder, sent), destructive (risk). The French app's « À confirmer / À vous » pill uses the host's
 * warning-soft tokens when it defines them. `sent` lets standalone callers opt into « Envoyée »; compact rows use their separate product status.
 */
export function TaskStatusPill({ task, locale = 'en', viewerAction = 'question', sent = false }: { readonly task: Pick<TaskRecord, 'waiting_on_you' | 'waiting_on' | 'risk'> & Partial<Pick<TaskRecord, 'state' | 'confirmed_at'>>; readonly locale?: TaskLocale | undefined; readonly viewerAction?: TaskViewerAction | undefined; readonly sent?: boolean | undefined }) {
  const status = deriveTaskStatus(task, { sent });
  const label = taskStatusLabel(status, locale, viewerAction);
  if (!label) return null;
  const warning = status === 'waiting-on-viewer' && locale === 'fr';
  const badge = <Badge data-task-status={status} variant={status === 'waiting-on-viewer' && !warning ? 'default' : status === 'high-risk' ? 'destructive' : 'secondary'}>{label}</Badge>;
  return <span className={cn('contents', taskTokens.pill, warning && '[--secondary:var(--warning-soft,var(--secondary))] [--secondary-foreground:var(--warning-soft-foreground,var(--secondary-foreground))]')}>{badge}</span>;
}
/** @deprecated The pill now follows `deriveTaskStatus`; `labels` is ignored. */
export const TaskStatusChip = TaskStatusPill as (props: { readonly task: Pick<TaskRecord, 'waiting_on_you' | 'waiting_on' | 'risk'>; readonly labels?: unknown; readonly locale?: TaskLocale; readonly viewerAction?: TaskViewerAction }) => ReactNode;

/** A card waiting on the viewer carries a 2px foreground edge: the outline border plus a 1px ring, both in the primary role. */
export function TaskAttention({ active, children }: { readonly active: boolean; readonly children: ReactNode }) {
  return active ? <div data-task-attention="" className="rounded-[var(--radius-lg)] ring-1 ring-primary [--border:var(--primary)]">{children}</div> : <>{children}</>;
}

export interface TaskRequestCardProps {
  readonly task: TaskRecord;
  /** `card`: the board card (D2). `compact`: the app's request card (C7). */
  readonly variant?: 'card' | 'compact';
  readonly selected?: boolean;
  readonly href?: string;
  readonly onOpen?: ((task: TaskRecord) => void) | undefined;
  /** Host-authorized actions of the compact card, e.g. « Modifier » and « Confirmer »; rendered as two equal columns. */
  readonly actions?: ReactNode;
  readonly locale?: TaskLocale | undefined;
  /** Explicit host context for the French viewer label: « À vous » (question) or « À confirmer » (confirmation). */
  readonly viewerAction?: TaskViewerAction | undefined;
  /** Compact only: replaces the derived status pill, e.g. a finished request's muted « En ligne » in « Mes demandes ». */
  readonly pill?: ReactNode;
  /** @deprecated Ignored; kept for source compatibility. */
  readonly labels?: unknown;
}

/** One record, two renderings: the board card (D2) and the compact request card (C7). Actions remain host-authorized. */
export function TaskRequestCard({ task, variant = 'card', selected, href, onOpen, actions, locale = 'en', viewerAction, pill: shownPill }: TaskRequestCardProps) {
  const activate = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onOpen || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); onOpen(task);
  };
  const anchor = { href, onClick: activate, 'data-task-open': task.id, 'aria-current': selected ? 'true' as const : undefined };
  const link = href ? <a {...anchor} /> : undefined;
  if (variant === 'compact') {
    const status = compactTaskStatus(task);
    const strings = compactLabels[locale];
    const label = status === 'needs-you' && viewerAction === 'confirmation' ? strings.confirmation
      : status === 'closed' && (task.status === 'withdrawn' || task.status === 'abandoned') ? strings.withdrawn : strings[status];
    const pill = shownPill ?? <Badge data-task-status={status} variant={status === 'needs-you' ? 'default' : status === 'blocked' ? 'destructive' : 'secondary'}>{label}</Badge>;
    const shortTitle = compactTaskTitle(task);
    const title = link && actions ? <a {...anchor} className="underline-offset-4 hover:underline">{shortTitle}</a> : shortTitle;
    return <div role="listitem"><Item variant="outline" className="flex-col items-stretch gap-2" data-task-card={task.id} data-variant="compact" {...(link && !actions ? { render: link } : {})}>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <span data-task-title="" className="min-w-0 text-sm font-semibold break-words">{title}</span>
        <span className="shrink-0">{pill}</span>
      </div>
      {actions && <div data-task-actions="" className="mt-1 grid grid-cols-2 gap-2 *:min-h-11 *:w-full">{actions}</div>}
    </Item></div>;
  }
  const needsYou = compactTaskStatus(task) === 'needs-you';
  const facts = [task.app, taskAge(task)].filter(Boolean).join(' · ');
  return <div role="listitem" className={cn('rounded-[var(--radius-lg)] bg-card', taskTokens.card)}>
    <Item variant="outline" className="flex-col items-stretch gap-1" data-task-card={task.id} data-selected={selected || undefined} {...(link ? { render: link } : {})}>
      <span data-task-title="" className="line-clamp-2 min-w-0 text-sm font-medium break-words text-foreground">{compactTaskTitle(task)}</span>
      <span data-task-line="" className={cn('line-clamp-2 min-w-0 text-[13px] break-words', needsYou ? 'text-foreground' : 'text-muted-foreground')}>{taskCardLine(task, locale)}</span>
      {facts && <span data-task-facts="" className="text-[11px] text-muted-foreground">{facts}</span>}
    </Item>
  </div>;
}
