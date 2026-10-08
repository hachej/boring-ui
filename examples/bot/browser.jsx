// Browser side of the bot: the pi-chat registry item over the remote chat transport, beside the memory & self panel.
// One conversation for life, so there is no conversation picker. No Pi runtime is bundled.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeftIcon, BrainIcon } from 'lucide-react';
import { PiChat } from '../../registry/pi-chat/pi-chat.tsx';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';
import { copyToClipboard } from '@hachej/boring-files/platform';
import { BotPanel } from './panel.jsx';

const { token, identity, model } = window.__BOT__;
const authorized = request => { const headers = new Headers(request.headers); headers.set('authorization', `Bearer ${token}`); return fetch(new Request(request, { headers })); };
const api = async (path, init) => { const response = await authorized(new Request(new URL(path, location.href), init)); if (!response.ok) throw new Error(`${path}: ${response.status}`); return response.json(); };

/** The chat controller. A dropped stream is retried; it never means the bot stopped working. */
function useChat() {
  const [chat, setChat] = useState({ status: 'connecting' });
  useEffect(() => {
    let disposed = false, controller;
    (async () => {
      for (;;) {
        try {
          const remote = await createRemoteChat({ endpoint: new URL('/api/chat', location.href), fetch: authorized });
          if (disposed) return;
          controller = createNativeChatController({ identity, ...remote });
          await controller.connect();
          if (disposed) return void controller.dispose();
          const actions = {};
          if (typeof remote.answer === 'function') actions.answer = remote.answer;
          if (typeof remote.withdraw === 'function') actions.withdraw = remote.withdraw;
          setChat({ status: 'ready', controller, actions });
          return;
        } catch (error) {
          if (disposed) return;
          setChat({ status: 'offline', error: String(error?.message ?? error) });
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    })();
    return () => { disposed = true; controller?.dispose(); };
  }, []);
  return chat;
}

function App() {
  const chat = useChat();
  const [details, setDetails] = useState(false);
  const [sheet, setSheet] = useState(false);
  return <div className="bot">
    <main className="bot-chat">
      {chat.status === 'ready'
        ? <PiChat controller={chat.controller} mode={details ? 'developer' : 'expert'} actions={chat.actions} onCopy={text => copyToClipboard(text)}
            labels={{ title: 'Bot', emptyDescription: 'One conversation for life. It remembers everything you say and can rewrite its own persona and abilities.' }}
            controls={<>
              <label className="bot-toggle"><input type="checkbox" data-testid="bot-details" checked={details} onChange={event => setDetails(event.target.checked)} /> Tool calls</label>
              <button type="button" className="bot-panel-open" data-testid="bot-panel-open" onClick={() => setSheet(true)}><BrainIcon size={16} aria-hidden="true" />Memory</button>
            </>} />
        : <p className="bot-loading" role="status">{chat.status === 'offline' ? 'Server unreachable. Retrying…' : 'Connecting…'}</p>}
    </main>
    <aside className={sheet ? 'bot-panel is-open' : 'bot-panel'} aria-label="Memory and self">
      <div className="bot-panel-head">
        <button type="button" className="bot-sheet-close" onClick={() => setSheet(false)}><ArrowLeftIcon size={18} aria-hidden="true" />Chat</button>
        <h2>Memory &amp; self</h2><code>{model}</code>
      </div>
      <BotPanel api={api} />
    </aside>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
