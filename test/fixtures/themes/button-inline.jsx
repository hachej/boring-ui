import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';

// D-1767: Button size="inline" in a table row and in a sentence, with fictional accounting data. ?theme=light|dark&with=1|0 (the button, or the same words as plain text).
const query = new URLSearchParams(location.search);
document.documentElement.classList.toggle('dark', query.get('theme') === 'dark');
const withButton = query.get('with') !== '0';
const noop = () => {};
const rows = [['03/11', 'Facture Atelier Lilas', '1 240,00'], ['04/11', 'Virement Maison Thym', '860,50'], ['05/11', 'Achat fournitures', '92,30']];
const short = [['03/11', 'Loyer', '1 240'], ['04/11', 'Eau', '86'], ['05/11', 'Thé', '9']];
const Cell = ({ children }) => <td className="px-3 py-2 text-left">{children}</td>;
const Label = ({ children, nowrap }) => withButton ? <Button size="inline" onClick={noop} className={nowrap ? "whitespace-nowrap" : undefined}>{children}</Button> : <span className={nowrap ? "whitespace-nowrap" : undefined}>{children}</span>;

createRoot(document.getElementById('root')).render(<main className="flex flex-col gap-8 p-4 text-sm">
  <table data-case="table" className="w-full border-collapse"><tbody>
    {rows.map(([date, name, amount]) => <tr key={name} className="border-b border-border"><Cell>{date}</Cell><Cell>{name}</Cell><Cell><Label nowrap>Compte 706</Label></Cell><Cell>{amount}</Cell></tr>)}
  </tbody></table>
  <table data-case="dense" className="w-full border-collapse"><tbody>
    {short.map(([date, name, amount]) => <tr key={name}><td className="px-3 py-0">{date}</td><td className="px-3 py-0">{name}</td><td className="px-3 py-0"><Label nowrap>Compte 706</Label></td><td className="px-3 py-0">{amount}</td></tr>)}
  </tbody></table>
  <p data-case="sentence" className="max-w-[16rem] leading-6">Cette écriture est rattachée au <Label>compte 706 des ventes de prestations de services pour l'atelier</Label> depuis le trimestre dernier.</p>
</main>);
