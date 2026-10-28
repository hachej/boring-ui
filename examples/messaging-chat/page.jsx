import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';
import { PiChat } from '../../registry/pi-chat/pi-chat';
import { markdownText } from '../../registry/pi-chat-markdown/markdown';

// One-to-one PiChat over a fictional French coaching conversation. `?style=messaging` turns on the messenger look (default: today's);
// `?mode=dark` and `?theme=brand` come from the shared theme preview head. Nothing else changes between the two.
const style = new URLSearchParams(location.search).get('style') === 'messaging' ? 'messaging' : 'default';

function Chat() {
  const [controller, setController] = useState();
  useEffect(() => {
    let disposed = false, remote, owned;
    void (async () => {
      remote = await createRemoteChat({ endpoint: new URL('/chat', location.href), fetch: request => fetch(request), pollMs: 1000 });
      owned = createNativeChatController({ ...remote, identity: { runtimeId: 'fictional-coach', scopeId: 'fictional', principalId: 'fictional-reader' } });
      if (disposed) { await owned.dispose(); await remote.close(); return; }
      setController(owned);
    })();
    return () => { disposed = true; void owned?.dispose(); void remote?.close(); };
  }, []);
  return controller ? <PiChat controller={controller} locale="fr" conversationTitle="Coach fictif" messageStyle={style} renderText={markdownText} /> : <p>Connexion…</p>;
}
createRoot(document.getElementById('root')).render(<main className="box-border h-screen p-4"><Chat /></main>);
