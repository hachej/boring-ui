import { createRoot } from 'react-dom/client';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';

// D-1819: the real kit Table with one row holding a Badge and rows with plain text, fictional accounting data. ?theme=light|dark
const query = new URLSearchParams(location.search);
document.documentElement.classList.toggle('dark', query.get('theme') === 'dark');
const rows = [['03/11', 'Loyer', null, '1 240'], ['04/11', 'Eau', 'Validée', '86'], ['05/11', 'Thé', null, '9']];

createRoot(document.getElementById('root')).render(<main data-case="table" className="p-4">
  <Table><TableBody>
    {rows.map(([date, name, badge, amount]) => <TableRow key={name} data-badge={badge ? '1' : '0'}><TableCell>{date}</TableCell><TableCell>{name}</TableCell><TableCell>{badge ? <Badge variant="success">{badge}</Badge> : 'Brouillon'}</TableCell><TableCell>{amount}</TableCell></TableRow>)}
  </TableBody></Table>
</main>);
// Two Badges stacked inside a wrapper in a cell: the direct-child adjustment must not reach them.
const stack = document.createElement('div'); stack.id = 'stack'; document.body.append(stack);
createRoot(stack).render(<main data-stack="1" className="p-4">
  <Table><TableBody><TableRow><TableCell><div className="flex flex-col gap-1"><Badge>A</Badge><Badge>B</Badge></div></TableCell></TableRow></TableBody></Table>
</main>);
