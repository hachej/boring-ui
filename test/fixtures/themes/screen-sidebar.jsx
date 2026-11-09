import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '../../../registry/app-shell/app-shell.tsx';
import { FolderIcon, LibraryIcon, SettingsIcon } from '../../../registry/_shared/icons.ts';

// D-1902: an AppShell in the default tabs mode whose nav items carry a `sidebar` (a list of rows and a search field, fictional data) or none.
// `?id=` picks the item on show, `?dark=1` the dark theme. The nav is on window.__nav so a test can hold every item to the rule: what an item renders on desktop is reachable at 390.
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
const rows = ['Harbour timelapse', 'Market walk', 'Night train'];
const list = state => <div className="flex flex-col gap-1 p-2">
  <input aria-label="Search" placeholder="Search" data-testid="sidebar-search" className="h-9 rounded-md border px-2" />
  {rows.map((row, at) => <button key={row} type="button" data-testid={`row-${at}`} className="min-h-11 rounded-md px-2 text-left" data-collapsed={state.collapsed}
    onClick={at === 2 ? () => history.pushState(null, '', '/x') : undefined}>{row}</button>)}
  <div role="row" data-testid="row-field" className="p-1"><input aria-label="Rename" placeholder="Rename" data-testid="row-input" className="h-9 w-full rounded-md border px-2" /></div>
  <div data-keep-sheet="" className="p-1"><button type="button" data-testid="keep-button" className="min-h-11 rounded-md px-2">Keep</button></div>
</div>;
const nav = [
  { id: 'library', label: 'Library', sidebarLabel: 'Videos', icon: LibraryIcon, sidebar: list, render: () => <p data-testid="library-screen" className="p-4">Fictional library</p> },
  { id: 'channels', label: 'Channels', icon: FolderIcon, sidebar: () => <p className="p-2">Fictional channel list</p>, render: () => <p className="p-4">Fictional channels</p> },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, render: () => <p className="p-4">Fictional settings</p> },
];
window.__nav = nav.map(item => ({ id: item.id, hasSidebar: typeof item.sidebar === 'function' }));
const App = () => { const [id, setId] = useState(params.get('id') ?? 'library'); return <AppShell layout="screen" title="Visual" nav={nav} route={{ id, onChange: setId }} account={{ name: 'Camille Martin', menu: [], signOut() {} }} />; };
createRoot(document.getElementById('root')).render(<App />);
