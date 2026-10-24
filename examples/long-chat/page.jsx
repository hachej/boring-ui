import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';
import { PiChat as BarePiChat } from '../../registry/pi-chat/pi-chat';
import { withChatPlugins } from '../../registry/pi-chat-plugins/chat-plugins';
import { markdownText } from '../../registry/pi-chat-markdown/markdown';

// Every composer feature item, as an app installs them; `?first=` and `?more=` set the paging (default: the kit's 60 and 40).
const PiChat = props => <BarePiChat {...withChatPlugins(props)} />;
// The Markdown renderer, counting each reply part it draws: the scroll test reads `window.__textRenders`.
window.__textRenders = 0;
const renderText = part => { window.__textRenders++; return markdownText(part); };
const search = new URLSearchParams(location.search);
const paging = { first: Number(search.get('first')) || undefined, more: Number(search.get('more')) || undefined };
function App() {
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
  return <main className="box-border h-screen p-4">{controller ? <PiChat controller={controller} conversationTitle="Fictional long chat" paging={paging} renderText={renderText} /> : <p>Connecting…</p>}</main>;
}
createRoot(document.getElementById('root')).render(<App />);
