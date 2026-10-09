// The whole browser side of the app: the pi-app block and its hooks over the host routes of ./server.mjs. Nothing else is needed:
// sessions on the left, the chat in the center and the artifact viewers on the right come from `AgentWorkspace`.
// `?configured` shows the same app rebranded through the blocks' props only (labels, one icon, host actions; see CONFIGURED below).
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentWorkspace, useConversations, useRemoteChat } from '../../registry/pi-app/agent-workspace.tsx';
import { AmbientChat } from '../../registry/pi-ambient/ambient.tsx';

const { token, identity } = window.__APP__;
const authorized = request => { const headers = new Headers(request.headers); headers.set('authorization', `Bearer ${token}`); return fetch(new Request(request, { headers })); };
const at = path => new URL(path, location.href);
const resources = { endpoint: at('/api/resources'), history: at('/api/history'), fetch: authorized, identity };
const configured = new URLSearchParams(location.search).has('configured');

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
  const listed = useConversations({ endpoint: at('/api/conversations'), fetch: authorized, activeId: selected, onSelect: setSelected });
  const conversations = listed && config.rowActions ? { ...listed, rowActions: config.rowActions } : listed;
  // The open conversation: the one chosen, while it is listed; otherwise the most recent.
  const items = listed?.items;
  useEffect(() => { if (items?.length && !items.some(item => item.id === selected)) setSelected(items[0].id); }, [items, selected]);
  const active = items?.some(item => item.id === selected) ? selected : undefined;
  const chat = useRemoteChat({ conversationId: active, endpoint: id => at(`/api/chat?conversation=${id}`), fetch: authorized, identity });
  // Configured: the chat can float over the panel (its "…" menu offers "Pop out chat"); the floating bar carries the dock action.
  const floating = configured ? { floatBelow: 320, floatingChat: ({ headerStart, historyList, emptyState, decisions, controls, className, ...props }, dock) =>
    <AmbientChat {...props} headerActions={config.dockActions} variant="surface" defaultState="expanded" onDock={dock} /> } : {};
  return <main data-testid="app" data-conversation={active} data-configured={configured || undefined} className="flex h-full min-h-0">
    <AgentWorkspace conversationId={active} controller={chat.status === 'ready' ? chat.controller : undefined} conversations={conversations} resources={resources}
      chat={{ labels: { title: 'Writer' }, ...config.chat, ...(chat.status === 'ready' ? { actions: chat.actions } : {}) }}
      {...(config.labels ? { labels: config.labels, panelActions: config.panelActions } : {})} {...floating}
      connecting={<p role="status" className="p-4 text-sm text-muted-foreground">{chat.status === 'offline' ? 'Server unreachable. Retrying…' : 'Connecting…'}</p>} />
    {configured && <output data-testid="host-log" className="sr-only">{logged.join(' ')}</output>}
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
