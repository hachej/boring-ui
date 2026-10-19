// The spike page: a fictional PM conversation (a stub) beside the real pi-app ArtifactPanel. The panel gets two app kinds: `*.board.json`
// (a tldraw board) and `*.mockup.html` (the HTML mock-up in the html viewer's sandbox, with the app's theme). The built-in maquette kind
// stays. At 768px and wider the panel is a right column; below, it opens in the shadcn bottom drawer (the phone sheet). Pins from the board
// arrive in the conversation as feedback@1 reports. `?open=board|mockup|maquette` opens one artifact at start.
// @ts-nocheck: an example page, bundled by esbuild and not part of the typechecked sources.
import 'tldraw/tldraw.css';
import { createRoot } from 'react-dom/client';
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { CodeXmlIcon, LayoutDashboardIcon, LayoutTemplateIcon, MessageSquareIcon } from 'lucide-react';
import { createResourceClient } from '@hachej/boring-files/remote';
import { ArtifactPanel } from '../../registry/pi-app/artifact-panel';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { isBoardPath, isMockupPath } from './board';
import { mockupDocument } from './mockup-frame';

const boot = JSON.parse(document.getElementById('boot').textContent);
const { token, identity, seeded, mockupCss, licenseKey } = boot;
const authorized = (request: Request) => { const headers = new Headers(request.headers); headers.set('authorization', `Bearer ${token}`); return fetch(new Request(request, { headers })); };
const client = createResourceClient({ identity, endpoint: new URL('/api/resources', location.href), publication: true, reconciliation: true, fetch: authorized });
const history = async (path: string) => (await (await authorized(new Request(new URL(`/api/history?path=${encodeURIComponent(path)}`, location.href)))).json()).saves;
const ARTIFACTS = {
  board: { path: 'mockups/booking.board.json', title: 'Session booking board', type: 'code', mediaType: 'application/json', language: 'json' },
  mockup: { path: 'mockups/confirm.mockup.html', title: 'Confirmation, HTML draft', type: 'html', mediaType: 'text/html' },
  maquette: { path: 'mockups/booking.maquette.json', title: 'Session booking maquette', type: 'code', mediaType: 'application/json', language: 'json' },
  // Written by the journey (a hostile fictional page probing the sandbox); not listed in the conversation.
  probe: { path: 'mockups/probe.mockup.html', title: 'Sandbox probe', type: 'html', mediaType: 'text/html' },
};
const descriptor = (key: keyof typeof ARTIFACTS) => {
  const { path, ...rest } = ARTIFACTS[key];
  return { schema: 'boring.artifact', version: 1, ...rest, target: { resource: { providerId: 'workspace', path }, view: { kind: 'published' } }, revision: seeded[path] ?? 'written-later' };
};
// The board (tldraw and the frame shapes) is a lazy chunk: the conversation and the other viewers never load it.
const boardModule = () => import('./board-canvas');
const BoardCanvas = lazy(() => boardModule().then(module => ({ default: module.BoardCanvas })));
// Test hooks the journey reads.
window.__board = { pins: [], editor: null, snapshotBytes: async () => window.__board.editor ? (await boardModule()).snapshotBytes(window.__board.editor) : 0, client };

/** The mock-up in the html viewer's sandbox, with the app's theme tokens and the utilities its classes need. */
function MockupView({ text }: { readonly text: string }) {
  const [doc, setDoc] = useState<string>();
  useEffect(() => { let live = true; void mockupDocument(text, mockupCss, { dark: document.documentElement.classList.contains('dark') }).then(value => { if (live) setDoc(value); }); return () => { live = false; }; }, [text]);
  return doc ? <iframe title="HTML mock-up (running)" sandbox="allow-scripts" allow="" referrerPolicy="no-referrer" srcDoc={doc} data-testid="mockup-frame" className="block size-full min-h-[70dvh] border-0 bg-background" />
    : <p role="status" className="p-4 text-sm text-muted-foreground">Preparing mock-up…</p>;
}

/** The board kind's renderer: the kind gets the text but not its revision, so the board reads the latest revision itself (see the verdict). */
function BoardHost({ path, text, onPin }: { readonly path: string; readonly text: string; readonly onPin: (pin) => void }) {
  const [revision, setRevision] = useState<string>();
  useEffect(() => {
    void client.read({ target: { resource: { providerId: 'workspace', path }, view: { kind: 'published' } }, revision: { kind: 'latest' } })
      .then(result => { if (result.kind === 'available' && new TextDecoder().decode(result.snapshot.bytes) === text) setRevision(result.snapshot.ref.revision); });
  }, [path, text]);
  if (!revision) return <p role="status" className="p-4 text-sm text-muted-foreground">Loading board…</p>;
  return <div className="h-full min-h-[320px]">
    <Suspense fallback={<p role="status" className="p-4 text-sm text-muted-foreground">Loading board…</p>}>
      <BoardCanvas path={path} text={text} revision={revision} client={client} css={mockupCss} assetBase="/tldraw-assets" licenseKey={licenseKey} onPin={onPin}
        onEditor={editor => { window.__board.editor = editor; }} />
    </Suspense>
  </div>;
}

function useWide() {
  const query = '(min-width: 768px)';
  const [wide, setWide] = useState(() => matchMedia(query).matches);
  useEffect(() => { const list = matchMedia(query), change = () => setWide(list.matches); list.addEventListener('change', change); return () => list.removeEventListener('change', change); }, []);
  return wide;
}

function App() {
  const wide = useWide();
  const initial = new URLSearchParams(location.search).get('open');
  const [open, setOpen] = useState<keyof typeof ARTIFACTS | null>(initial in ARTIFACTS ? initial : null);
  const [pins, setPins] = useState([]);
  const onPin = useCallback(pin => { window.__board.pins.push(pin); setPins(current => [...current, pin]); }, []);
  // Kinds are host code: the board and mock-up renderers. The built-in maquette kind comes after them.
  const kinds = useMemo(() => [
    { match: target => isBoardPath(target.resource.path), label: 'Board', icon: LayoutDashboardIcon, renderer: ({ artifact, text }) => <BoardHost path={artifact.target.resource.path} text={text} onPin={onPin} /> },
    { match: target => isMockupPath(target.resource.path), label: 'HTML mock-up', icon: CodeXmlIcon, renderer: ({ text }) => <MockupView text={text} /> },
  ], [onPin]);
  const panel = open && <ArtifactPanel key={open} active={{ descriptor: descriptor(open), follow: true }} versions={[descriptor(open)]}
    options={{ client, identity, history, kinds }} onSelect={() => {}} onClose={() => setOpen(null)} />;
  const conversation = <section className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4" data-testid="conversation">
    <h1 className="m-0 text-base font-semibold">PM conversation (fictional)</h1>
    <p className="m-0 text-sm text-muted-foreground">The product manager drew the session booking flow. Open an artifact:</p>
    <div className="flex flex-col gap-2">
      {[['board', 'Board: all screens', LayoutDashboardIcon], ['mockup', 'HTML mock-up: confirmation', CodeXmlIcon], ['maquette', 'Maquette: one screen at a time', LayoutTemplateIcon]].map(([key, label, Icon]) =>
        <Button key={key} variant={open === key ? 'secondary' : 'outline'} className="min-h-11 justify-start gap-2" data-testid={`open-${key}`} onClick={() => setOpen(key)}><Icon aria-hidden="true" />{label}</Button>)}
    </div>
    {pins.map(pin => <article key={pin.id} data-testid="conversation-pin" className="rounded-xl border border-border bg-card p-3 text-sm">
      <p className="m-0 flex items-center gap-2 font-medium"><MessageSquareIcon className="size-4" aria-hidden="true" />Comment on {pin.frameId}</p>
      <p className="m-0 mt-1">{pin.said}</p>
      <details className="mt-1 text-xs text-muted-foreground"><summary>feedback@1 report sent to the PM</summary><pre className="whitespace-pre-wrap" data-testid="conversation-pin-report">{pin.report}</pre></details>
    </article>)}
  </section>;
  if (wide) return <main className="grid h-dvh grid-cols-[minmax(280px,360px)_1fr] bg-background text-foreground">
    <div className="min-h-0 border-r border-border">{conversation}</div>
    <div className="min-h-0" data-testid="panel-column">{panel || <p className="p-6 text-sm text-muted-foreground">No artifact open.</p>}</div>
  </main>;
  return <main className="h-dvh bg-background text-foreground">
    {conversation}
    <Drawer open={!!open} onOpenChange={next => { if (!next) setOpen(null); }} showSwipeHandle swipeDirection="down">
      <DrawerContent data-testid="phone-sheet" className="h-[92dvh] max-h-[92dvh]">
        <DrawerTitle className="sr-only">Artifact</DrawerTitle>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{panel}</div>
      </DrawerContent>
    </Drawer>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
