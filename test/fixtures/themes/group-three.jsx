import { useRef, useState } from 'react';
import { Composer } from '../../../registry/pi-chat/composer.tsx';
import { ModelEffortPicker } from '../../../registry/pi-chat-pickers/pickers.tsx';
import { SlashPicker } from '../../../registry/pi-chat-slash/slash-menu.tsx';
import { MentionPicker } from '../../../registry/pi-chat-mentions/mention-menu.tsx';

const image = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAABxklEQVR4nA3LsapFAAAA0Pd1dzKZTKazkCJFihQpUqTIYPKpz9nP3+8W3MJbdItvbumtuNW37jbeltt+u27P7b39/U7BKTxFp/jklJ6KU33qTuNpOe2n6/Sc3vMLh+AQHqJDfHBID8WhPnSH8bAc9sN1eA7v8YVNsAk30Sbe2KSbYlNvus24WTb75to8m3f7wipYhatoFa+s0lWxqlfdalwtq311rZ7Vu35hFszCWTSLZ2bprJjVs242zpbZPrtmz+ydvzAJJuEkmsQTk3RSTOpJNxkny2SfXJNn8k5fGASDcBAN4oFBOigG9aAbjINlsA+uwTN4hy/0gl7Yi3pxTy/tFb261/XG3tLbe1fv6b39F1pBK2xFrbillbaKVt3qWmNrae2tq/W03vYLjaARNqJG3NBIG0WjbnSNsbE09sbVeBpv84VKUAkrUSWuqKSVolJXuspYWSp75ao8lbf6QikohaWoFJeU0lJRqktdaSwtpb10lZ7SW34hF+TCXJSLc3JprsjVuS435pbcnrtyT+7Nv5AJMmEmysQZmTRTZOpMlxkzS2bPXJkn82ZfSASJMBEl4oREmigSdaJLjIklsSeuxJN4E/9aqVaQxllllgAAAABJRU5ErkJggg==';
const files = ['notes/picnic-plan.md', 'notes/packing-list.md', 'drafts/invitation.md'];
// The `/` and `@` menus are the pi-chat-slash and pi-chat-mentions items, plugged in as the aggregates do.
const slash = {
  Picker: SlashPicker,
  commands: [{ name: 'new', description: 'Start a fresh fictional conversation.', run() {} }, { name: 'clear', description: 'Clear the message box.', run: api => api.setText('') }],
  skills: [{ name: 'plain-language', description: 'Rewrite the fictional draft in plain language.' }, { name: 'letter-style', description: 'House style for fictional letters.', sourcePlugin: 'letters' }],
};
const models = { options: [{ provider: 'fictional', modelId: 'swift-1', label: 'Swift 1' }, { provider: 'fictional', modelId: 'careful-2', label: 'Careful 2' }] };

/** The real registry Composer with fictional host callbacks: no model, provider or upload authority. */
export function GroupThreeControls({ surface }) {
  const [text, setText] = useState(surface === 'text' || surface === 'streaming' ? 'Plan a fictional picnic for Saturday with the Cedar Works team.' : surface === 'chips' ? 'Summarise @notes/picnic-plan.md ' : '');
  const [attachments, setAttachments] = useState(surface === 'chips' ? [{ id: 'a1', name: 'meadow-photo.png', mimeType: 'image/png', data: image }] : []);
  const [uploads, setUploads] = useState(surface === 'chips' ? [{ id: 'u1', name: 'pasted-text.txt', state: 'uploading', cancel: () => setUploads([]) }, { id: 'u2', name: 'menu.pdf', state: 'failed', error: 'too large' }] : []);
  const [model, setModel] = useState(models.options[0]);
  const [effort, setEffort] = useState('medium');
  const [event, setEvent] = useState('');
  const textareaRef = useRef(null);
  return <main className="pi-chat mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-end gap-6 p-4" data-testid="group-three-controls" data-surface={surface}>
    <Composer text={text} onText={setText} attachments={attachments} onRemoveAttachment={id => setAttachments(list => list.filter(item => item.id !== id))}
      mentionPaths={surface === 'chips' ? ['notes/picnic-plan.md'] : []} uploads={uploads} onDismissUpload={id => setUploads(list => list.filter(item => item.id !== id))}
      slash={slash} mentions={{ Picker: MentionPicker, search: async query => files.filter(path => path.includes(query)).map(path => ({ path })) }}
      working={surface === 'streaming'} sendBlocked={false} disabled={false} stopRequested={false} onSend={() => setEvent('sent')} onStop={() => setEvent('stopped')}
      uploading={false} canAttach fileAccept="image/*" onPickFiles={() => setEvent('picked')} textareaRef={textareaRef}
      barStart={<ModelEffortPicker model={models} effort={{ options: ['low', 'medium', 'high'] }} currentModel={model} currentEffort={effort} disabled={false} busy={null} onModel={setModel} onEffort={setEffort} />} />
    <output data-testid="group-three-event">{event}</output>
  </main>;
}
