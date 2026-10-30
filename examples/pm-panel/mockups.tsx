// Fictional native mockup fixture; the host supplies exact resource reads, never latest or a docs fallback.
import { createRoot } from 'react-dom/client';
import { useMemo } from 'react';
import { connectRevisionProvider } from '@hachej/boring-files/revision';
import { useRemoteChat } from '../../registry/pi-chat/use-remote-chat';
import { PmChat, PmPanelProvider, ImproveLayout } from '../../registry/pm-panel/pm-panel';
import type { PmReadArtifact } from '../../registry/pm-panel/pm-panel';

const host = (window as unknown as { __MOCKUPS__: { conversationId: string; identity: import('@hachej/boring-ui-kit/native-chat').ChatIdentity } }).__MOCKUPS__;
const sameOrigin = (request: Request) => fetch(new Request(request, { credentials: 'same-origin' }));
const provider = connectRevisionProvider({ endpoint: new URL('api/pm/resources', location.href), fetch: sameOrigin });
const readArtifact: PmReadArtifact = async (artifact, signal) => {
  const read = await (await provider).read({ target: artifact.target, revision: { kind: 'exact', value: artifact.revision } }, signal);
  return read.kind === 'available' ? new TextDecoder().decode(read.snapshot.bytes) : undefined;
};
function App() {
  const remote = useRemoteChat({ conversationId: host.conversationId, identity: host.identity, fetch: sameOrigin,
    endpoint: id => new URL(`api/pm/chat?conversation=${id}`, location.href) });
  const spec = useMemo(() => remote.status === 'ready' ? { controller: remote.controller, readArtifact, chatProps: { actions: remote.actions, locale: 'fr' as const } } : undefined, [remote]);
  if (!spec) return <p>Connexion…</p>;
  return <main className="flex h-dvh min-w-0 flex-col bg-background text-foreground">
    {new URLSearchParams(location.search).has('member') ? <PmPanelProvider spec={spec} open close={() => {}} locale="fr"><ImproveLayout><h1>Atelier fictif</h1></ImproveLayout></PmPanelProvider>
      : <PmChat spec={spec} page={null} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
