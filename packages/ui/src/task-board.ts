/** Business requests supplied by the host, not Pi execution tasks. No fetching, mutation or authorization lives here. */
export const TASK_STATES = ['waiting', 'working', 'open', 'done', 'closed'] as const;
export type TaskState = typeof TASK_STATES[number];
export type TaskFilter = 'all' | 'mine' | 'waiting-on-me';

export interface TaskQuestion {
  readonly id: string;
  readonly text: string;
  readonly options?: readonly (string | { readonly label: string; readonly value: string })[];
  readonly answer?: string;
}
export interface TaskHistory {
  readonly id?: string;
  readonly at?: string;
  readonly actor?: string;
  readonly note: string;
}
export interface TaskRecord {
  readonly id: string;
  readonly number?: number | string;
  readonly title: string;
  readonly state: TaskState;
  /** Host wording such as “À essayer”, independent of the five board columns. */
  readonly status?: string;
  /** The host adapter resolves the request's author; never inferred from an assignee. */
  readonly requesterId?: string;
  readonly waiting_on_you?: boolean;
  readonly waiting_on?: { readonly who: string; readonly question?: string };
  readonly risk?: string;
  readonly spec?: string;
  readonly screen?: string;
  readonly capture?: string;
  readonly questions?: readonly TaskQuestion[];
  readonly history?: readonly TaskHistory[];
  readonly updated_at?: string;
  readonly created_at?: string;
}
export interface TaskSelection {
  readonly filter?: TaskFilter;
  readonly currentUser?: string;
  readonly limit?: number;
}

/** Newest first, stable at equal/absent dates. Filtering is presentation, not an access boundary. */
export function selectTasks(tasks: readonly TaskRecord[], { filter = 'all', currentUser, limit }: TaskSelection = {}): readonly TaskRecord[] {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) throw new RangeError('Task limit must be a nonnegative integer');
  const date = (task: TaskRecord) => { const value = Date.parse(task.updated_at ?? task.created_at ?? ''); return Number.isFinite(value) ? value : 0; };
  const selected = tasks.filter(task => filter === 'mine' ? currentUser !== undefined && task.requesterId === currentUser : filter === 'waiting-on-me' ? task.state === 'waiting' && task.waiting_on_you === true : true)
    .sort((a, b) => date(b) - date(a));
  return limit === undefined ? selected : selected.slice(0, limit);
}
export function taskReference(task: TaskRecord): string {
  return task.number === undefined ? task.id : String(task.number).startsWith('D-') ? String(task.number) : `D-${task.number}`;
}
export function taskFromUrl(url: string): string | null { return new URL(url, 'https://task.invalid').searchParams.get('task'); }
export function taskUrl(url: string, id: string | null): string {
  const next = new URL(url, 'https://task.invalid');
  if (id === null) next.searchParams.delete('task'); else next.searchParams.set('task', id);
  return next.href;
}
