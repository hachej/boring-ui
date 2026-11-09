import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '../../../registry/app-shell/app-shell.tsx';

// D-1909: the real AppShell, layout="workspace", for the left pane's open state (fictional data). Items: « Liste » has a `sidebar`, « Notes » has none.
// ?item=<id> is the screen on show first (`window.__go(id)` navigates); ?layout=<screen|workspace|chat> (default workspace); ?app=<name>, ?appid=<id>, ?user=<email>
// name the app, its stable id and the person (`window.__setUser(email)` signs another person in); ?throw=1 makes every localStorage access throw before the shell mounts.
const query = new URLSearchParams(location.search);
if (query.get('throw')) for (const method of ['getItem', 'setItem', 'removeItem']) Storage.prototype[method] = () => { throw new Error('storage unavailable'); };
const Dot = ({ className }) => <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" /></svg>;
const nav = [
  { id: 'Liste', label: 'Liste', icon: Dot, sidebar: () => <p data-testid="own-sidebar">Dossiers fictifs de la société Exemple</p>, render: () => <p>Écritures fictives</p> },
  { id: 'Notes', label: 'Notes', icon: Dot, render: () => <p>Notes fictives</p> },
];

function App() {
  const [user, setUser] = useState(query.get('user'));
  const [id, setId] = useState(query.get('item') ?? 'Liste');
  window.__setUser = setUser;
  window.__go = setId;
  const account = user ? { name: 'Personne fictive', email: user, menu: [] } : undefined;
  return <AppShell layout={query.get('layout') ?? 'workspace'} title={query.get('app') ?? 'Compta'} appId={query.get('appid') ?? undefined} nav={nav} account={account} route={{ id, onChange: setId }} locale="fr" />;
}

createRoot(document.getElementById('root')).render(<App />);
