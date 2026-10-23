// The spike's ArtifactPanel and phone drawer, now using the installed board kind rather than a prototype renderer.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { createResourceClient } from '@hachej/boring-files/remote';
import { ArtifactPanel } from '../../registry/pi-app/artifact-panel';
import { createBoardKind } from '../../registry/board-viewer/board-kind';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';

const { token, identity, seeded } = JSON.parse(document.getElementById('boot').textContent);
const authorized = request => { const headers = new Headers(request.headers); headers.set('authorization', `Bearer ${token}`); return fetch(new Request(request, { headers })); };
const client = createResourceClient({ identity, endpoint: new URL('/api/resources', location.href), publication: true, reconciliation: true, fetch: authorized });
const path = 'mockups/booking.board.json';
const descriptor = { schema: 'boring.artifact', version: 1, title: 'Session booking board', type: 'code', mediaType: 'application/json', language: 'json',
  target: { resource: { providerId: 'workspace', path }, view: { kind: 'published' } }, revision: seeded[path] };
window.__board = { editor: null, client, descriptor };
const onEditor = editor => { window.__board.editor = editor; };
const history = async path => (await (await authorized(new Request(new URL(`/api/history?path=${encodeURIComponent(path)}`, location.href)))).json()).saves;
function App() {
  const [wide, setWide] = useState(() => matchMedia('(min-width: 768px)').matches);
  const [open, setOpen] = useState(new URLSearchParams(location.search).has('open'));
  const follow = !new URLSearchParams(location.search).has('pinned');
  useEffect(() => {
    const media = matchMedia('(min-width: 768px)'), change = () => setWide(media.matches);
    media.addEventListener('change', change); return () => media.removeEventListener('change', change);
  }, []);
  const [kinds, setKinds] = useState(null);
  useEffect(() => { if (open && !kinds) void import('../canvas-assets/self-hosted.mjs').then(({ selfHostedCanvasAssetUrls }) => setKinds([createBoardKind({ client, identity, assetUrls: selfHostedCanvasAssetUrls('/tldraw-assets'), onEditor })])); }, [open, kinds]);
  const panel = open && kinds && <ArtifactPanel active={{ descriptor, follow }} versions={[descriptor]} options={{ client, identity, history, kinds }} onSelect={() => {}} onClose={() => setOpen(false)} />;
  const conversation = <section className="flex flex-col gap-3 p-4" data-testid="conversation"><h1>Session booking, fictional</h1>
    <p className="text-muted-foreground">Maquette screens and an HTML mock-up, arranged by the PM.</p><Button data-testid="open-board" onClick={() => setOpen(true)}>Open board</Button></section>;
  if (wide) return <main className="grid h-dvh grid-cols-[320px_1fr]"><div>{conversation}</div><div className="min-h-0" data-testid="panel-column">{panel}</div></main>;
  return <main className="h-dvh">{conversation}<Drawer open={open} onOpenChange={setOpen} showSwipeHandle swipeDirection="down">
    <DrawerContent className="h-[92dvh] max-h-[92dvh]" data-testid="phone-sheet"><DrawerTitle className="sr-only">Board</DrawerTitle>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{panel}</div></DrawerContent></Drawer></main>;
}
createRoot(document.getElementById('root')).render(<App />);
