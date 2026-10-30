/** Business requests supplied by the host, not Pi execution tasks. No fetching, mutation or authorization lives here. */
export const TASK_STATES = ['waiting', 'working', 'open', 'done', 'closed'] as const;
export type TaskState = typeof TASK_STATES[number];
export type TaskFilter = 'all' | 'mine' | 'waiting-on-me';

export interface TaskQuestion {
  readonly id: string;
  readonly text: string;
  /** Host-supplied display identity and timestamp for the question. */
  readonly askedBy?: string;
  readonly askedAt?: string;
  readonly options?: readonly (string | { readonly label: string; readonly value: string })[];
  readonly answer?: string;
  /** Display identity supplied by the host, not inferred from the current viewer. */
  readonly answeredBy?: string;
  /** Optional host answer timestamp; newest answers first, otherwise latest source entries first. */
  readonly answeredAt?: string;
}
export interface TaskFile {
  /** Authorized workspace path supplied by the host adapter; never derived from the task id. */
  readonly path: string;
  readonly name?: string;
  /** Presentation metadata, not permission to execute or load a file. */
  readonly kind?: 'markdown' | 'mockup' | 'capture';
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
  /** Display name of the task's app, set by a host showing several apps; cards then carry it and the bar filters by it. */
  readonly app?: string;
  /** Short host-authored display title; the original title remains the description. */
  readonly display?: string;
  /** Canonical host classification, never inferred from prose or an actor name. */
  readonly technical?: boolean;
  readonly state: TaskState;
  /** Host wording such as “À essayer”, independent of the five board columns. */
  readonly status?: string;
  /** The host adapter resolves the request's author; never inferred from an assignee. */
  readonly requesterId?: string;
  /** Host-formatted display metadata; identities here never determine ownership or filtering. */
  readonly requester?: string;
  readonly refiner?: string;
  readonly age?: string;
  /** Native viewer-relative projection, not inferred from waiting_on.who. */
  readonly waiting_on_you?: boolean;
  readonly waiting_on?: { readonly who: string; readonly question?: string; readonly type?: 'builder' | 'person' | 'other' };
  readonly risk?: string;
  readonly spec?: string;
  readonly screen?: string;
  readonly capture?: string;
  /** Number of captures attached to the request, independent of the legacy capture description. */
  readonly captureCount?: number;
  /** Authorized workspace folder supplied by the host; never synthesized from the task reference. */
  readonly folder?: string;
  readonly questions?: readonly TaskQuestion[];
  readonly files?: readonly TaskFile[];
  readonly history?: readonly TaskHistory[];
  readonly updated_at?: string;
  readonly created_at?: string;
  /** When the requester confirmed the request (« Confirmer »), from the host; absent until then. */
  readonly confirmed_at?: string;
}
export type TaskSemanticStatus = 'waiting-on-viewer' | 'waiting-on-builder' | 'high-risk' | 'sent' | 'none';

/**
 * Single-pill presentation precedence: viewer, explicit builder, high risk, then « sent » (confirmed, still `open`: nobody started)
 * when the rendering asks for it (`sent`: the requester's compact card). No workflow or authority is changed.
 */
export function deriveTaskStatus(task: Pick<TaskRecord, 'waiting_on_you' | 'waiting_on' | 'risk'> & Partial<Pick<TaskRecord, 'state' | 'confirmed_at'>>, { sent = false }: { readonly sent?: boolean } = {}): TaskSemanticStatus {
  if (task.waiting_on_you === true) return 'waiting-on-viewer';
  if (task.waiting_on?.type === 'builder') return 'waiting-on-builder';
  if (task.risk === 'high') return 'high-risk';
  if (sent && task.state === 'open' && task.confirmed_at) return 'sent';
  return 'none';
}

/** Confirmation wording is explicit host context, never inferred from a question, title or free-form status. */
export function taskStatusLabel(status: TaskSemanticStatus, locale: 'en' | 'fr' = 'en', viewerAction: 'question' | 'confirmation' = 'question'): string | undefined {
  switch (status) {
    case 'waiting-on-viewer': return locale === 'fr' ? viewerAction === 'confirmation' ? 'À confirmer' : 'À vous' : 'Waiting on you';
    case 'waiting-on-builder': return locale === 'fr' ? "Chez l'équipe" : 'Waiting on the builder';
    case 'high-risk': return locale === 'fr' ? 'Risque élevé' : 'High risk';
    case 'sent': return locale === 'fr' ? 'Envoyée' : 'Sent';
    default: return undefined;
  }
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
