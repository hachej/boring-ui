// Fictional task data for the PM panel fixture, and the host's rendering of the task-board seam (`StudioTaskBoardSeam`).
// PR #1900 (D-417) owns the shared `TaskRequestCard variant="compact"`; until it lands, this fixture draws C7's card with the host's
// own shadcn pieces so the comparison has the mockup's card. The kit ships no card of its own.
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Button } from '../app-shell/components/ui/button';

export interface FixtureTask { readonly id: string; readonly title: string; readonly mine: boolean; readonly onYou: boolean; readonly screen: string; readonly captures: number }
export const TASKS: readonly FixtureTask[] = [
  { id: 'D-201', title: 'Protéines avant les calories sur les cartes repas', mine: true, onYou: true, screen: 'Ma journée', captures: 2 },
  { id: 'D-202', title: 'Plan du jour : photo du déjeuner', mine: true, onYou: false, screen: 'Ma journée', captures: 1 },
  { id: 'D-203', title: 'Rappel de pesée du dimanche', mine: true, onYou: false, screen: 'Progrès', captures: 0 },
  { id: 'D-310', title: 'Un repère sur la jauge', mine: false, onYou: false, screen: 'Progrès', captures: 1 },
];

export const TASKS_EN: readonly FixtureTask[] = [
  { id: 'D-201', title: 'Protein before calories on meal cards', mine: true, onYou: true, screen: 'My day', captures: 2 },
  { id: 'D-202', title: 'Day plan: lunch photo', mine: true, onYou: false, screen: 'My day', captures: 1 },
  { id: 'D-203', title: 'Sunday weigh-in reminder', mine: true, onYou: false, screen: 'Progress', captures: 0 },
];

const box: CSSProperties = { border: '1px solid var(--border)', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 };
const pill = (confirmed: boolean): CSSProperties => ({ fontSize: 12, fontWeight: 600, borderRadius: 99, padding: '2px 8px', color: confirmed ? 'var(--coach-ok-foreground)' : 'var(--coach-warning-foreground)', background: confirmed ? 'var(--coach-ok)' : 'var(--coach-warning)' });

function CompactCard({ task, onConfirm, onModify }: { readonly task: FixtureTask; readonly onConfirm?: (id: string) => void; readonly onModify?: (text: string) => void }) {
  const [confirmed, setConfirmed] = useState(false);
  return <div data-testid="pm-request-card" data-task={task.id} style={box}>
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <span style={{ flex: 1, fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--coach-subtle)' }}>DEMANDE</span>
      <span data-testid="pm-request-status" style={pill(confirmed)}>{confirmed ? 'Confirmée' : 'À confirmer'}</span>
    </div>
    <div style={{ fontSize: 15, fontWeight: 650, lineHeight: 1.2 }}>{task.title}</div>
    <div style={{ fontSize: 13, color: 'var(--coach-subtle)' }}>Écran : {task.screen} · {task.captures} capture{task.captures > 1 ? 's' : ''}</div>
    {onConfirm && !confirmed && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
      <Button variant="outline" data-testid="pm-request-modify" className="min-h-11" style={{ '--radius': '10px', fontSize: 14 } as CSSProperties} onClick={() => onModify?.(task.title)}>Modifier</Button>
      <Button data-testid="pm-request-confirm" className="min-h-11" style={{ '--radius': '10px', fontSize: 14, fontWeight: 600 } as CSSProperties} onClick={() => { setConfirmed(true); onConfirm(task.id); }}>Confirmer</Button>
    </div>}
  </div>;
}

export function renderRequest(onConfirm: (id: string) => void, onModify: (text: string) => void) {
  return <CompactCard task={TASKS[0]!} onConfirm={onConfirm} onModify={onModify} />;
}

export function renderTaskBoard(options: { readonly filter: 'mine'; readonly variant: 'full' | 'compact'; readonly limit?: number }) {
  const tasks = TASKS.filter(task => task.mine).slice(0, options.limit);
  return <div data-testid="studio-task-board-seam" data-filter={options.filter} data-variant={options.variant} style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
    {tasks.map(task => <CompactCard key={task.id} task={task} />)}
  </div>;
}
