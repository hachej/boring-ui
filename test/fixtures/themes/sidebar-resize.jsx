import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '../../../registry/app-shell/app-shell.tsx';
import * as resize from '../../../registry/app-shell/sidebar-resize.tsx';
import { Sidebar, SidebarContent, SidebarInset } from '@/components/ui/sidebar';

// D-1898: the real AppShell with a resizable left pane (fictional data). ?plain=1 leaves `resizable` off; ?min=<rem>&max=<rem> narrow the bounds;
// ?app=<name>, ?appid=<id> and ?user=<email> name the app, its stable id and the signed-in person (`window.__setUser(email)` signs another person in); ?standalone=1 mounts the kit's ResizableSidebarProvider with no AppShell.
// ?throw=1 makes every localStorage access throw before the shell mounts; ?theme=<css width> sets the theme's `--sidebar-width` on :root.
const query = new URLSearchParams(location.search);
if (query.get('throw')) for (const method of ['getItem', 'setItem', 'removeItem']) Storage.prototype[method] = () => { throw new Error('storage unavailable'); };
if (query.get('theme')) { const style = document.createElement('style'); style.textContent = `:root { --sidebar-width: ${query.get('theme')}; }`; document.head.append(style); }
const Dot = ({ className }) => <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" /></svg>;
const nav = ['Comptes', 'Écritures', 'Bilan'].map(label => ({ id: label, label, icon: Dot, render: () => <p>Écritures fictives de la société Exemple</p> }));
const bounds = query.get('min') || query.get('max') ? { min: query.get('min') ? Number(query.get('min')) : undefined, max: query.get('max') ? Number(query.get('max')) : undefined } : true;

// `resize.ResizableSidebarProvider` is read at run time, so the other cases still run where the export is missing.
const standalone = <resize.ResizableSidebarProvider data-testid="app-shell" resizable={bounds} className="h-dvh">
  <Sidebar><SidebarContent><p>Comptes</p></SidebarContent><resize.ResizableRail /></Sidebar>
  <SidebarInset><p>Écritures fictives de la société Exemple</p></SidebarInset>
</resize.ResizableSidebarProvider>;

function App() {
  const [user, setUser] = useState(query.get('user'));
  window.__setUser = setUser;
  const account = user ? { name: 'Personne fictive', email: user, menu: [] } : undefined;
  return <AppShell layout="screen" title={query.get('app') ?? 'Compta'} appId={query.get('appid') ?? undefined} nav={nav} account={account} route={{ id: 'Comptes', onChange() {} }} locale="fr" resizable={query.get('plain') ? undefined : bounds} />;
}

createRoot(document.getElementById('root')).render(query.get('standalone') ? standalone : <App />);
