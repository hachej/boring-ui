import { createRoot } from 'react-dom/client';
import { AppShell } from '../../../registry/app-shell/app-shell.tsx';

// D-1898: the real AppShell with a resizable left pane (fictional data). ?plain=1 leaves `resizable` off; ?min=<rem>&max=<rem> narrow the bounds;
// ?throw=1 makes every localStorage access throw before the shell mounts; ?theme=<css width> sets the theme's `--sidebar-width` on :root.
const query = new URLSearchParams(location.search);
if (query.get('throw')) for (const method of ['getItem', 'setItem', 'removeItem']) Storage.prototype[method] = () => { throw new Error('storage unavailable'); };
if (query.get('theme')) { const style = document.createElement('style'); style.textContent = `:root { --sidebar-width: ${query.get('theme')}; }`; document.head.append(style); }
const Dot = ({ className }) => <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" /></svg>;
const nav = ['Comptes', 'Écritures', 'Bilan'].map(label => ({ id: label, label, icon: Dot, render: () => <p>Écritures fictives de la société Exemple</p> }));
const bounds = query.get('min') || query.get('max') ? { min: query.get('min') ? Number(query.get('min')) : undefined, max: query.get('max') ? Number(query.get('max')) : undefined } : true;

createRoot(document.getElementById('root')).render(
  <AppShell layout="screen" title="Compta" nav={nav} route={{ id: 'Comptes', onChange() {} }} locale="fr" resizable={query.get('plain') ? undefined : bounds} />);
