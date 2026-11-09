import { useMemo } from 'react';
import { PiChat } from '../../../registry/pi-chat/pi-chat.tsx';
import { withChatPlugins } from '../../../registry/pi-chat-plugins/chat-plugins.ts';
import { MicIcon } from '../../../registry/_shared/icons.ts';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { createDemoChat } from '../chat-controller.js';
import { Page, Specimen } from '../common.jsx';

// The chat the gallery shows, over a scripted fictional controller. `chatProps` is also what the shell's assistant uses (gallery.jsx).
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** A recorder that records nothing: the button admits one fictional voice message at once, as a finished recording does. */
const voiceMessage = {
  transcribe: async () => 'Ajoute des pommes à la liste.',
  useRecorder: options => ({ canStart: true, phase: 'idle', seconds: 0, captureSequence: 0, problem: undefined, pending: [], start: () => { options.controller.sendVoice?.(); options.admitted?.(); }, finish() {}, cancel() {} }),
  Button: ({ voice }) => <Button type="button" size="icon" variant="ghost" aria-label="Message vocal" data-testid="gallery-voice" onClick={() => voice.start()}><MicIcon /></Button>,
};

export const chatProps = {
  title: 'Assistant',
  locale: 'fr',
  slash: { commands: [
    { name: 'resume', description: 'Résumer la semaine', run: api => api.setText('Résume la semaine en trois lignes.') },
    { name: 'courses', description: 'Préparer la liste de courses', run: api => api.setText('Prépare la liste de courses.') },
  ] },
  mentions: {
    kinds: { repas: { label: path => (path === 'mardi' ? 'Repas · mardi' : path), icon: <span aria-hidden="true">r</span> } },
    search: async query => ['lundi', 'mardi', 'mercredi'].filter(day => day.includes(query.toLowerCase())).map(day => ({ path: day, label: `Repas · ${day}` })),
  },
  attachments: { upload: async files => files.map(file => ({ name: file.name, image: { mimeType: 'image/png', data: PNG } })) },
  voiceMessage,
};

/** The conversation card: a fixed-height frame so the chat scrolls inside it. */
function ChatDemo() {
  const controller = useMemo(() => createDemoChat({ id: 'gallery-chat' }), []);
  const answer = useMemo(() => async (_id, value) => { controller.resolve(value); return { kind: 'answered' }; }, [controller]);
  return <div data-testid="gallery-chat-frame" className="flex h-[34rem] w-full min-w-0 flex-col overflow-hidden rounded-lg border bg-background">
    <PiChat {...withChatPlugins({ ...chatProps, controller, answer })} />
  </div>;
}

export function Chat() {
  return <Page id="chat" title="Chat" description="Le fil de discussion de l'assistant, sur une conversation fictive : aucun modèle n'est appelé.">
    <Specimen id="pi-chat" code={'npx boring-ui-blocks add pi-chat  ·  <PiChat {...withChatPlugins({ controller, slash, mentions, attachments, voiceMessage })} />'} feature={['chat-session', 'features/chat.md']} title="Conversation" description="Répondez à la question, approuvez la suppression, tapez / ou @, joignez un fichier ou dictez un message." wide>
      <ChatDemo />
    </Specimen>
    <Specimen id="agent-bar" code={'npx boring-ui-blocks add agent-bar  (D-1978, not yet on main)'} feature={['gallery-chat', 'features/gallery.md']} title="Barre d'agent" description="Emplacement réservé : le bloc agent-bar (D-1978) n'est pas encore sur main." wide>
      <Alert data-testid="agent-bar-slot">
        <AlertTitle>À venir</AlertTitle>
        <AlertDescription>Ce bloc prendra sa place ici dès que la barre d'agent sera livrée.</AlertDescription>
      </Alert>
    </Specimen>
  </Page>;
}
