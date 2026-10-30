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
