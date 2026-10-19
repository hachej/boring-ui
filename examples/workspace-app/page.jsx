// The whole browser side of the app: the pi-app block and its hooks over the host routes of ./server.mjs. Nothing else is needed:
// sessions on the left, the chat in the center and the artifact viewers on the right come from `AgentWorkspace`.
// `?configured` shows the same app rebranded through the blocks' props only (labels, one icon, host actions; see CONFIGURED below).
// `?feedback` adds the feedback item over the page: the composer's annotate toggle, and the maquette viewer's comment icon (point mode).
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { connectRevisionProvider } from '@hachej/boring-files/revision';
import { createFeedbackSession } from '@hachej/boring-feedback/ui';
import { createPrivacyPolicy } from '@hachej/boring-feedback/page';
import { NoteBubble, useComposerFeedback, usePointComments } from '../../registry/feedback/feedback-session.tsx';
import { PointBar } from '../../registry/feedback/point-mode.tsx';
import { AgentWorkspace, useConversations, useRemoteChat } from '../../registry/pi-app/agent-workspace.tsx';
import { AmbientChat } from '../../registry/pi-ambient/ambient.tsx';
import { Button } from '@/components/ui/button';
import { GroupOneControls } from '../../test/fixtures/themes/group-one.jsx';
import { ViewerChromeControls } from '../../test/fixtures/themes/viewer-chrome.jsx';
import { GroupFiveControls } from '../../test/fixtures/themes/group-five.jsx';
import { GroupThreeControls } from '../../test/fixtures/themes/group-three.jsx';

const { token, identity } = window.__APP__;
const authorized = request => { const headers = new Headers(request.headers); headers.set('authorization', `Bearer ${token}`); return fetch(new Request(request, { headers })); };
const at = path => new URL(path, location.href);
const configured = new URLSearchParams(location.search).has('configured');
// `?embedded`: the same page as a host would embed it (no left column, one compact top bar). `?resources`: no revision provider, only
// `resources` (the viewers' endpoint and file history): the Library is then read-only.
const embedded = new URLSearchParams(location.search).has('embedded');
// `?title=`: the embedded bar's fixed app title (the conversation title then follows it).
const appTitle = new URLSearchParams(location.search).get('title');
const resourcesOnly = new URLSearchParams(location.search).has('resources');
const withFeedback = new URLSearchParams(location.search).has('feedback');

/** `?feedback`: one feedback session over the whole page (the chat and the artifact panel), created after mount. */
function useFeedbackSession() {
  const [session, setSession] = useState();
  useEffect(() => {
    if (!withFeedback) return undefined;
    const created = createFeedbackSession({ app: 'workspace-app', build: 'dev', root: document.getElementById('root'), policy: createPrivacyPolicy({ routeOf: () => '/' }) });
    setSession(created);
    return () => created.dispose();
  }, []);
  return session;
}

/** A host icon: any component that takes `className` (here a fictional brand mark instead of lucide's arrow). */
const SparkIcon = ({ className }) => <svg data-testid="custom-send-icon" className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" /></svg>;
const NoteIcon = ({ className }) => <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 2h7l3 3v9H3z M10 2v3h3" /></svg>;

/** The fictional "Fernhill" rebrand: words, one icon and host actions on each surface. Every host action reports itself in the page's log. */
function useConfiguration(log) {
  return useMemo(() => {
    if (!configured) return {};
    const action = (id, label, extra = {}) => ({ id, label, onSelect: () => log(id), ...extra });
    return {
      chat: {
        labels: { title: 'Fernhill writer', placeholder: 'Ask Fernhill anything…', send: 'Ask', history: 'Past chats', emptyDescription: 'Fernhill writes short fictional documents.' },
        icons: { send: SparkIcon },
        headerActions: [action('export', 'Export chat', { icon: NoteIcon }), action('report', 'Report a problem', { placement: 'menu' })],
        messageActions: () => [action('quote', 'Quote this reply')],
      },
      labels: { sessionsTitle: 'Projects', newChat: 'Start', floatChat: 'Pop out chat' },
      panelActions: [action('pin', 'Pin to board', { icon: NoteIcon })],
      rowActions: item => [action('star', `Star ${item.title ?? 'chat'}`, { icon: NoteIcon }), action('share', 'Share with the team')],
      dockActions: [action('handoff', 'Hand off to a person')],
    };
  }, [log]);
}

function App() {
  const [selected, setSelected] = useState();
  const [logged, setLogged] = useState([]);
  const log = useMemo(() => id => setLogged(current => [...current, id]), []);
  const config = useConfiguration(log);
  // The workspace's revision provider (identity, listing, search, history, change feed) is bound by the server's binding of /api/resources.
  const [revisionProvider, setRevisionProvider] = useState();
  const [discovery, setDiscovery] = useState({ attempt: 0, failed: false });
  useEffect(() => { let off = false; setDiscovery(current => ({ ...current, failed: false })); connectRevisionProvider({ endpoint: at('/api/resources'), fetch: authorized }).then(value => { if (!off) setRevisionProvider(value); }, () => { if (!off) setDiscovery(current => ({ ...current, failed: true })); }); return () => { off = true; }; }, [discovery.attempt]);
  const listed = useConversations({ endpoint: at('/api/conversations'), fetch: authorized, activeId: selected, onSelect: setSelected });
  const conversations = listed && config.rowActions ? { ...listed, rowActions: config.rowActions } : listed;
  // The open conversation: the one chosen, while it is listed; otherwise the most recent.
  const items = listed?.items;
  useEffect(() => { if (items?.length && !items.some(item => item.id === selected)) setSelected(items[0].id); }, [items, selected]);
  const active = items?.some(item => item.id === selected) ? selected : undefined;
  const chat = useRemoteChat({ conversationId: active, endpoint: id => at(`/api/chat?conversation=${id}`), fetch: authorized, identity });
  const session = useFeedbackSession();
  const feedback = useComposerFeedback(session);
  const comments = usePointComments(session);
  // Configured: the chat can float over the panel (its "…" menu offers "Pop out chat"); the floating bar carries the dock action.
  const floating = configured ? { floatBelow: 320, floatingChat: ({ headerStart, historyList, emptyState, decisions, controls, className, ...props }, dock) =>
    <AmbientChat {...props} headerActions={config.dockActions} variant="surface" defaultState="expanded" onDock={dock} /> } : {};
  return <main data-testid="app" data-conversation={active} data-configured={configured || undefined} className="flex h-full min-h-0">
    {revisionProvider ? <AgentWorkspace conversationId={active} controller={chat.status === 'ready' ? chat.controller : undefined} conversations={conversations}
      {...(resourcesOnly ? { resources: { endpoint: at('/api/resources'), fetch: authorized, identity, history: at('/api/history') } } : { revisionProvider })} {...(embedded ? { layout: 'embedded', ...(appTitle ? { title: appTitle } : {}) } : {})}
      chat={{ labels: { title: 'Writer', emptyDescription: 'What can I help you write today?' }, suggestions: [
        { label: 'Draft a plan', text: 'Write a picnic plan and present it.' },
        { label: 'Write a short reply', text: 'Reply with exactly: AMBER-HARBOUR' },
      ], ...config.chat, ...(feedback ? { feedback } : {}), ...(chat.status === 'ready' ? { actions: chat.actions } : {}) }}
      {...(comments ? { comments } : {})}
      labels={{ sessionsTitle: 'Writer', ...config.labels }} panelActions={config.panelActions} {...floating}
      connecting={<p role="status" className="p-4 text-sm text-muted-foreground">{chat.status === 'offline' ? 'Server unreachable. Retrying…' : 'Connecting…'}</p>} />
      : discovery.failed
        ? <p role="alert" className="p-4 text-sm text-muted-foreground">The workspace could not be reached. <Button variant="link" onClick={() => setDiscovery(current => ({ attempt: current.attempt + 1, failed: false }))}>Retry</Button></p>
        : <p role="status" className="p-4 text-sm text-muted-foreground">Connecting…</p>}
    {configured && <output data-testid="host-log" className="sr-only">{logged.join(' ')}</output>}
    {session && <><NoteBubble session={session} /><PointBar session={session} /></>}
  </main>;
}

const controls = new URLSearchParams(location.search).get('controls');
const viewer = new URLSearchParams(location.search).get('viewer');
createRoot(document.getElementById('root')).render(viewer ? <ViewerChromeControls surface={viewer} fetch={authorized} /> : controls?.startsWith('composer-') ? <GroupThreeControls surface={controls.slice('composer-'.length)} /> : controls?.startsWith('transcript-') ? <GroupFiveControls surface={controls.slice('transcript-'.length)} /> : controls ? <GroupOneControls surface={controls} /> : <App />);
