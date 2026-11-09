import { createRoot } from 'react-dom/client';
import { AppShell } from '../../../registry/app-shell/app-shell.tsx';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

// D-2010: the real AppShell with `rail="hover"` (fictional data). ?app=<name>, ?appid=<id> and ?user=<email> name the app, its stable id and the signed-in person;
// ?dialog=1 gives the first screen its own sidebar content (rendered only while expanded) with a button that opens a portaled Dialog;
// ?plain=1 uses the default icon rail; ?throw=1 makes every localStorage access throw before the shell mounts.
const query = new URLSearchParams(location.search);
if (query.get('throw')) for (const method of ['getItem', 'setItem', 'removeItem']) Storage.prototype[method] = () => { throw new Error('storage unavailable'); };
const Dot = ({ className }) => <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" /></svg>;
const own = ({ collapsed }) => collapsed ? null : <div data-testid="own-sidebar" className="p-2"><p>Liste fictive</p>
  <Dialog><DialogTrigger render={<button type="button" data-testid="open-dialog">Ouvrir le dialogue</button>} /><DialogContent><DialogHeader><DialogTitle>Dialogue fictif</DialogTitle><DialogDescription>Rien de réel.</DialogDescription></DialogHeader></DialogContent></Dialog></div>;
const nav = ['Comptes', 'Écritures', 'Bilan'].map(label => ({ id: label, label, icon: Dot, render: () => <p>Écritures fictives de la société Exemple</p>, ...(label === 'Comptes' && query.get('dialog') ? { sidebar: own } : {}) }));

function App() {
  const account = query.get('user') ? { name: 'Personne fictive', email: query.get('user'), menu: [] } : undefined;
  return <AppShell layout="screen" rail={query.get('plain') ? undefined : 'hover'} title={query.get('app') ?? 'Compta'} appId={query.get('appid') ?? undefined} nav={nav} account={account} route={{ id: 'Comptes', onChange() {} }} locale="fr" />;
}

createRoot(document.getElementById('root')).render(<App />);
