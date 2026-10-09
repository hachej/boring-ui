// Browser side of the studio: the pi-app registry block (AgentWorkspace: sessions, chat, artifact viewers) over the remote chat transport.
// No Pi runtime is bundled. One standard agent: the page lists scenarios in the empty chat, offers the variants (infrastructure) in the
// header and adds what is studio-only to the block: the Workspace tabs as a panel view, the canvas viewer and share links.
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PanelRightOpenIcon } from 'lucide-react';
import { artifactKey } from '../../registry/pi-chat/pi-chat.tsx';
import { AmbientChat } from '../../registry/pi-ambient/ambient.tsx';
import { AgentWorkspace, useArtifactVersions, useConversations, useRemoteChat } from '../../registry/pi-app/agent-workspace.tsx';
import { ViewerFrame } from '../../registry/viewers/viewer-frame.tsx';
import { WorkspaceTabs } from './panels.jsx';
import { Canvas } from './panels/canvas.jsx';
import { useScenarioRun, useTyped } from './scenarios-ui.jsx';
import { setStudioContext, shareStudioLink, takeLink } from './share-link.mjs';
import { savedResource } from './saved-resource.mjs';
import { INTERACTIVE_HTML } from './interactive.mjs';

// The bearer token: the page's own (the studio's person), or one a link carried in its fragment (`#token=...`, a fixture token of a
// team person), kept for this tab and removed from the address bar. The identity is what the server says this token is (/api/studio).
const token = (() => {
  const carried = new URLSearchParams(location.hash.slice(1)).get('token');
  if (carried) { try { sessionStorage.setItem('studio.token', carried); } catch { /* optional */ } history.replaceState(null, '', location.pathname + location.search); return carried; }
  try { return sessionStorage.getItem('studio.token') ?? window.__STUDIO__.token; } catch { return window.__STUDIO__.token; }
})();
let identity = window.__STUDIO__.identity;
// Every request names the variant the page is showing; the server keeps one workspace and one resource store per variant.
let shown;
const authorized = request => {
  const headers = new Headers(request.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (shown) headers.set('x-studio-variant', shown);
  return fetch(new Request(request, { headers }));
};
const api = async (path, init) => { const response = await authorized(new Request(new URL(path, location.href), init)); if (!response.ok) throw new Error(`${path}: ${response.status}`); return response.json(); };
const remember = (key, value) => { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* optional convenience */ } };
const recall = key => { try { return JSON.parse(sessionStorage.getItem(key) ?? 'null'); } catch { return null; } };
const chatEndpoint = id => new URL(`/api/chat?conversation=${id}`, location.href);
/** The browser names workspace files `/workspace/<path>`; the resource is the person's `workspace` provider at `<path>`, as `who`. */
const resourcesOf = who => ({ endpoint: new URL('/api/resources', location.href), fetch: authorized, identity: who, history: new URL('/api/history', location.href),
  locate: path => ({ resource: { providerId: 'workspace', path: path.replace(/^\/workspace\//, '') }, view: { kind: 'published' } }) });
const viewersOf = who => ({ canvas: ({ target, title, revision, frame }) => <Canvas panel={{ target, title, ...(revision ? { revision } : {}) }} authorized={authorized} identity={who} frame={frame} /> });
// The chat's words: only its name differs from the defaults (`defaultChatLabels`).
const CHAT_LABELS = { title: 'Assistant' };

// Host commands the `/` menu offers next to the agent's skills.
// `/reload` exists only for a self-evolving agent: the same reload as the agent's tool, run by the host for the person.
const HOST_COMMANDS = {
  new: { description: 'Start a new conversation', run: host => host.newConversation() },
  clear: { description: 'Clear the message box', run: (_host, { setText }) => setText('') },
  reload: { description: 'Apply the agent\'s own .agent/ instructions, skills and tools', when: variant => variant.selfEvolving, run: (host, { setText }) => { setText(''); return host.reload(); } },
};

/** The PiChat composer props for one variant: the `/` menu, mentions and attachments (when it has a workspace), model and effort. */
function chatProps(variant, chat, host) {
  const props = {
    slash: { skills: variant.skills, commands: Object.entries(HOST_COMMANDS).filter(([, command]) => !command.when || command.when(variant))
      .map(([name, command]) => ({ name, description: command.description, run: api => command.run(host, api) })) },
  };
  if (variant.capabilities.includes('workspace')) {
    props.mentions = { search: async (query, signal) => (await api(`/api/search?q=${encodeURIComponent(query)}`, { signal })).results, open: host.openFile };
    props.attachments = { upload: files => Promise.all(files.map(async file => {
      const response = await authorized(new Request(new URL(`/api/upload?name=${encodeURIComponent(file.name)}`, location.href), { method: 'POST', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } }));
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).reason ?? `Upload failed (${response.status})`);
      return response.json();
    })) };
  }
  const refuse = async change => { const result = await chat.configure(change); if (result.kind === 'refused') throw new Error(result.reason ?? 'The change was refused.'); };
  props.model = { options: variant.chat.models, change: model => refuse({ model }) };
  props.effort = { options: variant.chat.efforts, change: level => refuse({ thinkingLevel: level }) };
  return props;
}

/** The Workspace tool view inside the panel, under the standard viewer bar. */
function WorkspacePanel({ variant, tab, onTab, conversation, openPath, onOpenFile, onClose }) {
  return <ViewerFrame title="Workspace" subtitle={<span>Files the agent can read and change{variant.id === 'local' ? '' : ` · ${variant.title}`}</span>} testId="demo-panel" titleTestId="demo-panel-title" onClose={onClose}>
    <div className="studio-panel min-h-0 flex-1 overflow-auto p-3" data-panel={tab} aria-label="Workspace panel">
      <WorkspaceTabs variant={variant} tab={tab} onTab={onTab} api={api} conversation={conversation} openPath={openPath} onOpenFile={onOpenFile} />
    </div>
  </ViewerFrame>;
}

/** What the panel showed when the page was last open (earlier studio versions stored an artifact without `kind`). */
function restored() {
  const value = recall('studio.artifact');
  if (!value) return null;
  return value.kind ? value : value.descriptor ? { kind: 'artifact', ...value, conversation: String(value.conversation) } : null;
}

function App() {
  const [studio, setStudio] = useState(null);
  const refresh = () => api('/api/studio').then(value => { if (value.identity) identity = value.identity; setStudio(value); });
  // A shared link names the variant (and conversation) to open; it wins over what this tab last showed.
  const [selected, setSelected] = useState(() => {
    const variant = takeLink('variant'), conversation = takeLink('conversation');
    if (variant) return { variant, ...(conversation ? { conversation: Number(conversation) } : {}) };
    return recall('studio.selected');
  });
  // A shared link may also name an artifact (and version) of that conversation; it opens once the conversation has loaded.
  const [linked, setLinked] = useState(() => { const id = takeLink('artifact'); return id ? { id, version: takeLink('version') ?? 'latest' } : null; });
  const [mode, setMode] = useState('developer');
  // The panel's content (the block's OpenedView): an artifact, a workspace file (a shared link may name one) or the Workspace tabs
  // { kind: 'workspace', tab }. It survives a reload; a file does not.
  const [opened, setOpened] = useState(() => { const path = takeLink('file'); return path ? { kind: 'file', path } : restored(); });
  useEffect(() => { remember('studio.artifact', opened?.kind === 'file' ? null : opened); }, [opened]);
  useEffect(() => { refresh().catch(() => setStudio({ variants: [], scenarios: [] })); }, []);
  useEffect(() => { remember('studio.selected', selected); }, [selected]);
  const variants = studio?.variants ?? [];
  const live = variants.filter(candidate => candidate.available);
  const variant = live.find(candidate => candidate.id === selected?.variant) ?? live[0];
  shown = variant?.id;
  // An open workspace file or tool view belongs to the variant it was opened in.
  const [openedIn, setOpenedIn] = useState(undefined);
  useEffect(() => {
    if (openedIn !== undefined && openedIn !== variant?.id) setOpened(current => current?.kind === 'file' || current?.kind === 'workspace' ? null : current);
    if (variant) setOpenedIn(variant.id);
  }, [variant?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const conversationId = variant ? (variant.conversations.includes(selected?.conversation) ? selected.conversation : variant.conversations.at(-1)) : undefined;
  const active = conversationId === undefined ? undefined : String(conversationId);
  // Stable across refreshes: the same person keeps the same object (clients and viewers are made per identity).
  const whoKey = JSON.stringify(studio?.identity ?? identity);
  const who = useMemo(() => JSON.parse(whoKey), [whoKey]);
  const chat = useRemoteChat({ conversationId: active, endpoint: chatEndpoint, fetch: authorized, identity: who });
  const resources = useMemo(() => resourcesOf(who), [who]);
  const viewers = useMemo(() => viewersOf(who), [who]);
  const controller = chat.status === 'ready' ? chat.controller : undefined;
  setStudioContext({ variant: variant?.id, conversation: conversationId });
  // The sessions list: `@hachej/boring-agent/conversations` behind /api/variants/:id/conversations. A change reloads the variant (its conversations).
  const conversations = useConversations({ endpoint: variant ? `/api/variants/${variant.id}/conversations` : undefined, fetch: authorized, activeId: active,
    onSelect: id => setSelected({ variant: variant.id, conversation: Number(id) }), onChange: () => refresh().catch(() => {}) });
  // What the person's last `/reload` reported, shown above the chat until dismissed.
  const [reloaded, setReloaded] = useState(null);
  const reload = async () => { const result = await api('/api/reload', { method: 'POST' }); setReloaded(result.text); };
  const openFile = path => setOpened({ kind: 'file', path: path.startsWith('/workspace/') ? path : `/workspace/${path}` });
  const composer = useMemo(() => variant && chat.status === 'ready' ? chatProps(variant, chat, { newConversation: () => conversations?.onNew?.(), reload, openFile }) : {}, [variant, chat, conversations]); // eslint-disable-line
  const detect = useMemo(() => variant && controller ? savedResource(variant) : undefined, [variant, controller]);
  const versions = useArtifactVersions(controller, detect);
  const typed = useTyped(controller);
  useEffect(() => {
    if (!linked || !controller) return;
    const known = versions.filter(version => artifactKey(version) === linked.id).reverse();
    // A link to an older version may name a revision the conversation never presented (the file's history has it).
    const found = linked.version === 'latest' ? known[0] : known.find(version => version.revision === linked.version) ?? (known[0] ? { ...known[0], revision: linked.version } : undefined);
    if (!found) return;
    setOpened({ kind: 'artifact', conversation: active, descriptor: found, follow: linked.version === 'latest' });
    setLinked(null);
  }, [linked, controller, versions, active]);
  const scenarioRun = useScenarioRun({ storageKey: 'studio.scenario', scenarios: studio?.scenarios ?? [], variants, variant, controller, conversationId, typed,
    seed: item => api(`/api/scenarios/${item.id}/seed`, { method: 'POST' }).catch(() => {}), fixtureUrl: (item, step) => `/api/scenarios/${item.id}/fixture/${step.index}`,
    openPanel: item => { if (item.panel && variant) setOpened({ kind: 'workspace', tab: item.panel }); } });
  const panels = useMemo(() => variant && ({
    workspace: (view, win) => <WorkspacePanel key={variant.id} variant={variant} tab={view.tab} onTab={tab => setOpened({ kind: 'workspace', tab })} conversation={conversationId} onOpenFile={openFile} onClose={win.close} />,
  }), [variant, conversationId]); // eslint-disable-line
  // The same controller drives both surfaces: when the divider is dragged far enough the chat floats (AmbientChat) and docks back (PiChat) with its transcript, draft and queue.
  const floating = ({ headerStart, historyList, emptyState, decisions, controls, className, ...props }, dock) => <AmbientChat key={active} {...props} variant="surface" defaultState="expanded" onDock={dock} />;
  if (!studio) return <p className="studio-loading">Loading…</p>;
  if (!variant) return <p className="studio-loading" role="alert">The studio server is unreachable, or no variant is available.</p>;
  return <div className="studio" data-variant={variant.id}>
    <header className="studio-bar">
      <h1>Boring studio</h1>
      <label className="studio-variant">Environment
        <select data-testid="variant-select" aria-label="Environment" value={variant.id} onChange={event => setSelected({ variant: event.target.value })}>
          {variants.map(candidate => <option key={candidate.id} value={candidate.id} disabled={!candidate.available} title={candidate.available ? candidate.description : candidate.reason}>{candidate.available ? candidate.title : `${candidate.title} (unavailable)`}</option>)}
        </select>
      </label>
      <label className="studio-mode" title="Show every tool call with its arguments and result"><input type="checkbox" checked={mode === 'developer'} onChange={event => setMode(event.target.checked ? 'developer' : 'expert')} /> Tool calls</label>
    </header>
    <main className="studio-main" data-testid="studio-main" data-conversation={conversationId}>
      <AgentWorkspace controller={controller} conversationId={active} conversations={conversations} resources={resources} detect={detect} viewers={viewers} interactive={INTERACTIVE_HTML} share={shareStudioLink}
        opened={opened} onOpenedChange={setOpened} panels={panels} fileBack={{ label: 'Files', onBack: () => setOpened({ kind: 'workspace', tab: 'files' }) }}
        storageKey="studio" sheetBelow={901} drawerBelow={901} floatBelow={320}
        chat={{ labels: CHAT_LABELS, mode, actions: chat.actions, ...composer, emptyState: scenarioRun.emptyState, decisions: scenarioRun.decisions }}
        connecting={<p className="studio-loading" role="status">{chat.status === 'offline' ? 'Server unreachable. Retrying…' : 'Connecting…'}</p>}
        floatingChat={floating}
        controls={({ panelOpen }) => panelOpen ? undefined : <button type="button" className="studio-panel-toggle" data-testid="studio-panel-open" onClick={() => setOpened({ kind: 'workspace', tab: 'files' })}><PanelRightOpenIcon size={16} aria-hidden="true" />Workspace</button>}
        chatTop={reloaded && <div className="studio-notice" role="status" data-testid="reload-summary">
          <pre>{reloaded}</pre>
          <button type="button" aria-label="Dismiss" data-testid="reload-summary-dismiss" onClick={() => setReloaded(null)}>×</button>
        </div>} />
    </main>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
