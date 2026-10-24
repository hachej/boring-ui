import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { SparklesIcon } from 'lucide-react';
import { AgentWorkspace } from '../../registry/pi-app/agent-workspace';
import { useSharedChat } from '../../registry/shared-chat/shared-chat';
import { SharedChat } from '../../registry/shared-chat/shared-chat';
import { voiceMessagePlugin } from '../../registry/pi-chat-voice/voice-message';
import { createPdfDemo } from './pdf-flow.mjs';
import { createStorySource } from './story.mjs';

const story = new URLSearchParams(location.search).has('story');
const source = story ? createStorySource() : createPdfDemo({ manual: new URLSearchParams(location.search).has('manual') });
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
/** The block's story: SharedChat alone, as an app shows a channel on a phone, with an app control beside the send button. */
// `?plain` shows production's plain chrome (presence off, steps hidden, copy, a footer, plain answers); `?answer` adds an answer with steps either way.
const plainChrome = { presence: false, steps: 'hidden', answerActions: ['copy'], answerStyle: 'plain', footer: message => <span>Generated in 1.0 s · {message.id}</span> };
function Story() {
  const plain = new URLSearchParams(location.search).has('plain');
  const shared = useSharedChat(source, plain ? plainChrome : {});
  useEffect(() => {
    if (new URLSearchParams(location.search).has('answer')) source.emit({ type: 'message', message: { id: 'answer', conversationId: 'room', author: 'assistant', at: new Date().toISOString(),
      text: 'The Due date column is live. It sorts oldest first.', steps: [{ label: 'Read the list', status: 'done' }, { label: 'Add the column', status: 'done' }, { label: 'Check the sort', status: 'done' }] } });
  }, []);
  if (!shared.controller) return <p>Opening the fictional channel…</p>;
  return <SharedChat {...(plain ? plainChrome : {})} controller={shared.controller} conversations={shared.conversations} labels={{ title: '#missing-receipts', placeholder: 'Message' }}
    voiceMessage={{ ...voiceMessagePlugin, transcribe: async () => 'A fictional voice note.' }}
    tools={<button type="button" data-testid="story-app-control" aria-label="Assistant" className="inline-flex size-11 items-center justify-center text-chart-2"><SparklesIcon aria-hidden="true" className="size-5" /></button>} />;
}
createRoot(document.getElementById('root')).render(story ? <Story /> : <App />);
