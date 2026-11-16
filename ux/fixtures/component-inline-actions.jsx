import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';

// Component scenario `component:inline-actions`: Button size="inline" (a link label at text height with a 44px touch area) in the places it lives:
// a row of actions that wraps onto two lines (one that declares the room it leaves, one that does not), a table cell and a sentence. French labels of
// different lengths, fictional data. Query: dark=1, pace (ignored). `window.__ux`: fired() is the id of the last button that handled a tap, count() how many taps.
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');

const ACTIONS = [['voir', 'Voir'], ['modifier', 'Modifier la facture'], ['relancer', 'Relancer le client'], ['archiver', 'Archiver']];
const ROWS = [['03/11', 'Loyer atelier'], ['04/11', 'Eau et chauffage']];

function App() {
  const [last, setLast] = useState(null);
  const [taps, setTaps] = useState(0);
  const fire = id => () => { setLast(id); setTaps(n => n + 1); };
  window.__ux = { fired: () => last, count: () => taps };
  const action = (scope, [id, label]) => <Button key={id} size="inline" data-testid={`${scope}-${id}`} onClick={fire(`${scope}-${id}`)}>{label}</Button>;
  return <main className="flex w-full max-w-sm flex-col gap-6 p-4 text-sm leading-5">
    <p data-testid="fired" className="h-5 text-muted-foreground">{last ? `Action : ${last}` : 'Aucune action'}</p>
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">Actions sur une facture (la ligne dit la place qu'elle laisse)</h2>
      <div data-case="row-room" className="flex flex-wrap gap-x-[var(--inline-gap-x)] gap-y-[var(--inline-gap-y)] [--inline-gap-x:1.25rem] [--inline-gap-y:1.5rem]">{ACTIONS.map(a => action('room', a))}</div>
    </section>
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">Les mêmes actions, ligne serrée (rien de déclaré)</h2>
      <div data-case="row-tight" className="flex flex-wrap gap-x-3 gap-y-0">{ACTIONS.map(a => action('tight', a))}</div>
    </section>
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">Dans un tableau</h2>
      <Table data-case="table"><TableBody>{ROWS.map(([date, name], i) => <TableRow key={name}><TableCell className="py-3">{date}</TableCell><TableCell className="py-3">{name}</TableCell><TableCell className="py-3">{action(`cell${i + 1}`, ACTIONS[0])}</TableCell></TableRow>)}</TableBody></Table>
    </section>
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">Dans une phrase</h2>
      <p data-case="isolated" className="leading-6">Cette écriture est rattachée au <Button size="inline" data-testid="isolated-compte" onClick={fire('isolated-compte')}>compte 706</Button> depuis le trimestre dernier.</p>
    </section>
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);
