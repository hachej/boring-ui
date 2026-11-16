import { createRoot } from 'react-dom/client';
import { AppShell } from '../../registry/app-shell/app-shell.tsx';
import { ScreenBody } from '../../registry/app-shell/screen-body.tsx';
import { FileTextIcon, FolderIcon } from '../../registry/_shared/icons';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';

// Layout scenario `layout:default`: the real AppShell at its defaults (nav, header, app view, the assistant's bar, the right pane, the phone's tab bar and sheet)
// over an empty app view: one kit Empty part, no app data and no app styling. Query: `dark=1`.
if (new URLSearchParams(location.search).get('dark') === '1') document.documentElement.classList.add('dark');
let snapshot = { identity: { runtimeId: 'fictional', scopeId: 'default', principalId: 'fictional-reader' }, conversationId: 'default', connection: { kind: 'connected' },
  view: { entries: [], docs: {} }, draft: { text: '', attachments: [], version: 0 }, outbox: [], echo: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
const listeners = new Set();
const change = patch => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); };
const controller = {
  getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  setText: text => change({ draft: { ...snapshot.draft, text, version: snapshot.draft.version + 1 } }),
  setAttachments: attachments => change({ draft: { ...snapshot.draft, attachments, version: snapshot.draft.version + 1 } }),
  send: async () => undefined, connect: async () => {}, stop: async () => {}, dispose: async () => {}, clearHistory() {}, loadEarlier: async () => {}, reconcile: async () => {}, retrySameRequest: async () => {},
};
const Placeholder = ({ title }) => <Empty><EmptyHeader><EmptyTitle>{title}</EmptyTitle><EmptyDescription>The app's screen goes here.</EmptyDescription></EmptyHeader></Empty>;
const nav = [{ id: 'home', label: 'Home', icon: FileTextIcon, render: () => <ScreenBody><Placeholder title="Nothing here yet" /></ScreenBody> },
  { id: 'files', label: 'Files', icon: FolderIcon, render: () => <ScreenBody><Placeholder title="No files yet" /></ScreenBody> }];
const agent = { controller, label: 'Assistant', library: () => <Placeholder title="The library is empty" />, chatProps: { title: 'Assistant', locale: 'en' } };
createRoot(document.getElementById('root')).render(<AppShell layout="screen" locale="en" title="App" nav={nav} route={{ id: 'home', onChange() {} }} composer="bar" agent={agent} />);
