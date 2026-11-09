import { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '../../../registry/app-shell/app-shell.tsx';
import { useAgentLayer } from '../../../registry/app-shell/agent-layer.tsx';

// D-1932: the real AppShell with an assistant over a fake controller (fictional text) whose composer sits under the page content (`?composer=content`)
// or in the dock (`?composer=dock`, today's default). The layer's api is on window.__layer; what the controller sends is on window.__sent.
// `?dark=1` picks the dark theme.
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
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
const Page = () => <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
  <Probe />
  <h1 className="text-lg font-medium">Week of the market walk</h1>
  <Counter />
  {['Harbour timelapse', 'Market walk', 'Night train', 'Hill path', 'Bakery morning'].map(row => <p key={row} role="row" className="rounded-md border p-3">{row}</p>)}
</div>;
const nav = [{ id: 'week', label: 'Week', icon: Icon, render: () => <Page /> }];

createRoot(document.getElementById('root')).render(
  <AppShell layout="screen" title="Visual" nav={nav} route={{ id: 'week', onChange() {} }} composer={params.get('composer') ?? 'dock'} rail="icon"
    agent={{ controller, icon: Icon, label: 'Assistant', chatProps: { mentions, attachments, title: 'Assistant', ...(voiceMessage ? { voiceMessage } : {}) } }} />);
