import { createRoot } from 'react-dom/client';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';

// D-1861: the real kit Table, fictional ledger. Row 1 holds a long one-line cell (truncate) beside a wrapping label cell; row 2 has short text. ?theme=light|dark
const query = new URLSearchParams(location.search);
document.documentElement.classList.toggle('dark', query.get('theme') === 'dark');
const long = 'Camille Durand-Lefebvre (cabinet fictif), saisie complète du dossier de clôture annuelle';

createRoot(document.getElementById('root')).render(<main data-case="table" className="p-4">
  <Table><TableBody>
    <TableRow data-long="1"><TableCell>03/11</TableCell><TableCell data-label="1">Loyer</TableCell><TableCell truncate data-cell="long">{long}</TableCell><TableCell>1 240</TableCell></TableRow>
    <TableRow><TableCell>04/11</TableCell><TableCell>Eau</TableCell><TableCell truncate data-cell="short">Camille</TableCell><TableCell>86</TableCell></TableRow>
    <TableRow><TableCell>05/11</TableCell><TableCell>Thé</TableCell><TableCell data-cell="plain">{long}</TableCell><TableCell>9</TableCell></TableRow>
  </TableBody></Table>
</main>);
