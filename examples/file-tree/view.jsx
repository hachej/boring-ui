import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { connectRevisionProvider } from '@hachej/boring-files/revision';
import { FileTree } from '../../registry/file-tree/file-tree';
import { AgentWorkspace } from '../../registry/pi-app/agent-workspace';
import { MentionMenu } from '../../registry/pi-chat/mention-menu';

window.fileTreeFixture = { ready: false, dropNextPublish: false, holdNextList: false, publishCalls: 0, releaseList: undefined };
function App() {
  const [integrated, setIntegrated] = useState(false);
  const [scope, setScope] = useState('first');
  const [provider, setProvider] = useState();
  const [opened, setOpened] = useState('');
  const [mention, setMention] = useState('');
  const [selectedMention, setSelectedMention] = useState('');
  const [failure, setFailure] = useState('');
  useEffect(() => {
    let active = true;
    setProvider(undefined); setOpened(''); setFailure(''); setMention(''); setSelectedMention('');
    window.fileTreeFixture.ready = false;
    const fetchAuthenticated = async request => {
      const headers = new Headers(request.headers);
      headers.set('authorization', 'Bearer fictional-file-tree');
      headers.set('x-fictional-workspace', scope);
      const call = request.method === 'POST' ? await request.clone().json() : undefined;
      if (call?.kind === 'publish') window.fileTreeFixture.publishCalls++;
      const response = await fetch(new Request(request, { headers }));
      if (call?.kind === 'publish' && window.fileTreeFixture.dropNextPublish) { window.fileTreeFixture.dropNextPublish = false; await response.arrayBuffer(); throw new Error('Fictional lost publication acknowledgement'); }
      if (call?.kind === 'list' && window.fileTreeFixture.holdNextList) { window.fileTreeFixture.holdNextList = false; await new Promise(resolve => { window.fileTreeFixture.releaseList = resolve; }); }
      return response;
    };
    void connectRevisionProvider({ endpoint: new URL('/api/workspace', location.href), fetch: fetchAuthenticated }).then(value => {
      if (!active) return;
      setProvider(value); window.fileTreeFixture.provider = value; window.fileTreeFixture.ready = true;
    }, error => { if (active) setFailure(error.message); });
    return () => { active = false; };
  }, [scope]);
  if (new URLSearchParams(location.search).has('detached')) return <main>
    <h1>Detached library</h1>
    {failure && <p role="alert">{failure}</p>}
    {provider && <FileTree revisionProvider={provider} onOpen={setOpened} selectedPath={opened} />}
    <output aria-label="Opened file">{opened}</output>
  </main>;
  return <main>
    <h1>Workspace files</h1>
    <p>Fictional SQLite workspace. Uploads publish with revision checks.</p>
    <button type="button" onClick={() => setScope(value => value === 'first' ? 'second' : 'first')}>Switch workspace</button>
    <output aria-label="Selected workspace">{scope}</output>
    {failure && <p role="alert">{failure}</p>}
    <button type="button" onClick={() => setIntegrated(true)}>Open integrated workspace</button>
    {provider && integrated && <div style={{ height: 700 }}><AgentWorkspace controller={undefined} conversationId={undefined} revisionProvider={provider} /></div>}
    {provider && !integrated && <>
      <FileTree revisionProvider={provider} onOpen={setOpened} selectedPath={opened} />
      <output aria-label="Opened file">{opened}</output>
      <section aria-label="Mention picker">
        <label>File mention<input aria-label="File mention" value={mention} onChange={event => setMention(event.target.value)} /></label>
        {mention.startsWith('@') && <MentionMenu query={mention.slice(1)} search={(query, signal) => provider.search({ query, limit: 8 }, signal).then(page => page.entries)} onSelect={path => { setSelectedMention(path); setMention(''); }} onDismiss={() => setMention('')} />}
        <output aria-label="Selected mention">{selectedMention}</output>
      </section>
    </>}
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);
