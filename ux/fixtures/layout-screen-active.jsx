import { useEffect, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell, ScreenBody, useScreenActive, useScreenHeader } from '../../registry/app-shell/index.ts';

// Layout scenario `layout:screen-active`: the real AppShell with two screens that each print what `useScreenActive()` says to them (fictional data).
// The shell keeps both mounted. A hash router owns the URL; with no hash the first screen is the one on show.
// Query: dark=1, pace (ignored), at=<screen id> sets that hash before the shell mounts (a deep link); no `at` leaves the address without a hash.
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
if (params.get('at')) history.replaceState(null, '', `#${params.get('at')}`);

const Dot = ({ className = '' }) => <svg data-icon="inline-start" className={`size-4 ${className}`} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" /></svg>;

// What each mounted screen reported, so the screen on show can list both words.
const seen = new Map();
const listeners = new Set();
const report = (id, active) => { seen.set(id, active); for (const listener of listeners) listener(); };
const snapshot = () => [...seen].map(([id, active]) => `${id}:${active}`).join('|');
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
const SCREENS = [{ id: 'balance', label: 'Balance', title: 'Balance (fictional)' }, { id: 'journal', label: 'Journal', title: 'Journal (fictional)' }];

function Report() {
  useSyncExternalStore(subscribe, snapshot);
  return <ul className="m-0 mt-3 list-none p-0">{SCREENS.map(({ id, label }) => <li key={id} className="flex justify-between border-b border-border py-2"><span>{label}</span><span data-testid={`seen-${id}`}>{seen.get(id) === undefined ? '' : seen.get(id) ? 'shown' : 'hidden'}</span></li>)}</ul>;
}

function Screen({ id, title }) {
  const active = useScreenActive();
  useScreenHeader({ title });
  useEffect(() => report(id, active), [id, active]);
  return <ScreenBody>
    <p className="m-0">This screen says: <strong data-testid={`state-${id}`} data-active={active}>{active ? 'shown' : 'hidden'}</strong></p>
    <Report />
  </ScreenBody>;
}

const nav = SCREENS.map(({ id, label, title }) => ({ id, label, icon: Dot, render: () => <Screen id={id} title={title} /> }));

function App() {
  const hash = useSyncExternalStore(listener => { addEventListener('hashchange', listener); return () => removeEventListener('hashchange', listener); }, () => location.hash.slice(1));
  return <AppShell layout="screen" title="Ledger (fictional)" nav={nav} locale="en" route={{ id: hash, onChange: id => { location.hash = id; } }} />;
}

createRoot(document.getElementById('root')).render(<App />);
