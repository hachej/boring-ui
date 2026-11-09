import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '../../../registry/app-shell/app-shell.tsx';
import { WorkspaceBar } from '../../../registry/pi-app/workspace-bar.tsx';
import { SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuAction, SidebarMenuBadge } from '@/components/ui/sidebar';

// D-1962: fixtures for the 0.4.73 sign-off shots (fictional data). ?case=bar mounts the real WorkspaceBar with a host panel `tasks` (D-1930; `window.__command(kind)` sends a command);
// ?case=phone mounts the real AppShell with compactNav="sheet" and a nav sidebar of rows with a « … » SidebarMenuAction and a count (D-1904). ?theme=light|dark.
const query = new URLSearchParams(location.search);
document.documentElement.classList.toggle('dark', query.get('theme') === 'dark');
const Dot = ({ className }) => <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" /></svg>;

function Bar() {
  const [command, setCommand] = useState();
  window.__command = kind => setCommand(previous => ({ kind, n: (previous?.n ?? 0) + 1 }));
  const panels = [{ id: 'tasks', label: 'Tasks', icon: Dot, content: () => <div className="p-4">Fictional tasks: close the books, review the ledger</div> }];
  const conversations = { items: [{ id: 'one', title: 'Fictional plan' }], activeId: 'one', onSelect() {}, onNew() {} };
  return <div className="h-dvh"><WorkspaceBar title="Compta" conversations={conversations} library={() => <div>Fictional library</div>} panels={panels} narrow={innerWidth < 640} command={command} /><p className="p-4">Fictional conversation</p></div>;
}

const rows = [['Journal', false, null], ['Banque', true, null], ['Brouillons', false, '8'], ['Pièces justificatives de l’exercice en cours', true, '128']];
const Rows = () => <SidebarMenu>{rows.map(([label, action, count]) => <SidebarMenuItem key={label}>
  <SidebarMenuButton><span>{label}</span></SidebarMenuButton>
  {action ? <SidebarMenuAction aria-label="Plus"><span aria-hidden="true">…</span></SidebarMenuAction> : null}
  {count ? <SidebarMenuBadge>{count}</SidebarMenuBadge> : null}
</SidebarMenuItem>)}</SidebarMenu>;
const nav = ['Comptes', 'Bilan'].map(label => ({ id: label, label, icon: Dot, render: () => <p>Écritures fictives de la société Exemple</p>, ...(label === 'Comptes' ? { sidebar: () => <Rows /> } : {}) }));

createRoot(document.getElementById('root')).render(query.get('case') === 'bar' ? <Bar />
  : <AppShell layout="screen" compactNav="sheet" title="Compta" nav={nav} route={{ id: 'Comptes', onChange() {} }} account={{ name: 'Personne fictive', menu: [], signOut() {} }} />);
