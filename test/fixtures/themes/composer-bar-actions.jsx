import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Composer } from '../../../registry/pi-chat/composer.tsx';
import { ChatTextProvider, defaultChatIcons, defaultChatLabels } from '../../../registry/pi-chat/labels.ts';
import { Button } from '@/components/ui/button';
import { SlashPicker } from '../../../registry/pi-chat-slash/slash-menu.tsx';

// D-2064: the real composer with `barActions`: attach and commands as bar buttons. Query: ?theme=light|dark&barActions=on|off. The app supplies the words
// (fictional French here); the kit holds none. A capture-phase listener counts the clicks on the hidden file input (the picker opening) and cancels them.
const query = new URLSearchParams(location.search);
document.documentElement.classList.toggle('dark', query.get('theme') === 'dark');
const text = { labels: { ...defaultChatLabels, attachFiles: 'Ajouter des fichiers', commands: 'Actions du dossier' }, icons: defaultChatIcons };
const slash = { Picker: SlashPicker, commands: [{ name: 'relance', description: 'Rédiger une relance fictive.', run: api => api.setText('Relance du dossier Cèdre') }], skills: [] };
window.__picker = 0;
document.addEventListener('click', event => { if (event.target instanceof Element && event.target.closest('[data-testid=composer-file]')) { window.__picker += 1; event.preventDefault(); } }, true);

function Case() {
  const [value, setValue] = useState('');
  return <div className="pi-chat mx-auto w-full max-w-[720px] p-4"><ChatTextProvider value={text}>
    <Composer attachments={[]} onRemoveAttachment={() => {}} working={false} sendBlocked={false} disabled={false} stopRequested={false} onSend={() => {}} onStop={() => {}}
      uploading={false} canAttach fileAccept="" onPickFiles={() => {}} text={value} onText={setValue} slash={slash} barEnd={<Button type="button" variant="ghost" size="icon" data-testid="voice-stub" aria-label="Dicter">D</Button>} {...(query.get('barActions') === 'off' ? {} : { barActions: true })} />
  </ChatTextProvider></div>;
}
createRoot(document.getElementById('root')).render(<Case />);
