import type { TaskRecord } from '@hachej/boring-ui-kit/task-board';

/** Exact adapter tokens only; terminal records must never revive stale viewer flags. Presentation is not authorization. */
export function compactTaskStatus(task: TaskRecord) {
  if (task.status === 'withdrawn' || task.status === 'abandoned' || task.status === 'closed' || (task.state === 'closed' && task.status !== 'shipped')) return 'closed';
  if (task.state === 'done' || task.status === 'shipped') return 'live';
  if (task.state === 'waiting' && task.waiting_on_you === true) return 'needs-you';
  if (task.status === 'blocked') return 'blocked';
  if (task.status === 'verifying') return 'verifying';
  return 'preparation';
}

/** Hosts author concise display titles; a legacy need is never shortened by cutting its sentence. */
export function compactTaskTitle(task: TaskRecord): string {
  return (task.display?.trim() || task.title.trim()).replace(/\s+/gu, ' ');
}

export const compactLabels = {
  en: { 'needs-you': 'Needs you', confirmation: 'To confirm', blocked: 'Blocked', verifying: 'Verification', live: 'Live', closed: 'Closed', withdrawn: 'Withdrawn', preparation: 'Preparing', finished: 'Finished', technical: 'Technical', empty: 'No requests', emptyDescription: 'No tasks match this view.' },
  fr: { 'needs-you': 'À vous', confirmation: 'À confirmer', blocked: 'Bloquée', verifying: 'Vérification', live: 'En ligne', closed: 'Fermée', withdrawn: 'Retirée', preparation: 'En préparation', finished: 'Terminées', technical: 'Technique', empty: 'Aucune demande', emptyDescription: 'Aucune demande dans cette vue.' },
} as const;

export const TASK_COLUMNS = ['needs-you', 'blocked', 'progress', 'live'] as const;
export type TaskColumn = typeof TASK_COLUMNS[number] | 'finished' | 'technical';
const RECENT_MS = 7 * 24 * 3_600_000;

/** Who acts next decides the column; shipped work stays visible for a week, then folds with everything finished. */
export function taskColumn(task: TaskRecord, now = Date.now()): TaskColumn {
  if (task.technical === true) return 'technical';
  const status = compactTaskStatus(task);
  if (status === 'closed') return 'finished';
  if (status === 'live') return now - (Date.parse(task.updated_at ?? '') || now) > RECENT_MS ? 'finished' : 'live';
  if (status === 'needs-you') return 'needs-you';
  return status === 'blocked' ? 'blocked' : 'progress';
}

export const columnLabels = {
  en: { 'needs-you': 'Needs you', blocked: 'Blocked', progress: 'In progress', live: 'Recently live', finished: 'Finished', technical: 'Technical' },
  fr: { 'needs-you': 'Attend votre avis', blocked: 'Bloquées', progress: 'En cours', live: 'En ligne récemment', finished: 'Terminées', technical: 'Technique' },
} as const;

/** What the waiting is about, when the host shared it: the viewer's open question first, then the projected one-line reason. */
export function taskWaitingText(task: TaskRecord): string | undefined {
  const open = task.waiting_on_you === true ? task.questions?.find(question => question.answer === undefined)?.text : undefined;
  return open ?? (task.state === 'waiting' ? task.waiting_on?.question?.trim() || undefined : undefined);
}

/** A card's second line: what is wanted or why it is stuck, else one plain status. */
export function taskCardLine(task: TaskRecord, locale: 'en' | 'fr' = 'en'): string {
  const status = compactTaskStatus(task), strings = compactLabels[locale];
  const label = status === 'closed' && (task.status === 'withdrawn' || task.status === 'abandoned') ? strings.withdrawn : strings[status];
  const waiting = status === 'needs-you' || status === 'blocked' ? taskWaitingText(task) : undefined;
  return !waiting ? label : status === 'needs-you' ? waiting : `${label}${locale === 'fr' ? ' : ' : ': '}${waiting}`;
}

/** The host's age when it formats one, else a short age from the last change. */
export function taskAge(task: TaskRecord, now = Date.now()): string | undefined {
  if (task.age) return task.age;
  const at = Date.parse(task.updated_at ?? '');
  if (!Number.isFinite(at)) return undefined;
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  return minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`;
}
