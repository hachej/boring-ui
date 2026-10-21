import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FloatingWindow, WindowLauncher, WindowLayer } from '../../registry/windows/windows';

const windows = [{ id: 'notes', title: 'Notes' }, { id: 'calculator', title: 'Calculatrice' }, { id: 'planning', title: 'Planning' }];

function Page() {
  return <WindowLayer storageKey="fictional.windows" persist="local">
    <main className="flex min-h-dvh flex-col gap-4 p-6">
      <header className="flex items-center justify-between gap-4"><h1>Atelier fictif</h1><WindowLauncher windows={windows} label="Ouvrir une fenêtre" /></header>
      <p>Notes, calculs et rendez-vous imaginaires. Ouvrez les fenêtres depuis le lanceur.</p>
    </main>
    <FloatingWindow id="notes" title="Notes" defaultRect={{ x: 120, y: 140, width: 420, height: 320 }}>
      <div className="flex flex-col gap-3"><label htmlFor="notes">Carnet fictif</label><Textarea id="notes" defaultValue="Préparer les cerfs-volants pour la fête du village." className="flex-1" /><Button variant="outline">Nouvelle note</Button></div>
    </FloatingWindow>
    <FloatingWindow id="calculator" title="Calculatrice" defaultRect={{ x: 580, y: 190, width: 400, height: 320 }}>
      <div className="flex flex-col gap-3"><label htmlFor="calculation">Calcul fictif</label><Input id="calculation" defaultValue="2 + 2" /><output htmlFor="calculation">4</output></div>
    </FloatingWindow>
    <FloatingWindow id="planning" title="Planning" defaultRect={{ x: 850, y: 380, width: 400, height: 320 }}>
      <ul className="flex flex-col gap-4"><li>Lundi — Atelier de cerfs-volants</li><li>Mercredi — Promenade au verger</li><li>Samedi — Fête du village</li></ul>
    </FloatingWindow>
  </WindowLayer>;
}

createRoot(document.getElementById('root')!).render(<Page />);
