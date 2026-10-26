import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SparklesIcon } from 'lucide-react';
import { AgentWorkspace } from '../../registry/pi-app/agent-workspace';
import { defaultKinds } from '../../registry/pi-app-kinds/pi-app-kinds';
import { useSharedChat } from '../../registry/shared-chat/shared-chat';
import { SharedChat } from '../../registry/shared-chat/shared-chat';
import { voiceMessagePlugin } from '../../registry/pi-chat-voice/voice-message';
import { createPdfDemo } from './pdf-flow.mjs';
import { createStorySource } from './story.mjs';
import { createRoomSource } from '../../registry/shared-chat/shared-chat';

const params = new URLSearchParams(location.search);
const story = params.has('story'), room = params.has('room');
const source = room || story ? (story ? createStorySource() : undefined) : createPdfDemo({ manual: params.has('manual') });
// Demo controls only. No agent runs in this page; a real host owns the shared log and each agent's Pi conversation.
window.__SHARED__ = source;
const revisionProvider = {
  identity: { scopeId: 'fictional-garden', principalId: 'mira', initiatorId: 'mira' },
  workspace: { providerId: 'fictional', instanceId: 'garden', incarnation: 'demo', viewId: 'published' },
  locate: path => ({ resource: { providerId: 'fictional', path }, view: { kind: 'published' } }),
  read: async () => ({ kind: 'missing' }), publish: async () => ({ kind: 'unavailable', reason: 'This fictional demo has no files.' }), lookup: async () => ({ kind: 'not-found' }),
  list: async () => ({ entries: [] }), search: async () => ({ entries: [] }), history: async () => [],
};
const kinds = defaultKinds({ locale: 'fr' });
function App() {
  const shared = useSharedChat(source, { locale: 'fr' });
  return <AgentWorkspace layout="embedded" history="popover" locale="fr" artifactKinds={kinds} {...shared.workspaceProps} revisionProvider={revisionProvider}
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
/**
 * `?room[&as=person:ana][&stall=8000]`: the room source over a fictional room host on this origin (room-backend.mjs). `as` is who is signed in
 * (a real host reads the session; here a header and a query parameter stand for it).
 */
function RoomStory() {
  const [roomSource, setRoomSource] = useState();
  const [failure, setFailure] = useState();
  const shared = useSharedChat(roomSource ?? emptySource, { locale: 'fr' });
  useEffect(() => {
    const person = params.get('as') ?? 'person:ana';
    void createRoomSource({ url: location.origin + '/', locale: 'fr', stallMs: Number(params.get('stall') ?? 8000), reconnectMs: 200,
      fetch: request => { request.headers.set('x-room-person', person); return fetch(request); },
      open: url => { const target = new URL(url); target.searchParams.set('person', person); return new WebSocket(target); } })
      .then(created => { window.__ROOM__ = created; setRoomSource(created); }, error => setFailure(String(error)));
  }, []);
  if (failure) return <p role="alert">{failure}</p>;
  if (!roomSource || !shared.controller) return <p>Ouverture de la salle fictive…</p>;
  window.__CONTROLLER__ = shared.controller;
  return <SharedChat controller={shared.controller} conversations={shared.conversations} locale="fr" labels={{ title: 'Salle fictive', placeholder: 'Message' }} />;
}
// useSharedChat needs a source before the room source exists: one that has nothing yet.
const emptySource = { me: { id: 'nobody', name: 'Nobody', kind: 'person' }, conversations: async () => [], members: async () => [], history: async () => ({ messages: [] }), send: async () => { throw new Error('not ready'); }, action: async () => {}, subscribe: () => () => {} };
createRoot(document.getElementById('root')).render(room ? <RoomStory /> : story ? <Story /> : <App />);
