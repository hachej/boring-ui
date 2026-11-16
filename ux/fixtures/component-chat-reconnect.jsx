import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';
import { PiChat } from '../../registry/pi-chat/pi-chat.tsx';
import { markdownText } from '../../registry/pi-chat-markdown/markdown.tsx';

// Component scenario `component:chat-reconnect`: the chat over the REAL controller and the REAL remote client, with a fake host that lives in
// this page (no model, no network). The host can drop its streams and restart, so the scenario shows what the chat does when the connection
// goes away and comes back. Query: dark=1, pace=instant|real (the wait before a reply).
// `window.__ux`: `drop` (the stream dies, the host stays up), `restart` (streams die, the host is away for a moment), `loseNext` (the
// host confirms the next message and then loses it, as a restart without storage would), `sends` (how many messages the host received).
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
const REPLY_MS = params.get('pace') === 'instant' ? 200 : 900;
const encoder = new TextEncoder();
const model = (role, content, extra = {}) => ({ role, content, timestamp: 1, ...extra });

function createHost() {
  let entries = [], counter = 0, down = false, lose = 0, received = 0;
  const streams = new Set(), submissions = new Map();
  const view = () => ({ conversation: { id: 'fictional-chat' }, entries, docs: {} });
  const publish = () => { for (const stream of streams) stream.enqueue(encoder.encode(JSON.stringify({ kind: 'view', view: view() }) + '\n')); };
  const cut = () => { for (const stream of [...streams]) { streams.delete(stream); stream.error(new TypeError('The fictional host dropped the stream')); } };
  const place = (requestId, text) => {
    const id = ++counter;
    entries = [...entries, { id, kind: 'message', model: [model('user', text)] }];
    submissions.set(requestId, { id, conversationId: 'fictional-chat', requestId, type: 'input', status: 'done', entry: id });
    publish();
    setTimeout(() => { entries = [...entries, { id: ++counter, kind: 'message', byTaskId: 7, model: [model('assistant', [{ type: 'text', text: `Noted: “${text}”. I will come back to you on it.` }], { api: 'fictional', provider: 'fictional', model: 'fictional', stopReason: 'stop' })] }]; publish(); }, REPLY_MS);
  };
  const fetch = async request => {
    const url = new URL(request.url), op = url.searchParams.get('op');
    if (down) throw new TypeError('The fictional host is away');
    if (op === 'watch') return new Response(new ReadableStream({ start(stream) { streams.add(stream); stream.enqueue(encoder.encode(JSON.stringify({ kind: 'view', view: view() }) + '\n')); } }), { headers: { 'content-type': 'application/x-ndjson' } });
    if (op === 'submit') {
      const { requestId, content } = await request.json();
      received++;
      // Confirmed, then lost: the host answers and restarts before it kept the message.
      if (lose > 0) { lose--; return Response.json({ submissionId: 900 + received }); }
      if (!submissions.has(requestId)) place(requestId, typeof content === 'string' ? content : content.map(part => part.text ?? '').join(''));
      return Response.json({ submissionId: submissions.get(requestId).id });
    }
    if (op === 'submission') return Response.json({ record: submissions.get(url.searchParams.get('requestId')) ?? null });
    return Response.json({});
  };
  return { fetch, cut,
    restart: ms => { down = true; cut(); setTimeout(() => { down = false; }, ms); },
    loseNext: () => { lose++; }, received: () => received };
}

const host = createHost();
window.__ux = { drop: () => host.cut(), restart: () => host.restart(1500), loseNext: () => host.loseNext(), sends: () => host.received() };

function App() {
  const [controller, setController] = useState();
  useEffect(() => {
    let owned, remote, gone = false;
    void (async () => {
      remote = await createRemoteChat({ endpoint: new URL('https://fixture.invalid/chat'), fetch: request => host.fetch(request), pollMs: 100, reconnect: { baseDelayMs: 400, maxDelayMs: 800 } });
      owned = createNativeChatController({ ...remote, identity: { runtimeId: 'fictional', scopeId: 'chat-reconnect', principalId: 'julie' } });
      if (gone) { await owned.dispose(); await remote.close(); return; }
      setController(owned);
    })();
    return () => { gone = true; void owned?.dispose(); void remote?.close(); };
  }, []);
  return <main className="flex min-h-dvh items-center justify-center bg-muted/30 p-4 sm:p-8">
    <div data-testid="surface" className="flex h-104 w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-background shadow-sm">
      {controller ? <PiChat controller={controller} locale="en" header={false} showHistory={false} emptyState={<div />} emptyLayout="docked" composerLayout="pill" renderText={markdownText} labels={{ placeholder: 'Write a message' }} /> : <p className="m-4 text-sm text-muted-foreground">Connecting…</p>}
    </div>
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);
