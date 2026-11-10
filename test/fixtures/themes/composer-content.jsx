import { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '../../../registry/app-shell/app-shell.tsx';
import { AgentComposerAnchor as Anchor, useAgentLayer } from '../../../registry/app-shell/agent-layer.tsx';
import { defaultChatIcons, defaultChatLabels } from '../../../registry/pi-chat/labels.ts';
import { SlashPicker } from '../../../registry/pi-chat-slash/slash-menu.tsx';


// D-1932: the real AppShell with an assistant over a fake controller (fictional text) whose composer sits under the page content (`?composer=content`)
// or in the dock (`?composer=dock`, today's default). The layer's api is on window.__layer; what the controller sends is on window.__sent.
// `?dark=1` picks the dark theme.
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
// Each person's tray-or-dock choice is remembered by the shell; a test starts fresh unless it asks to keep it (`?keep=1`).
if (!params.has('keep')) { try { for (const key of Object.keys(localStorage)) if (key.startsWith('boring-ui:sidebar-agent-mode') || key.startsWith('boring.app-shell.agent.')) localStorage.removeItem(key); } catch { /* none */ } }
window.__sent = [];
const assistant = content => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: 'stop', timestamp: 2 });
const entry = (id, model) => ({ id, kind: 'message', byTaskId: 100, model: [model] });
const say = (id, text) => entry(id, { role: 'user', content: text, timestamp: 1 });
const reply = (id, text) => entry(id, assistant([{ type: 'text', text }]));
let snapshot = { identity: { runtimeId: 'fictional', scopeId: 'composer-content', principalId: 'fictional-reader' }, conversationId: 'composer-content', connection: { kind: 'connected' },
  view: { entries: [say(1, 'What did the market walk cost?'), reply(2, 'The fictional market walk cost 18 euros, mostly fruit and a map.')], docs: {} },
  draft: { text: '', attachments: [], version: 0 }, outbox: [], echo: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
const listeners = new Set();
const change = patch => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); };
const controller = {
  getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  setText: text => change({ draft: { ...snapshot.draft, text, version: snapshot.draft.version + 1 } }),
  setAttachments: attachments => change({ draft: { ...snapshot.draft, attachments, version: snapshot.draft.version + 1 } }),
  send: async () => {
    const text = snapshot.draft.text;
    window.__sent.push(text);
    const next = snapshot.view.entries.length + 1;
    change({ draft: { text: '', attachments: [], version: snapshot.draft.version + 1 }, view: { entries: [...snapshot.view.entries, say(next, text), reply(next + 1, 'Noted, fictional answer.')], docs: {} } });
  },
  connect: async () => {}, stop: async () => {}, dispose: async () => {}, clearHistory() {}, loadEarlier: async () => {}, reconcile: async () => {}, retrySameRequest: async () => {},
};
const mentions = { search: async () => [], kinds: { meal: { label: path => path === '2026-10-27/lunch' ? 'Lunch · Tuesday' : path, icon: <span aria-hidden="true">m</span> } } };
const attachments = { upload: async files => files.map(file => ({ name: file.name, image: { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' } })) };
const Icon = ({ className }) => <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" /></svg>;
const Probe = () => { const api = useAgentLayer(); useLayoutEffect(() => { window.__layer = api; }); return null; };
// `?voice=1`: a fictional recorder whose button admits a voice message at once (what a finished recording does).
const voiceMessage = params.get('voice') === '1' ? {
  useRecorder: options => ({ canStart: true, phase: 'idle', seconds: 0, captureSequence: 0, problem: undefined, pending: [], start: () => options.admitted(), finish() {}, cancel() {} }),
  Button: ({ voice }) => <button type="button" data-testid="fake-voice" onClick={() => voice.start()}>mic</button>,
} : undefined;
// Local state of a screen: it must survive the shell crossing the wide breakpoint.
const Counter = () => { const [count, setCount] = useState(0); return <button type="button" data-testid="counter" onClick={() => setCount(value => value + 1)}>Count {count}</button>; };
const rows = Math.max(5, Number(params.get('rows') ?? 5));
// The screen's own box scrolls (layout="screen"): a page that holds the anchor fills it (`h-full`) and scrolls its table itself, so the field stays docked at the window's bottom.
// `?aside=1`: a 420px aside on the right inside the page, as an expert's page has; `?anchor=1` also puts the kit's AgentComposerAnchor in the main column, so the field sits under it.
const withAnchor = params.get('anchor') === '1', withAside = withAnchor || params.get('aside') === '1';
const Table = () => <div data-testid="page" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
  <Probe />
  <h1 className="text-lg font-medium">Week of the market walk</h1>
  <Counter />
  {Array.from({ length: rows }, (_, index) => <p key={index} role="row" className="flex items-center justify-between rounded-md border p-3">Row {index + 1}<button type="button" data-testid={`cite-${index + 1}`} onClick={() => window.__layer.talkAbout('@meal:2026-10-27/lunch')}>Cite</button></p>)}
</div>;
const Page = () => withAside ? <div data-testid="split" className="flex h-full min-h-0 min-w-0">
  <div data-testid="main-column" className="flex min-h-0 min-w-0 flex-1 flex-col"><Table />{withAnchor && <Anchor />}</div>
  <aside data-testid="aside" className="w-[420px] shrink-0 overflow-y-auto border-l p-4"><h2 className="text-base font-medium">Demande de justificatifs</h2><p>Trois pièces fictives manquent au dossier Cèdre.</p></aside>
</div> : <Table />;
const nav = [{ id: 'week', label: 'Week', icon: Icon, render: () => <Page /> }];

// `?pm=1`: a product-manager panel that renders nothing of its own, so the shell starts on it when the assistant is not there yet.
const panel = params.get('pm') === '1' ? { config: {}, Provider: ({ children }) => children, Layout: ({ children, navigation }) => <div className="flex min-h-0 min-w-0 flex-1 flex-col"><div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>{navigation}</div> } : undefined;
// `?bar=1`: the chat's slash list, bar buttons and the app's own words for them, passed as chatProps (D-2064 through the content composer).
const bar = params.get('bar') === '1' ? {
  slash: { Picker: SlashPicker, commands: [{ name: 'relance', description: 'Rédiger une relance fictive.', run: api => api.setText('Relance du dossier Cèdre') }], skills: [] },
  composerBarActions: true, labels: { ...defaultChatLabels, attachFiles: 'Ajouter des fichiers', commands: 'Actions du dossier' }, icons: defaultChatIcons,
} : {};
const agentSpec = { controller, icon: Icon, label: 'Assistant', chatProps: { mentions, attachments, title: 'Assistant', ...bar, ...(voiceMessage ? { voiceMessage } : {}) } };
// `?person=a@example.org` signs a fictional person in; window.__person('b@example.org') switches the account without a remount.
const Root = () => {
  const [person, setPerson] = useState(params.get('person'));
  // `?late=1`: the assistant arrives after the first render (a screen lending it, or a session that resolves), as in a real app.
  const [here, setHere] = useState(params.get('late') !== '1');
  useLayoutEffect(() => { if (!here) { const timer = setTimeout(() => setHere(true), 200); return () => clearTimeout(timer); } }, [here]);
  window.__person = setPerson;
  return <AppShell layout="screen" title="Visual" appId={params.get('app') ?? undefined} {...(person ? { account: { name: person, email: person, menu: [] } } : {})} nav={nav} route={{ id: 'week', onChange() {} }} composer={params.get('composer') ?? 'dock'} rail="icon"
    {...(here ? { agent: agentSpec } : {})} {...(panel ? { panel } : {})} />;
};
createRoot(document.getElementById('root')).render(<Root />);
