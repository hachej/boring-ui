import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from '@/components/ui/sheet';
import { TaskBoard, TaskDetail } from '../../registry/task-board/task-board';
import type { TaskCard, TaskLayout } from '../../registry/task-board/task-board';

const now = Date.parse('2026-10-20T12:00:00Z');
const ago = (minutes: number) => new Date(now - minutes * 60000).toISOString();
const tasks: TaskCard[] = [
  { id: 'D-120', title: 'Draft the community workshop agenda', state: 'open', updated_at: ago(28), createdBy: 'Camille', labels: ['workshop'] },
  { id: 'D-118', title: 'Add keyboard shortcuts to the resource library', state: 'open', updated_at: ago(90), createdBy: 'viewer', children: { done: 2, total: 5 } },
  { id: 'D-115', title: 'Compare venues for the winter reading room', state: 'open', updated_at: ago(240), createdBy: 'Camille' },
  { id: 'D-119', title: 'Build the volunteer availability view', state: 'working', updated_at: ago(4), createdBy: 'viewer', children: { done: 3, total: 6 } },
  { id: 'D-116', title: 'Prepare a quieter onboarding flow', state: 'working', updated_at: ago(45), createdBy: 'Camille' },
  { id: 'D-113', title: 'Check the public catalogue for duplicate entries', state: 'working', updated_at: ago(130), createdBy: 'builder', risk: 'high' },
  { id: 'D-117', title: 'Choose the workshop registration deadline', state: 'waiting', updated_at: ago(8), waiting_on: { who: 'viewer', question: 'Should registration close on Friday 6 November, or should we keep a few places open until Monday? Camille needs the date before sending the invitation.' }, risk: 'high', createdBy: 'Camille', children: { done: 2, total: 3 }, parent: 'D-100', route: 'community/workshops', labels: ['workshop', 'decision'], spec: '## Registration deadline\n\nWe have **24 places** for the fictional winter workshop.\n\n- Reserve four places for first-time participants.\n- Give volunteers at least two days to prepare.\n- Publish the date in the community newsletter.\n\n### Decision needed\n\nChoose **Friday 6 November** or **Monday 9 November**. The invitation remains a draft until the coordinator confirms.\n\n[Workshop planning notes](https://example.invalid/workshop)', history: [{ id: 'created', at: ago(1440), text: 'Camille drafted the workshop plan.' }, { id: 'review', at: ago(65), text: 'The builder checked the registration capacity.' }, { id: 'question', at: ago(8), text: 'Camille asked you to confirm the deadline.' }] },
  { id: 'D-114', title: 'Approve the welcome note for new volunteers', state: 'waiting', updated_at: ago(36), waiting_on: { who: 'viewer', question: 'Does the welcome note strike the right tone for first-time volunteers?' }, createdBy: 'viewer' },
  { id: 'D-112', title: 'Confirm the reading-room opening hours', state: 'waiting', updated_at: ago(2), waiting_on: { who: 'Camille', question: 'Can you confirm the Saturday opening hours with the venue?' }, createdBy: 'builder' },
  { id: 'D-110', title: 'Export the accessible event programme', state: 'waiting', updated_at: ago(12), waiting_on: { who: 'the builder', question: 'Waiting for the accessible PDF export to finish.' }, createdBy: 'Camille' },
  { id: 'D-108', title: 'Publish the autumn volunteer handbook', state: 'done', updated_at: ago(180), createdBy: 'viewer' },
  { id: 'D-104', title: 'Retire the old event signup form', state: 'closed', updated_at: ago(2880), createdBy: 'Camille' },
];
function App() {
  const [selected, setSelected] = useState<TaskCard | null>(null);
  const [dark, setDark] = useState(false);
  const requested: TaskLayout = new URL(location.href).searchParams.get('layout') === 'sections' ? 'sections' : 'kanban';
  return <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 p-4 sm:p-8">
    <header className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1"><p className="text-xs text-muted-foreground">Fictional community workspace</p><h1 className="text-xl font-medium">Autumn programme</h1><p className="text-sm text-muted-foreground">A calm view of what needs attention. You are the coordinator.</p></div>
      <Button variant="ghost" size="icon" aria-label={dark ? 'Use light theme' : 'Use dark theme'} onClick={() => { document.documentElement.classList.toggle('dark', !dark); setDark(!dark); }}>{dark ? <Sun data-icon="inline-start" /> : <Moon data-icon="inline-start" />}</Button>
    </header>
    <TaskBoard tasks={tasks} viewerId="viewer" defaultLayout={requested} onOpen={setSelected} now={now} />
    <p className="text-xs text-muted-foreground">Fictional data · Read-only board · Select a task to inspect it</p>
    <Sheet open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}>
      <SheetContent showCloseButton={false} className="overflow-y-auto">
        <SheetHeader><SheetTitle>Task details</SheetTitle><SheetClose render={<Button variant="ghost" size="sm" />}>Close details</SheetClose></SheetHeader>
        <div className="px-4 pb-6">{selected && <TaskDetail task={selected} viewerId="viewer" />}</div>
      </SheetContent>
    </Sheet>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
