import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '../../../registry/app-shell/app-shell.tsx';

// D-1902: an AppShell in the default tabs mode whose nav items carry a `sidebar` (a list of rows and a search field, fictional data) or none.
// `?id=` picks the item on show, `?dark=1` the dark theme. The nav is on window.__nav so a test can hold every item to the rule: what an item renders on desktop is reachable at 390.
const Icon = ({ className }) => <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" /></svg>;
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
const rows = ['Harbour timelapse', 'Market walk', 'Night train'];
const list = state => <div className="flex flex-col gap-1 p-2">
  <input aria-label="Search" placeholder="Search" data-testid="sidebar-search" className="h-9 rounded-md border px-2" />
  {rows.map((row, at) => <button key={row} type="button" data-testid={`row-${at}`} className="min-h-11 rounded-md px-2 text-left" data-collapsed={state.collapsed}>{row}</button>)}
</div>;
const nav = [
  { id: 'library', label: 'Library', sidebarLabel: 'Videos', icon: Icon, sidebar: list, render: () => <p data-testid="library-screen">Fictional library</p> },
  { id: 'channels', label: 'Channels', icon: Icon, sidebar: () => <p className="p-2">Fictional channel list</p>, render: () => <p>Fictional channels</p> },
  { id: 'settings', label: 'Settings', icon: Icon, render: () => <p>Fictional settings</p> },
];
window.__nav = nav.map(item => ({ id: item.id, hasSidebar: typeof item.sidebar === 'function' }));
const App = () => { const [id, setId] = useState(params.get('id') ?? 'library'); return <AppShell layout="screen" title="Visual" nav={nav} route={{ id, onChange: setId }} account={{ name: 'Camille Martin', menu: [], signOut() {} }} />; };
createRoot(document.getElementById('root')).render(<App />);
