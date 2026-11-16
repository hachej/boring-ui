import { useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '../../registry/app-shell/app-shell.tsx';
import { useScreenHeader } from '../../registry/app-shell/header.tsx';
import { ScreenBody } from '../../registry/app-shell/screen-body.tsx';
import { Button } from '@/components/ui/button';
import { FileTextIcon, ListIcon } from '../../registry/_shared/icons.ts';

// Layout scenario `layout:update-notice`: the real AppShell (layout="screen", two screens, no agent) with its `update` prop on, over a long screen
// whose last control is a button. The host's version check is a tiny store: `window.__ux` flips it, as a poll or a service worker would.
// Query: dark=1, lang=fr|en (default en), version=<name> (the version that is online; default v2), update=1 (online from the start).
// `window.__ux`: setUpdate(bool), newVersion(name), reloads() (what the Reload action was asked, in place of location.reload()), closed() (taps on the last control).
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
const locale = params.get('lang') === 'fr' ? 'fr' : 'en';

let state = { available: params.get('update') === '1', version: params.get('version') ?? 'v2', reloads: 0, closed: 0 };
const listeners = new Set();
const change = patch => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
const useStore = () => useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => state);
window.__ux = { setUpdate: available => change({ available }), newVersion: version => change({ version, available: true }), reloads: () => state.reloads, closed: () => state.closed };

const ENTRIES = Array.from({ length: 14 }, (_, index) => ({ id: index + 1, label: `Entry ${index + 1} of Harbor Studio (fictional)`, amount: `${(index + 3) * 41}.00` }));

function Journal() {
  useScreenHeader({});
  return <ScreenBody>
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {ENTRIES.map(entry => <li key={entry.id} className="flex items-center justify-between rounded-lg bg-muted px-3 py-3"><span>{entry.label}</span><span className="tabular-nums">{entry.amount}</span></li>)}
    </ul>
    <div className="mt-4 flex justify-end"><Button data-testid="close-month" onClick={() => change({ closed: state.closed + 1 })}>Close the month</Button></div>
  </ScreenBody>;
}
function Bank() {
  useScreenHeader({});
  return <ScreenBody><p className="m-0">Bank statement of Harbor Studio (fictional)</p></ScreenBody>;
}
const nav = [
  { id: 'journal', label: 'Journal', icon: FileTextIcon, render: () => <Journal /> },
  { id: 'bank', label: 'Bank', icon: ListIcon, render: () => <Bank /> },
];

function Demo() {
  const [route, setRoute] = useState('journal');
  const { available, version } = useStore();
  const onReload = () => change({ reloads: state.reloads + 1 });
  return <AppShell layout="screen" title="Harbor Studio" nav={nav} route={{ id: route, onChange: setRoute }} locale={locale} update={{ available, version, onReload }} />;
}

createRoot(document.getElementById('root')).render(<Demo />);
