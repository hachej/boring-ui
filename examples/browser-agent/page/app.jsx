// The in-browser coding agent's page: the pi-chat registry item on the left, the repository on the right (files,
// a live preview of index.html, git history) and the model settings. Every /api request goes to the agent worker
// in this tab; nothing here talks to a server except for static files and, if you set one, the model gateway.
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PiChat } from '../../../registry/pi-chat/pi-chat.tsx';
import { ProviderSetup } from '../../../registry/provider-setup/provider-setup.tsx';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';
import { copyToClipboard } from '@hachej/boring-files/platform';
import { connectWorker } from '@hachej/boring-browser/transport';

const scripted = new URLSearchParams(location.search).has('scripted');
const agent = connectWorker(`/agent-worker.js${scripted ? '?scripted' : ''}`);
const api = async (path, init) => { const response = await agent.fetch(new URL(path, location.href), init); if (!response.ok) throw new Error(`${path}: ${response.status}`); return response.json(); };
const identity = { runtimeId: 'browser', scopeId: 'this-tab', principalId: 'you', initiatorId: 'you' };

function useChat() {
  const [chat, setChat] = useState({ status: 'connecting' });
  useEffect(() => {
    let disposed = false, controller;
    (async () => {
      try {
        await agent.ready;
        const remote = await createRemoteChat({ endpoint: new URL('/api/chat', location.href), fetch: agent.fetch });
        if (disposed) return;
        controller = createNativeChatController({ identity, ...remote });
        await controller.connect();
        if (disposed) return void controller.dispose();
        const actions = {};
        if (typeof remote.answer === 'function') actions.answer = remote.answer;
        if (typeof remote.withdraw === 'function') actions.withdraw = remote.withdraw;
        setChat({ status: 'ready', controller, actions });
      } catch (error) { if (!disposed) setChat({ status: 'failed', error: String(error?.message ?? error), code: error?.code }); }
    })();
    return () => { disposed = true; controller?.dispose(); };
  }, []);
  return chat;
}

function useAgentState() {
  const [state, setState] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => api('/api/state').then(value => { if (!cancelled) setState(value); }).catch(() => {});
    agent.ready.then(load, () => {}); // a failed start is shown by the chat pane
    const timer = setInterval(load, 1500);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  return [state, setState];
}

/** index.html with its relative stylesheets and scripts inlined, for a sandboxed srcdoc iframe. */
async function previewDocument(files) {
  if (!files.some(file => file.path === 'index.html')) return null;
  let html = (await api('/api/file?path=index.html')).text;
  const local = href => href && !/^[a-z]+:|^\/\//i.test(href) ? href.replace(/^\.\//, '') : null;
  for (const [tag, path] of [...html.matchAll(/<link[^>]+href="([^"]+)"[^>]*>/g)].map(match => [match[0], local(match[1])])) {
    if (path && /stylesheet/.test(tag)) { try { html = html.replace(tag, `<style>${(await api(`/api/file?path=${encodeURIComponent(path)}`)).text}</style>`); } catch { /* missing file stays a link */ } }
  }
  for (const [tag, path] of [...html.matchAll(/<script[^>]+src="([^"]+)"[^>]*><\/script>/g)].map(match => [match[0], local(match[1])])) {
    if (path) { try { html = html.replace(tag, `<script>${(await api(`/api/file?path=${encodeURIComponent(path)}`)).text}</script>`); } catch { /* missing file stays a tag */ } }
  }
  return html;
}

function Files({ files }) {
  const [open, setOpen] = useState(null);
  const [text, setText] = useState('');
  useEffect(() => { if (open) api(`/api/file?path=${encodeURIComponent(open)}`).then(value => setText(value.text)).catch(() => setText('(unreadable)')); }, [open, files]);
  return <div className="ba-files">
    <ul data-testid="ba-files">{files.map(file => <li key={file.path}><button type="button" aria-pressed={open === file.path} onClick={() => setOpen(file.path)}>{file.path}</button><span>{file.size} B</span></li>)}</ul>
    {open && <pre data-testid="ba-file-text">{text}</pre>}
  </div>;
}

function Preview({ files }) {
  const [doc, setDoc] = useState(null);
  const stamp = files.map(file => `${file.path}:${file.size}`).join('|');
  useEffect(() => { previewDocument(files).then(setDoc).catch(() => setDoc(null)); }, [stamp]); // eslint-disable-line
  if (!doc) return <p className="ba-muted">No index.html yet.</p>;
  // No allow-same-origin: generated pages cannot reach this tab's storage, the agent or its credentials.
  return <iframe data-testid="ba-preview" title="Preview of index.html" sandbox="allow-scripts allow-forms" srcDoc={doc} />;
}

function Git({ git }) {
  return <div><p className="ba-muted">Branch <code>{git.branch}</code></p>
    <ol className="ba-log" data-testid="ba-git-log">{git.commits.map(commit => <li key={commit.oid}><code>{commit.oid}</code> {commit.message}</li>)}</ol></div>;
}

/** What OptChat shows the model: one line per stretch of everything before the current message, coarser with age. */
function Memory({ memory }) {
  if (!memory.enabled) return <p className="ba-muted" data-testid="ba-memory-off">OptChat memory is off for this conversation: every request carries the whole transcript. Turn it on with the checkbox in the chat header.</p>;
  const { leaves, summaries, view, compactor, lastRequest } = memory;
  return <div data-testid="ba-memory">
    <p className="ba-muted" data-testid="ba-memory-stats">{leaves} messages in the log · {summaries} summaries · view {view.bytes}/{view.budget} B{compactor.busy ? ' · summarizing…' : ''}{compactor.error ? ` · summarizer failed: ${compactor.error}` : ''}
      {lastRequest ? ` · last request sent ${lastRequest.requestMessages} of ${lastRequest.logMessages} messages` : ''}</p>
    <ol className="ba-view" data-testid="ba-view">{view.parts.map(part => <li key={`${part.level}:${part.id}`} data-level={part.level}><code>{part.id}+{part.n}</code> {part.open ? '(not summarized yet)' : part.text}</li>)}</ol>
  </div>;
}

function Settings({ state }) {
  return <div className="ba-settings">
    <p className="ba-muted">Model access (provider, model, key, sign-in, gateway) is in the chat header: the model button.</p>
    <p className="ba-muted">Storage: {state.storage.persistent ? 'SQLite in this browser (OPFS)' : 'memory only (no OPFS)'} · cross-origin isolated: {String(state.isolated)}</p>
    <button type="button" className="ba-danger" onClick={async () => { if (confirm('Delete the conversation, the repository and saved keys from this browser?')) { await api('/api/reset', { method: 'POST' }); agent.terminate(); location.reload(); } }}>Reset everything</button>
  </div>;
}

/** The registry's provider-setup popover over this page's worker API. */
function ModelAccess({ state, setState }) {
  if (!state) return null;
  return <ProviderSetup providers={state.providers} value={state.settings} loginState={state.login} gatewayPlaceholder={`${location.origin}/gateway`}
    onSave={async change => {
      const response = await agent.fetch(new URL('/api/model', location.href), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(change) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).reason ?? `Save failed (${response.status})`);
      const next = await response.json();
      setState(current => ({ ...current, ...next }));
    }}
    onLogin={async provider => { setState(current => ({ ...current, login: { state: 'starting' } })); await api('/api/model/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider }) }).then(login => setState(current => ({ ...current, login }))); }} />;
}

const TABS = ['Files', 'Preview', 'Git', 'Memory', 'Settings'];

function App() {
  const chat = useChat();
  const [state, setState] = useAgentState();
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem('ba.tab') ?? 'Preview'; } catch { return 'Preview'; } });
  useEffect(() => { try { sessionStorage.setItem('ba.tab', tab); } catch { /* optional */ } }, [tab]);
  const [details, setDetails] = useState(true);
  const model = state ? `${state.settings.provider}/${state.settings.modelId}` : '';
  const files = useMemo(() => state?.files ?? [], [state]);
  return <div className="ba">
    <main className="ba-chat">
      {chat.status === 'ready'
        ? <PiChat controller={chat.controller} mode={details ? 'developer' : 'expert'} actions={chat.actions} onCopy={text => copyToClipboard(text)}
            labels={{ title: 'Browser agent', emptyDescription: 'A coding agent that runs entirely in this tab: durable session in SQLite, a git repository, a shell and a code sandbox. Try: build a small todo app in index.html.' }}
            controls={<><label className="ba-toggle" title="Show the model one summary line per stretch of the conversation before this message, instead of the whole transcript"><input type="checkbox" data-testid="ba-memory-toggle" checked={Boolean(state?.memory.enabled)} disabled={!state}
              onChange={event => api('/api/memory', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: event.target.checked }) }).then(memory => setState(current => ({ ...current, memory }))).catch(() => {})} /> OptChat memory</label>
              <label className="ba-toggle"><input type="checkbox" checked={details} onChange={event => setDetails(event.target.checked)} /> Tool calls</label><ModelAccess state={state} setState={setState} /></>} />
        : chat.code === 'sqlite-locked'
          // The typed BrowserSqliteLockedError from @hachej/boring-browser/sqlite, carried over the worker's `failed` message.
          ? <div className="ba-pad" role="alert" data-testid="ba-locked"><strong>Already open in another tab</strong><p className="ba-muted">{chat.error}</p><button type="button" onClick={() => location.reload()}>Try again</button></div>
          : <p className="ba-muted ba-pad" role="status">{chat.status === 'failed' ? `The agent failed to start: ${chat.error}` : 'Starting the agent in this tab…'}</p>}
    </main>
    <aside className="ba-panel">
      <header><strong>In this tab</strong><code data-testid="ba-model">{model}</code></header>
      <nav role="tablist">{TABS.map(name => <button key={name} role="tab" type="button" aria-selected={tab === name} data-tab={name} onClick={() => setTab(name)}>{name}</button>)}</nav>
      {!state ? <p className="ba-muted">Loading…</p>
        : tab === 'Files' ? <Files files={files} />
        : tab === 'Preview' ? <Preview files={files} />
        : tab === 'Git' ? <Git git={state.git} />
        : tab === 'Memory' ? <Memory memory={state.memory} />
        : <Settings state={state} />}
    </aside>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
