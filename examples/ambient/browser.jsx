// Browser side of the ambient demo: a fictional settings console (the "existing app") with the pi-chat AmbientChat floating over it.
// The console is ordinary host markup. The agent is one component driven by a native chat controller over the remote chat transport.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MicIcon } from 'lucide-react';
import { AmbientChat, createNotificationStore, watchConversation } from '../../registry/pi-ambient/ambient.tsx';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';
import { useRemoteChat } from '../../registry/pi-app/use-remote-chat.ts';
import { createArtifactPanel } from './artifact-panel.jsx';
import { PiChat } from '../../registry/pi-chat/pi-chat.tsx';
import { micSupported, openMicrophone } from './mic.mjs';

const { token, identity } = window.__AMBIENT__;
const authorized = request => { const headers = new Headers(request.headers); headers.set('authorization', `Bearer ${token}`); return fetch(new Request(request, { headers })); };
const api = async (path, init) => { const response = await authorized(new Request(new URL(path, location.href), init)); if (!response.ok) throw new Error(`${path}: ${response.status}`); return response.json(); };
const params = new URLSearchParams(location.search);
const STORED = 'ambient.conversation';
const stored = () => { try { return sessionStorage.getItem(STORED) ?? undefined; } catch { return undefined; } };
const remember = id => { try { sessionStorage.setItem(STORED, id); } catch { /* a convenience */ } };

/** A connected controller for a background task's conversation; the host owns and disposes it. */
async function connect(conversationId) {
  // Every connection here feeds the notification store, and system notifications show only while the page is hidden: the stream
  // must stay open in the background, or a run that finishes there would raise nothing until the tab is visible again.
  const remote = await createRemoteChat({ endpoint: new URL(`/api/chat?conversation=${conversationId}`, location.href), fetch: authorized, pauseWhenHidden: false });
  const controller = createNativeChatController({ identity, ...remote });
  try { await controller.connect(); } catch (error) { controller.dispose(); void remote.close(); throw error; }
  return { controller, remote };
}

function useConversations(activeId) {
  const [items, setItems] = useState(null);
  const refresh = useRef(() => {});
  useEffect(() => {
    let off = false;
    const load = () => api('/api/conversations').then(result => { if (!off) setItems(result.conversations); }).catch(() => {});
    refresh.current = load;
    load();
    const timer = setInterval(load, 4000);
    return () => { off = true; clearInterval(timer); };
  }, [activeId]);
  return [items, () => refresh.current()];
}

/** Host-provided controls in the composer row. Both are the host's, not the component's. */
function HostTools() {
  const [listening, setListening] = useState(false);
  const stop = useRef(null);
  useEffect(() => () => stop.current?.(), []);
  const toggleMic = async () => {
    if (stop.current) { stop.current(); stop.current = null; setListening(false); return; }
    try { stop.current = await openMicrophone(); setListening(true); } catch { setListening(false); }
  };
  // Only a button that does something: the microphone is shown where the browser has one.
  return micSupported() ? <button type="button" className="nw-tool" data-testid="host-tool-mic" aria-pressed={listening} aria-label={listening ? 'Stop listening' : 'Listen'} title={listening ? 'Stop listening' : 'Listen'} onClick={() => { void toggleMic(); }}><MicIcon size={16} aria-hidden="true" /></button> : null;
}

const PAGES = ['settings/general.md', 'settings/notifications.md', 'billing/invoices.md'];
const readImage = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve({ name: file.name, image: { data: String(reader.result).split(',')[1] ?? '', mimeType: file.type || 'image/png' } });
  reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
  reader.readAsDataURL(file);
});

function Console({ onTask, taskNote, note }) {
  const [saved, setSaved] = useState(false);
  return <div className="nw-app">
    <aside className="nw-side">
      <div className="nw-brand"><span className="nw-logo" aria-hidden="true" />Northwind</div>
      <ul className="nw-nav">{['Overview', 'Projects', 'Team', 'Billing'].map(name => <li key={name}><a href="#" onClick={event => event.preventDefault()}>{name}</a></li>)}
        <li><a href="#" aria-current="page" onClick={event => event.preventDefault()}>Settings</a></li></ul>
      <h2>Background</h2>
      <button type="button" className="nw-btn nw-task" data-testid="host-task" onClick={onTask}>Run nightly export check</button>
      <span className="nw-saved" data-testid="host-task-note">{taskNote}</span>
    </aside>
    <main className="nw-main">
      <h1>Workspace settings</h1>
      <p className="nw-lede">Manage how your Northwind workspace looks, notifies and connects. An invented console for this demo.</p>
      <p className="nw-lede" data-testid="host-note" role="status">{note}</p>
      <form className="nw-card" onSubmit={event => { event.preventDefault(); setSaved(true); }}>
        <h2>General</h2><p>The name your team sees across the console.</p>
        <div className="nw-field"><label htmlFor="workspace-name">Workspace name</label><input id="workspace-name" defaultValue="Acme Harbor" onChange={() => setSaved(false)} /></div>
        <div className="nw-field"><label htmlFor="region">Region</label><select id="region" defaultValue="eu-north"><option value="eu-north">Northern Europe</option><option value="us-east">US East</option><option value="ap-south">Asia Pacific</option></select></div>
        <div className="nw-field"><label htmlFor="webhook">Webhook URL</label><input id="webhook" defaultValue="https://hooks.example.test/northwind" onChange={() => setSaved(false)} /></div>
        <button type="submit" className="nw-btn primary" data-testid="host-save">Save changes</button><span className="nw-saved" data-testid="host-saved" role="status">{saved ? 'Saved' : ''}</span>
      </form>
      <section className="nw-card"><h2>Notifications</h2><p>Choose what the console tells you about.</p>
        {[['Deployment failures', 'Email the on-call group when a deployment fails.'], ['Weekly summary', 'A Monday digest of usage and spend.'], ['Billing alerts', 'Tell the owners when spend passes 80% of budget.']].map(([name, hint], index) =>
          <div className="nw-row" key={name}><div><strong>{name}</strong><span>{hint}</span></div><input className="nw-switch" type="checkbox" role="switch" aria-label={name} defaultChecked={index !== 1} /></div>)}
      </section>
      <section className="nw-card"><h2>API keys</h2><p>Keys created for this workspace.</p>
        <table className="nw-table"><thead><tr><th>Name</th><th>Created</th><th>Last used</th></tr></thead><tbody>
          <tr><td>ci-pipeline</td><td>12 Mar</td><td>Today</td></tr><tr><td>reporting</td><td>2 Apr</td><td>3 days ago</td></tr><tr><td>staging-bot</td><td>19 Apr</td><td>Never</td></tr></tbody></table>
      </section>
      <section className="nw-card"><h2>Danger zone</h2><p>Archive this workspace. Members keep read access for 30 days.</p><button type="button" className="nw-btn">Archive workspace</button></section>
    </main>
  </div>;
}

function App() {
  const [conversationId, setConversationId] = useState(stored);
  const [items, refresh] = useConversations(conversationId);
  const store = useMemo(createNotificationStore, []);
  const [note, setNote] = useState('');
  const [taskNote, setTaskNote] = useState('');
  const tasks = useRef(new Map());
  const select = id => { remember(id); setConversationId(id); };
  const newConversation = async () => { const { conversationId: id } = await api('/api/conversations', { method: 'POST' }); select(id); refresh(); };
  // Start from the latest conversation, or make the first one.
  useEffect(() => {
    if (conversationId !== undefined || items === null) return;
    if (items.length) select([...items].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0].id); else void newConversation();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, conversationId]);
  const next = useRemoteChat({ conversationId: conversationId === undefined ? undefined : String(conversationId), endpoint: id => new URL(`/api/chat?conversation=${id}`, location.href), fetch: authorized, identity });
  // Keep the bar on screen while a newly selected conversation connects: it shows the previous one until the new controller is ready.
  const shown = useRef(null);
  if (next.status === 'ready') shown.current = next;
  const chat = shown.current ?? next;
  const [windowState, setWindowState] = useState('bar');
  useEffect(() => () => { for (const task of tasks.current.values()) { task.stop(); task.controller.dispose(); } tasks.current.clear(); }, []);

  // A background task is another conversation the host keeps connected; its toasts come from watchConversation, not from the bar.
  async function startTask() {
    setTaskNote('Starting…');
    try {
      const { conversationId: id } = await api('/api/conversations', { method: 'POST' });
      const { controller } = await connect(id);
      const stop = watchConversation(controller, store, { conversationId: id, title: 'Nightly export check' });
      tasks.current.set(id, { controller, stop });
      controller.setText('Nightly export check: run the health check for 8 seconds, then say in one short sentence whether everything is fine.');
      await controller.send('followUp');
      setTaskNote('Running in the background'); refresh();
    } catch (cause) { setTaskNote(`Could not start: ${cause.message}`); }
  }

  const renderPanel = useMemo(() => createArtifactPanel({ identity, authorized }), []);
  const configure = async change => { const result = await chat.configure(change); if (result.kind === 'refused') throw new Error(result.reason ?? 'The change was refused.'); };
  // The composer's controls are the same in the bar and in a full PiChat (?view=full): attach, slash, @ mentions, model and effort.
  const composerConfig = {
    attachments: { accept: 'image/*', upload: files => Promise.all(files.map(readImage)) },
    slash: { commands: [{ name: 'new', description: 'Start a new conversation', run: () => { void newConversation(); } }, { name: 'clear', description: 'Clear the message box', run: ({ setText }) => setText('') }] },
    mentions: { search: async query => PAGES.filter(page => page.toLowerCase().includes(query.toLowerCase())).map(path => ({ path })) },
    model: { options: [{ provider: 'openai', modelId: 'gpt-5-mini', label: 'GPT-5 mini' }, { provider: 'openai', modelId: 'gpt-5-nano', label: 'GPT-5 nano' }], change: model => configure({ model }) },
    effort: { options: ['minimal', 'low', 'medium', 'high'], change: level => configure({ thinkingLevel: level }) },
  };
  const props = chat.status === 'ready' ? {
    state: windowState, onStateChange: setWindowState, controller: chat.controller, actions: chat.actions, labels: { title: 'Console assistant' }, variant: params.get('variant') === 'surface' ? 'surface' : 'contrast',
    notifications: store, systemNotifications: true, autoDismissMs: Number(params.get('dismiss') ?? 8000),
    conversations: { items: (items ?? []).map(item => ({ id: item.id, title: item.title ?? undefined, updatedAt: item.updatedAt ?? undefined })), activeId: conversationId, onSelect: select, onNew: () => { void newConversation(); } },
    ...composerConfig,
    artifactPanel: renderPanel, artifactTarget: params.get('artifacts') === 'host' ? 'host' : 'window',
    artifacts: { open: artifact => setNote(`Opening ${artifact.title} in the host viewer…`) },
    tools: <HostTools />,
    onOpenFull: id => setNote(`Opening conversation ${id} in the full workspace…`),
    onFeedback: () => {},
  } : undefined;
  if (params.get('view') === 'full') return props ? <div style={{ height: '100dvh', background: 'var(--background)' }} className="pi-chat"><PiChat controller={props.controller} actions={props.actions} labels={{ title: 'Console assistant' }}
    slash={props.slash} mentions={props.mentions} attachments={props.attachments} model={props.model} effort={props.effort} /></div> : null;
  return <>
    <Console onTask={() => { void startTask(); }} taskNote={taskNote} note={note} />
    {props && <AmbientChat key="ambient" {...props} />}
  </>;
}

createRoot(document.getElementById('root')).render(<App />);
