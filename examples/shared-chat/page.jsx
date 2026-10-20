import { createRoot } from 'react-dom/client';
import { AgentWorkspace } from '../../registry/pi-app/agent-workspace';
import { useSharedChat } from '../../registry/shared-chat/shared-chat';
import { createPdfDemo } from './pdf-flow.mjs';

const source = createPdfDemo({ manual: new URLSearchParams(location.search).has('manual') });
// Demo controls only. No agent runs in this page; a real host owns the shared log and each agent's Pi conversation.
window.__SHARED__ = source;
const revisionProvider = {
  identity: { scopeId: 'fictional-garden', principalId: 'mira', initiatorId: 'mira' },
  workspace: { providerId: 'fictional', instanceId: 'garden', incarnation: 'demo', viewId: 'published' },
  locate: path => ({ resource: { providerId: 'fictional', path }, view: { kind: 'published' } }),
  read: async () => ({ kind: 'missing' }), publish: async () => ({ kind: 'unavailable', reason: 'This fictional demo has no files.' }), lookup: async () => ({ kind: 'not-found' }),
  list: async () => ({ entries: [] }), search: async () => ({ entries: [] }), history: async () => [],
};
function App() {
  const shared = useSharedChat(source, { locale: 'fr' });
  return <AgentWorkspace layout="embedded" history="popover" locale="fr" {...shared.workspaceProps} revisionProvider={revisionProvider}
    chat={{ ...shared.workspaceProps.chat, labels: { title: 'Équipe fictive', placeholder: 'Écrivez à l’équipe…' }, draftKey: `fictional-shared:${shared.conversationId}` }}
    connecting={<p>Opening the fictional shared conversation…</p>} />;
}
createRoot(document.getElementById('root')).render(<App />);
