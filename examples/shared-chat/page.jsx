import { createRoot } from 'react-dom/client';
import { createFakeChannelSource } from '@hachej/boring-ui-kit/shared-chat';
import { AgentWorkspace, useSharedChat } from '../../registry/pi-app/agent-workspace';
import { sharedChatSeed } from './seed.mjs';

const source = createFakeChannelSource(sharedChatSeed);
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
  const shared = useSharedChat(source);
  return <AgentWorkspace layout="embedded" history="popover" {...shared} revisionProvider={revisionProvider}
    chat={{ labels: { title: 'Garden team', placeholder: 'Message the team…' }, draftKey: `fictional-shared:${shared.conversationId}` }}
    connecting={<p>Opening the fictional shared conversation…</p>} />;
}
createRoot(document.getElementById('root')).render(<App />);
