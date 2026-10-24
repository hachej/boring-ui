import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';
import { PiChat as BarePiChat } from '../../registry/pi-chat/pi-chat';
import { withChatPlugins } from '../../registry/pi-chat-plugins/chat-plugins';
import { markdownText } from '../../registry/pi-chat-markdown/markdown';
import { SharedChat, createFakeChannelSource, useSharedChat } from '../../registry/shared-chat/shared-chat';

// Every composer feature item, as an app installs them; `?first=` and `?more=` set the paging (default: the kit's 60 and 40).
// `?shared` shows the same 500 fictional messages as a SharedChat channel, read from its source page by page.
const PiChat = props => <BarePiChat {...withChatPlugins(props)} />;
// The Markdown renderer, counting each reply part it draws: the scroll test reads `window.__textRenders`.
window.__textRenders = 0;
const renderText = part => { window.__textRenders++; return markdownText(part); };
const search = new URLSearchParams(location.search);
const paging = { first: Number(search.get('first')) || undefined, more: Number(search.get('more')) || undefined };
const MESSAGES = Number(search.get('messages')) || 500;

function Native() {
  const [controller, setController] = useState();
  useEffect(() => {
    let disposed = false, remote, owned;
    void (async () => {
      remote = await createRemoteChat({ endpoint: new URL('/chat', location.href), fetch: request => fetch(request), pollMs: 1000 });
      owned = createNativeChatController({ ...remote, identity: { runtimeId: 'fictional-long', scopeId: 'fictional', principalId: 'fictional-reader' } });
      if (disposed) { await owned.dispose(); await remote.close(); return; }
      setController(owned);
    })();
    return () => { disposed = true; void owned?.dispose(); void remote?.close(); };
  }, []);
  return controller ? <PiChat controller={controller} conversationTitle="Fictional long chat" paging={paging} renderText={renderText} /> : <p>Connecting…</p>;
}

const people = [{ id: 'mira', name: 'Mira', kind: 'person' }, { id: 'assistant', name: 'Assistant', kind: 'agent' }, { id: 'tom', name: 'Tom', kind: 'person' }];
const reply = index => `**Fictional note ${index}**\n\n- Pack the blanket\n- Bring ${index % 7 + 1} thermos\n\n\`inline ${index}\``;
const channel = createFakeChannelSource({
  me: people[0], members: people, conversations: [{ id: 'room', title: 'Fictional picnic', members: people.map(person => person.id) }],
  messages: Array.from({ length: MESSAGES }, (_, index) => ({ id: `m${index}`, conversationId: 'room', author: people[index % 3].id,
    at: new Date(Date.UTC(2026, 9, 1) + index * 3_600_000).toISOString(), text: index % 3 === 1 ? reply(index) : `Fictional question ${index}: what should we bring?` })),
});
window.__CHANNEL__ = channel;
function Shared() {
  const shared = useSharedChat(channel, { limit: paging.more ?? 60 });
  if (!shared.controller) return <p>Opening the fictional channel…</p>;
  return <SharedChat controller={shared.controller} conversations={shared.conversations} labels={{ title: 'Fictional picnic' }} paging={paging} renderText={renderText} />;
}
createRoot(document.getElementById('root')).render(<main className="box-border h-screen p-4">{search.has('shared') ? <Shared /> : <Native />}</main>);
