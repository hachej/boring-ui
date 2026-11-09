import { createRoot } from 'react-dom/client';
import * as shell from '../../../registry/app-shell/app-shell.tsx';
import * as parts from '../../../registry/app-shell/index.ts';

// D-2030: the real AppShell (layout="screen", no account, so the header title is the first thing in the header) with two screens (fictional data).
// ?screen=Padded|Bled picks the screen on show; ?density=compact sets data-density="compact" on <html> before the shell mounts.
const query = new URLSearchParams(location.search);
if (query.get('density')) document.documentElement.setAttribute('data-density', query.get('density'));
const ScreenBody = parts.ScreenBody ?? (({ children }) => <>{children}</>);
const Dot = ({ className }) => <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" /></svg>;
const ROWS = ['Premier jour', 'Deuxième jour', 'Troisième jour'];
const nav = [
  { id: 'Padded', label: 'Compta', icon: Dot, render: () => <ScreenBody><p className="m-0">Écritures fictives de la société Exemple</p></ScreenBody> },
  { id: 'Bled', label: 'Compta', icon: Dot, render: () => <ScreenBody bleed><ul className="m-0 list-none p-0">{ROWS.map(row => <li key={row} className="flex items-center py-3"><span>{row}</span></li>)}</ul></ScreenBody> },
];

createRoot(document.getElementById('root')).render(<shell.AppShell layout="screen" title="Compta" nav={nav} route={{ id: query.get('screen') ?? 'Padded', onChange() {} }} locale="fr" />);
