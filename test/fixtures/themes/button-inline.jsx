import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';

// D-1767: rows are 44px (padding on the cells, never on the Button). Button size="inline" in a table row and in a sentence, with fictional accounting data. ?theme=light|dark&with=1|0&scope=app-shell|pi-chat|boring-viewer|feedback (the registry's own floor rules for controls inside that root) (the button, or the same words as plain text).
const query = new URLSearchParams(location.search);
document.documentElement.classList.toggle('dark', query.get('theme') === 'dark');
const scope = query.get('scope');
const scopeProps = scope === 'feedback' ? { 'data-boring': 'feedback' } : scope ? { className: scope } : {};
const withButton = query.get('with') !== '0';
const noop = () => {};
const rows = [['03/11', 'Loyer', '1 240'], ['04/11', 'Eau', '86'], ['05/11', 'Thé', '9']];
const Cell = ({ children }) => <td className="px-3 py-3 text-left">{children}</td>;
const Label = ({ children, nowrap }) => withButton ? <Button size="inline" onClick={noop} className={nowrap ? "whitespace-nowrap" : undefined}>{children}</Button> : <span className={nowrap ? "whitespace-nowrap" : undefined}>{children}</span>;

createRoot(document.getElementById('root')).render(<div {...scopeProps}><main className="flex flex-col gap-8 p-4 text-sm">
  <table data-case="table" className="w-full border-collapse"><tbody>
    {rows.map(([date, name, amount]) => <tr key={name} className="border-b border-border"><Cell>{date}</Cell><Cell>{name}</Cell><Cell><Label nowrap>Compte 706</Label></Cell><Cell>{amount}</Cell></tr>)}
  </tbody></table>
  <p data-case="sentence" className="max-w-[16rem] leading-6">Cette écriture est rattachée au <Label>compte 706 des ventes de prestations de services pour l'atelier</Label> depuis le trimestre dernier.</p>
  <p data-case="bare"><Button size="inline" variant={null}>Sans variante</Button></p>
</main></div>);
