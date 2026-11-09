import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentBar } from '../../../registry/agent-bar/agent-bar.tsx';
import { AgentDayLog } from '../../../registry/agent-day-log/agent-day-log.tsx';

// D-1978 part 3: the day log sheet over the agent bar, on a fictional day page. `?dark=1` picks the dark theme. The entries are the shape the app passes
// (see AgentLogEntry). What the app would see is on window: __sent (bar sends), __history (arrow taps), __selected (labels of the log's buttons).
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
window.__sent = []; window.__history = 0; window.__selected = [];

const entries = [
  { kind: 'time', id: 't1', time: '08:10' },
  { kind: 'user', id: 'u1', text: '« Flocons d’avoine 60 g, du lait et une banane »' },
  { kind: 'status', id: 's1', text: 'Petit-déjeuner · 420 kcal', result: 'Vérifié' },
  { kind: 'time', id: 't2', time: '16:30' },
  { kind: 'user', id: 'u2', text: '« Au goûter une part de tarte aux pommes et un café »' },
  { kind: 'status', id: 's2', text: 'Goûter noté · tarte en cours' },
  { kind: 'question', id: 'q1', question: 'D’où vient la tarte ?', answer: 'Boulangerie' },
  { kind: 'user', id: 'u3', text: '« C’est une tarte fine en fait »' },
  { kind: 'agent', id: 'a1', text: 'Tarte fine, alors : 230 kcal la part, pas 310.' },
  { kind: 'status', id: 's3', text: 'Goûter · 232 kcal', result: 'Corrigé' },
  { kind: 'time', id: 't3', time: '17:05' },
  { kind: 'user', id: 'u4', text: '« Combien de calories dans une tarte aux pommes ? »' },
  { kind: 'agent', id: 'a2', text: '≈ 285 kcal la part de 120 g, ≈ 237 pour 100 g. Rien n’est noté.' },
  { kind: 'time', id: 't4', time: '18:40' },
  { kind: 'user', id: 'u5', text: '« Je peux manger quoi ce soir ? »' },
  { kind: 'agent', id: 'a3', text: 'Il te reste 628 kcal et tu es à 78 g de protéines sur 120. Vise un dîner riche en protéines, léger en gras. Trois idées qui tiennent :',
    items: [{ title: 'Saumon 150 g', text: ', haricots verts, riz 100 g · ≈ 560 kcal · 38 g prot.' }, { title: 'Omelette 3 œufs', text: ', salade, pain 40 g · ≈ 450 kcal · 25 g prot.' }, { title: 'Skyr 250 g', text: ' + fruits rouges, si tu as peu faim · ≈ 220 kcal · 25 g prot.' }],
    actions: [{ label: 'Prévoir le saumon', primary: true, onSelect: () => window.__selected.push('Prévoir le saumon') }, { label: 'Autre chose', onSelect: () => window.__selected.push('Autre chose') }] },
];

const Day = () => {
  const [open, setOpen] = useState(false);
  return <div className="flex min-h-dvh flex-col bg-background text-foreground">
    <header className="flex h-16 items-baseline justify-between p-4"><p className="text-sm text-muted-foreground">Lundi 9 novembre</p><p className="text-2xl font-semibold">1 472 <span className="text-base font-medium text-muted-foreground">/ 2 100 kcal</span></p></header>
    <main className="flex flex-1 flex-col gap-3 p-4"><p className="rounded-lg bg-card p-3 text-sm">Goûter · Tarte aux pommes · 1 part</p></main>
    <div data-testid="dock" className="flex flex-col gap-2 border-t bg-background px-4 pt-3 pb-6">
      <AgentBar transcribe={async () => ''} onSend={payload => { window.__sent.push(payload); }} historyOpen={open} onHistory={() => { window.__history += 1; setOpen(value => !value); }} />
    </div>
    <AgentDayLog open={open} onOpenChange={setOpen} entries={entries} />
  </div>;
};
createRoot(document.getElementById('root')).render(<Day />);
