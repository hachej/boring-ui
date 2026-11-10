import { createRoot } from 'react-dom/client';
import { AppShell } from '../../../registry/app-shell/app-shell.tsx';
import { useScreenHeader } from '../../../registry/app-shell/header.tsx';
import { ScreenBody } from '../../../registry/app-shell/screen-body.tsx';

// D-2030: the real AppShell (layout="screen", no account, so the header title is the first thing in the header) with two screens (fictional data).
// ?screen=Padded|Bled picks the screen on show; ?density=compact sets data-density="compact" on <html> before the shell mounts.
const query = new URLSearchParams(location.search);
if (query.get('density')) document.documentElement.setAttribute('data-density', query.get('density'));
// The kit sizes an icon through its data-icon attribute and size-4, as lucide icons do.
const Dot = ({ className = '' }) => <svg data-icon="inline-start" className={`size-4 ${className}`} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" /></svg>;
const ROWS = ['Premier jour', 'Deuxième jour', 'Troisième jour'];
// ?back=1 gives the screen a back button before the header title, through the shell's own header API.
function Padded() {
  useScreenHeader({ ...(query.get('back') ? { back() {} } : {}) });
  return <ScreenBody><p className="m-0">Écritures fictives de la société Exemple</p></ScreenBody>;
}
// Rows draw their own divider (border token) and the second one is selected, so the bleed shows: backgrounds edge to edge, text on the gutter.
function Bled() {
  useScreenHeader({ ...(query.get('back') ? { back() {} } : {}) });
  return <ScreenBody bleed><ul className="m-0 list-none p-0">{ROWS.map((row, index) => <li key={row} data-testid={index === 1 ? 'row-selected' : undefined} className={`flex items-center border-b border-border py-3 ${index === 1 ? 'bg-muted' : ''}`}><span>{row}</span></li>)}</ul></ScreenBody>;
}
const nav = [
  { id: 'Padded', label: 'Compta', icon: Dot, render: () => <Padded /> },
  { id: 'Bled', label: 'Banque', icon: Dot, render: () => <Bled /> },
];

createRoot(document.getElementById('root')).render(<AppShell layout="screen" title="Compta" nav={nav} route={{ id: query.get('screen') ?? 'Padded', onChange() {} }} locale="fr" />);
