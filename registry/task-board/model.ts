import type { ReactNode } from 'react';

/** Factory tasks/src/states.mjs at 40f71e9cf5c242278b4f55edc5d68eca30f62bfb. */
export const TASK_STATES = ['open', 'working', 'waiting', 'done', 'closed'] as const;
export type TaskState = typeof TASK_STATES[number];
export type TaskLayout = 'kanban' | 'sections';
export interface TaskCard {
  readonly id: string;
  readonly title: string;
  readonly state: TaskState;
  readonly waiting_on?: { readonly who: string; readonly question?: string };
  readonly risk?: string;
  readonly route?: string;
  readonly updated_at?: string;
  readonly parent?: string;
  readonly labels?: readonly string[];
  readonly createdBy?: string;
  readonly children?: { readonly done: number; readonly total: number };
  readonly spec?: string;
  readonly history?: readonly { readonly id?: string; readonly at: string; readonly text: string }[];
}

/** An app-owned data seam, not a fetching hook or a task scheduler. */
export interface TaskSource {
  readonly list: () => Promise<TaskCard[]>;
  readonly subscribe?: (cb: (tasks: TaskCard[]) => void) => () => void;
}
export interface TaskBoardLabels {
  readonly board: string;
  readonly open: string;
  readonly working: string;
  readonly waiting: string;
  readonly done: string;
  readonly closed: string;
  readonly layout: string;
  readonly kanban: string;
  readonly sections: string;
  readonly search: string;
  readonly filters: string;
  readonly waitingOnMe: string;
  readonly highRisk: string;
  readonly mine: string;
  readonly waitingOnYou: string;
  readonly waitingOn: (who: string) => string;
  readonly onYou: (count: number) => string;
  readonly count: (count: number) => string;
  readonly showGroup: (count: number, state: string) => string;
  readonly hideGroup: (count: number, state: string) => string;
  readonly children: (done: number, total: number) => string;
  readonly empty: string;
  readonly noMatches: string;
  readonly emptyGroup: string;
  readonly emptyGroupLabel: string;
  readonly details: string;
  readonly specification: string;
  readonly history: string;
  readonly question: string;
  readonly parent: string;
  readonly route: string;
  readonly tags: string;
  readonly createdBy: string;
  readonly unknownTime: string;
  readonly relativeTime: (value: number, unit: Intl.RelativeTimeFormatUnit) => string;
  readonly dateTime: (date: string) => string;
}
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
export const defaultTaskBoardLabels: TaskBoardLabels = {
  board: 'Tasks', open: 'To do', working: 'In progress', waiting: 'Waiting', done: 'Done', closed: 'Closed',
  layout: 'Layout', kanban: 'Kanban', sections: 'Sections', search: 'Search tasks', filters: 'Filter tasks',
  waitingOnMe: 'Waiting on me', highRisk: 'High risk', mine: 'Mine', waitingOnYou: 'Waiting on you',
  waitingOn: who => `On ${who}`, onYou: count => `${count} on you`, count: count => String(count),
  showGroup: (count, state) => `Show ${count} ${state.toLowerCase()}`,
  hideGroup: (count, state) => `Hide ${count} ${state.toLowerCase()}`,
  children: (done, total) => `${done}/${total}`, empty: 'No tasks yet.', noMatches: 'No tasks match your filters.',
  emptyGroup: '—', emptyGroupLabel: 'No tasks', details: 'Task details', specification: 'Specification', history: 'History',
  question: 'Question', parent: 'Parent', route: 'Route', tags: 'Labels', createdBy: 'Created by', unknownTime: 'Unknown time',
  relativeTime: (value, unit) => relative.format(value, unit), dateTime: date => new Date(date).toLocaleString('en', { timeZone: 'UTC', timeZoneName: 'short' }),
};
export interface TaskBoardProps {
  readonly tasks: readonly TaskCard[];
  readonly layout?: TaskLayout;
  readonly defaultLayout?: TaskLayout;
  readonly onLayoutChange?: (layout: TaskLayout) => void;
  readonly storageKey?: string;
  readonly viewerId?: string;
  readonly showToolbar?: boolean;
  readonly labels?: Partial<TaskBoardLabels>;
  readonly onOpen?: (task: TaskCard) => void;
  /** Owns its interaction semantics; use onOpen from the host if the override is interactive. */
  readonly renderCard?: (task: TaskCard) => ReactNode;
  readonly emptyAction?: ReactNode;
  /** Optional host clock for deterministic rendering. */
  readonly now?: number;
}
export function waitsOnViewer(task: TaskCard, viewerId: string | undefined): boolean {
  return !!viewerId && task.state === 'waiting' && task.waiting_on?.who === viewerId;
}
export function groupTasks(tasks: readonly TaskCard[], viewerId?: string): Record<TaskState, TaskCard[]> {
  const groups: Record<TaskState, TaskCard[]> = { open: [], working: [], waiting: [], done: [], closed: [] };
  for (const task of tasks) groups[task.state].push(task);
  const updated = (task: TaskCard) => { const time = Date.parse(task.updated_at ?? ''); return Number.isFinite(time) ? time : -Infinity; };
  for (const state of TASK_STATES) groups[state].sort((a, b) => Number(waitsOnViewer(b, viewerId)) - Number(waitsOnViewer(a, viewerId)) || (updated(a) === updated(b) ? 0 : updated(a) > updated(b) ? -1 : 1));
  return groups;
}
export function relativeTaskTime(date: string | undefined, now: number | undefined, labels: TaskBoardLabels): string {
  const timestamp = Date.parse(date ?? '');
  if (!Number.isFinite(timestamp) || now === undefined) return labels.unknownTime;
  const seconds = (timestamp - now) / 1000;
  const [scale, unit]: [number, Intl.RelativeTimeFormatUnit] = Math.abs(seconds) < 60 ? [1, 'second'] : Math.abs(seconds) < 3600 ? [60, 'minute'] : Math.abs(seconds) < 86400 ? [3600, 'hour'] : Math.abs(seconds) < 2592000 ? [86400, 'day'] : Math.abs(seconds) < 31536000 ? [2592000, 'month'] : [31536000, 'year'];
  return labels.relativeTime(Math.round(seconds / scale), unit);
}
