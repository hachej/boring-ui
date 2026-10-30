import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TaskBoard, TaskDetail } from '../../registry/task-board/task-board';
import type { TaskLocale, TaskRecord } from '../../registry/task-board/task-board';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

const params = new URLSearchParams(location.search);
const locale: TaskLocale = params.get('locale') === 'en' ? 'en' : 'fr';
const fr = locale === 'fr';
if (params.has('dark')) document.documentElement.classList.add('dark');
const titles = fr ? ['Choisir les repas', 'Préparer les menus', 'Vérifier les portions', 'Partager la liste', 'Retirer un ancien choix', 'Vérifier le stockage']
  : ['Choose the meals', 'Prepare the menus', 'Check the portions', 'Share the list', 'Withdraw an earlier choice', 'Check the storage'];
const states = ['waiting', 'working', 'working', 'done', 'closed', 'working'] as const;
const tasks: readonly TaskRecord[] = states.map((state, i) => Object.freeze({
  id: `fictional-${i}`, number: 740 + i, title: `Fictional full original request ${i}: keep every meal and portion in the shared weekly plan, including all original details.`,
  display: params.has('legacy') && i === 1 ? undefined : titles[i]!, spec: 'Complete fictional need, preserved as data.', state, requesterId: 'alice',
  waiting_on_you: i === 0 || i === 4, ...(i === 2 ? { status: 'verifying' } : i === 4 ? { status: 'abandoned' } : {}),
  technical: i === 5, screen: 'Fictional planner', captureCount: 2,
}));

function CompactFixture() {
  const [selected, setSelected] = useState<TaskRecord | null>(null);
  const [intent, setIntent] = useState('');
  return <main className="mx-auto flex max-w-xl flex-col gap-4 p-4">
    <h1 className="text-lg font-semibold">{fr ? 'Mes demandes' : 'My requests'}</h1>
    <TaskBoard tasks={tasks} variant="compact" locale={locale} title={fr ? 'Mes demandes' : 'My requests'} viewerAction="confirmation"
      compactPresentation={{ includeTechnical: params.has('owner') }} onOpen={setSelected}
      cardActions={task => task.id === 'fictional-0' ? <>
        <Button variant="outline" onClick={() => setIntent(fr ? 'Modifier' : 'Edit')}>{fr ? 'Modifier' : 'Edit'}</Button>
        <Button onClick={() => setIntent(fr ? 'Confirmer' : 'Confirm')}>{fr ? 'Confirmer' : 'Confirm'}</Button>
      </> : undefined} />
    {intent && <p role="status">{intent}</p>}
    {selected && <section aria-label="Original request" className="flex flex-col gap-2">
      <Separator /><Button variant="ghost" onClick={() => setSelected(null)}>{fr ? 'Retour' : 'Back'}</Button>
      <TaskDetail task={selected} />
    </section>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<CompactFixture />);
