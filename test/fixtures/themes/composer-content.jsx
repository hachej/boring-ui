import { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '../../../registry/app-shell/app-shell.tsx';
import { useAgentLayer } from '../../../registry/app-shell/agent-layer.tsx';

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
const Page = () => <div data-testid="page" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
  <Probe />
  <h1 className="text-lg font-medium">Week of the market walk</h1>
  <Counter />
  {Array.from({ length: rows }, (_, index) => <p key={index} role="row" className="flex items-center justify-between rounded-md border p-3">Row {index + 1}<button type="button" data-testid={`cite-${index + 1}`} onClick={() => window.__layer.talkAbout('@meal:2026-10-27/lunch')}>Cite</button></p>)}
</div>;
const nav = [{ id: 'week', label: 'Week', icon: Icon, render: () => <Page /> }];

const agentSpec = { controller, icon: Icon, label: 'Assistant', chatProps: { mentions, attachments, title: 'Assistant', ...(voiceMessage ? { voiceMessage } : {}) } };
// `?person=a@example.org` signs a fictional person in; window.__person('b@example.org') switches the account without a remount.
const Root = () => {
  const [person, setPerson] = useState(params.get('person'));
  window.__person = setPerson;
  return <AppShell layout="screen" title="Visual" {...(params.get('app') ? { appId: params.get('app') } : {})} {...(person ? { account: { name: person, email: person, menu: [] } } : {})} nav={nav} route={{ id: 'week', onChange() {} }} composer={params.get('composer') ?? 'dock'} rail="icon"
    agent={agentSpec} />;
};
createRoot(document.getElementById('root')).render(<Root />);
