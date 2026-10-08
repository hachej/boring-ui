// Browser side of the live slice: no Pi, harness or server filesystem code may be bundled here.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { randomUUID } from '@hachej/boring-files/platform';
import { createResourceClient } from '@hachej/boring-files/remote';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import { MarkdownEditor } from '@hachej/boring-ui-kit/markdown-editor';
import { createConversationTextReceiver } from '@hachej/boring-agent/projection';

const { token, conversationId, identity, runtimeId, target } = window.__SLICE__;
const authorized = { authorization: `Bearer ${token}` };
const client = createResourceClient({ identity, endpoint: new URL('/resources', location.href), publication: true, reconciliation: true,
  fetch: request => { const headers = new Headers(request.headers); headers.set('authorization', authorized.authorization); return fetch(new Request(request, { headers })); } });

function useTranscript() {
  const [state, setState] = useState({ connection: 'connecting', messages: [] });
  useEffect(() => {
    const stop = new AbortController();
    (async () => {
      while (!stop.signal.aborted) {
        const receiver = createConversationTextReceiver({ runtimeId, scopeId: identity.scopeId, principalId: identity.principalId, conversationId });
        try {
          const response = await fetch('/conversation?version=2', { headers: authorized, signal: stop.signal });
          if (!response.ok) throw new Error(`projection ${response.status}`);
          const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
          let pending = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            pending += value;
            let end;
            while ((end = pending.indexOf('\n')) >= 0) {
              const snapshot = receiver.read(pending.slice(0, end));
              pending = pending.slice(end + 1);
              setState({ connection: 'connected', messages: snapshot.messages });
            }
          }
        } catch (error) { if (stop.signal.aborted) return; console.error('projection ended', error); }
        // A closed connection is presentation state only; it says nothing about the native task.
        setState(previous => ({ ...previous, connection: 'reconnecting' }));
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    })();
    return () => stop.abort();
  }, []);
  return state;
}

function Chat({ transcript }) {
  const [text, setText] = useState('');
  const [send, setSend] = useState('idle');
  async function submit(event) {
    event.preventDefault();
    const draft = text.trim();
    if (!draft) return;
    setSend('submitting');
    try {
      const response = await fetch('/submit', { method: 'POST', headers: { ...authorized, 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: randomUUID(), text: draft }) });
      if (!response.ok) throw new Error(String(response.status));
      setText(''); setSend('idle');
    } catch { setSend('unknown'); }
  }
  return <section aria-label="Chat">
    <p role="status">Connection: {transcript.connection}</p>
    <div aria-label="Transcript">
      {transcript.messages.map(message => <div key={`${message.entryId}:${message.messageIndex}`} data-role={message.role}>
        {message.content.map(block => block.text).join('')}</div>)}
    </div>
    <form onSubmit={submit}>
      <textarea aria-label="Message" value={text} onChange={event => setText(event.target.value)} style={{ minHeight: 60 }} />
      <button type="submit" disabled={send === 'submitting' || !text.trim()}>Send</button>
      {send === 'unknown' && <p role="alert">Submission outcome is unknown.</p>}
    </form>
  </section>;
}

function Document({ transcript }) {
  const [document, setDocument] = useState({ kind: 'loading' });
  const current = useRef(document);
  current.current = document;
  // Follow the saved revision whenever the conversation changes, but never replace unsaved local edits.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const held = current.current;
      if (held.kind === 'open' && held.controller.getSnapshot().dirty) return;
      const read = await client.read({ target, revision: { kind: 'latest' } });
      if (cancelled) return;
      if (read.kind !== 'available') { if (held.kind !== 'open') setDocument({ kind: read.kind }); return; }
      if (held.kind === 'open') {
        const state = held.controller.getSnapshot();
        if (state.dirty) return;
        if (state.base.kind === 'revision' && state.base.target.revision === read.snapshot.ref.revision) return;
        held.controller.dispose();
      }
      setDocument({ kind: 'open', revision: read.snapshot.ref.revision,
        controller: createMarkdownController({ identity, client, instanceId: randomUUID(), epoch: 'live-slice', source: { kind: 'saved', snapshot: read.snapshot } }) });
    })();
    return () => { cancelled = true; };
  }, [transcript.messages]);
  return <section aria-label="Document">
    {document.kind === 'open'
      ? <><p data-testid="revision">Revision: {document.revision}</p><MarkdownEditor key={document.revision} controller={document.controller} title="Fictional notes" initialMode="source" /></>
      : <p data-testid="no-document">No saved document yet ({document.kind}).</p>}
  </section>;
}

function App() {
  const transcript = useTranscript();
  return <><Chat transcript={transcript} /><Document transcript={transcript} /></>;
}

createRoot(document.body.appendChild(document.createElement('main'))).render(<App />);
document.querySelector('main').style.display = 'contents';
