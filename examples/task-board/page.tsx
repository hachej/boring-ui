import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { TaskBoard, TaskRequestCard } from '../../registry/task-board/task-board';
import { tasks } from './tasks';

function Page() {
  const [narrow, setNarrow] = useState(false);
  const [answer, setAnswer] = useState('');
  return <main className="flex min-h-dvh min-w-0 flex-col gap-6 p-4">
    <div className="flex flex-wrap items-center gap-2"><h1>Village outings · fictional host</h1>
      <Button variant="outline" onClick={() => document.documentElement.classList.toggle('dark')}>Light / dark</Button>
      <Button variant="outline" onClick={() => setNarrow(value => !value)} data-panel-width>{narrow ? 'Wide panel' : 'Narrow panel'}</Button>
    </div>
    <div className="grid min-w-0 gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
      <aside className="flex min-w-0 flex-col gap-6" aria-label="Own requests example">
        <section className="flex flex-col gap-3"><h2>Vos dernières demandes</h2><TaskBoard tasks={tasks} filter="mine" currentUser="alice" limit={2} variant="compact" onOpen={task => {
          window.history.pushState(null, '', `?task=${encodeURIComponent(task.id)}`); window.dispatchEvent(new Event('boring:task-navigation'));
        }} /></section>
        <section className="flex flex-col gap-3"><h2>À confirmer</h2><div role="list"><TaskRequestCard task={tasks[2]!} actions={<><Button variant="outline" onClick={() => setAnswer('Fictional request: modify')}>Modifier</Button><Button onClick={() => setAnswer('Fictional request: confirm')}>Confirmer</Button></>} /></div></section>
        <p>One shared request card and the two latest own requests. No separate PM conversation is created.</p>
        <output aria-live="polite">{answer}</output>
      </aside>
      <section aria-label="Right stage" className={narrow ? 'min-h-dvh min-w-0 max-w-md lg:min-h-0' : 'min-h-dvh min-w-0 lg:min-h-0'}>
        <TaskBoard tasks={tasks} onAnswer={(task, question, value) => setAnswer(`Fictional choice: ${task.id} · ${question.id} · ${value}`)} />
      </section>
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Page />);
