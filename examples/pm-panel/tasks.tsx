// Fictional task records for the PM panel fixture, drawn with the shared task board (`task-board` item, PR #1900): C7's request card is
// `TaskRequestCard variant="compact"` with the host's « Modifier » / « Confirmer » actions. The fixture owns no card of its own.
import type { TaskRecord } from '@hachej/boring-ui-kit/task-board';
import { TaskRequestCard } from '../../registry/task-board/task-board';
import { Button } from '../app-shell/components/ui/button';

export const VIEWER = 'alice';

export const TASKS: readonly TaskRecord[] = [
  { id: 'D-201', title: 'Protéines avant les calories sur les cartes repas', state: 'waiting', requesterId: VIEWER, waiting_on_you: true, screen: 'Ma journée', captureCount: 1 },
  { id: 'D-202', title: 'Plan du jour : photo du déjeuner', state: 'open', requesterId: VIEWER, screen: 'Ma journée', captureCount: 1 },
  { id: 'D-203', title: 'Rappel de pesée du dimanche', state: 'open', requesterId: VIEWER, screen: 'Progrès', captureCount: 0 },
  { id: 'D-310', title: 'Un repère sur la jauge', state: 'open', requesterId: 'bruno', screen: 'Progrès', captureCount: 1 },
];

export const TASKS_EN: readonly TaskRecord[] = [
  { id: 'D-201', title: 'Protein before calories on meal cards', state: 'waiting', requesterId: VIEWER, waiting_on_you: true, screen: 'My day', captureCount: 2 },
  { id: 'D-202', title: 'Day plan: lunch photo', state: 'open', requesterId: VIEWER, screen: 'My day', captureCount: 1 },
  { id: 'D-203', title: 'Sunday weigh-in reminder', state: 'open', requesterId: VIEWER, screen: 'Progress', captureCount: 0 },
];

/** Confirming takes the request off the viewer: the host updates its record, and the card's « À confirmer » pill goes. */
export const confirmed = (tasks: readonly TaskRecord[], id: string): readonly TaskRecord[] =>
  tasks.map(task => task.id === id ? { ...task, state: 'working', waiting_on_you: false } : task);

export function RequestCard({ task, onConfirm, onModify }: { readonly task: TaskRecord; readonly onConfirm: (id: string) => void; readonly onModify: (text: string) => void }) {
  return <TaskRequestCard task={task} variant="compact" locale="fr" viewerAction="confirmation" actions={task.waiting_on_you ? <>
    <Button variant="outline" data-testid="pm-request-modify" onClick={() => onModify(task.title)}>Modifier</Button>
    <Button data-testid="pm-request-confirm" onClick={() => onConfirm(task.id)}>Confirmer</Button>
  </> : undefined} />;
}
