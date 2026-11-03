// The drawing viewer journey page (D-1398): each fictional fixture through the public block (`drawingKind`'s renderer, as an app's
// artifact panel calls it) beside the tool's own rendering of the same file: the Excalidraw editor in view mode, and draw.io's own HTML
// embed (GraphViewer from the same pinned viewer). `?fonts=missing` points the block at a folder that serves no Excalidraw font.
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createDrawingKind } from '../../registry/drawing-viewer/drawing-kind';
import { DrawingViewer } from '../../registry/drawing-viewer/drawing-viewer';
import type { Drawing } from '../../registry/drawing-viewer/drawing';

const { fixtures } = JSON.parse(document.getElementById('boot')!.textContent!) as { fixtures: Record<string, string> };
const params = new URLSearchParams(location.search);
const assets = params.get('fonts') === 'missing' ? '/missing-fonts/' : params.get('fonts') === 'partial' ? '/partial-fonts/' : '/excalidraw/';
const journey = { read: {} as Record<string, Drawing>, blocked: {} as Record<string, readonly string[]>, pwned: [] as unknown[], violations: [] as string[] };
(window as unknown as { __drawings: typeof journey }).__drawings = journey;
window.addEventListener('message', event => { if (event.data === 'pwned' || (event.data && typeof event.data === 'object' && 'pwned' in event.data)) journey.pwned.push(event.data); });
document.addEventListener('securitypolicyviolation', event => journey.violations.push(`${event.violatedDirective} ${event.blockedURI}`));

const kind = createDrawingKind({ excalidrawAssets: assets });

/** The Excalidraw editor itself, read-only: the reference for the Excalidraw fixture. */
function NativeExcalidraw({ text }: { readonly text: string }) {
  const [editor, setEditor] = useState<ReactNode>(null);
  useEffect(() => {
    void Promise.all([import('@excalidraw/excalidraw'), import('../../node_modules/@excalidraw/excalidraw/dist/prod/index.css')]).then(([{ Excalidraw }]) => {
      const scene = JSON.parse(text);
      setEditor(<Excalidraw initialData={{ elements: scene.elements, appState: { viewBackgroundColor: '#ffffff', theme: 'light' }, scrollToContent: true }} viewModeEnabled zenModeEnabled />);
    });
  }, [text]);
  return <div data-testid="native-excalidraw" className="h-[560px] w-full overflow-hidden rounded-md border">{editor}</div>;
}

/** draw.io's own HTML embed of the file (GraphViewer.processElements over a `.mxgraph` div), in a sandboxed frame like the block's. */
function NativeDrawio({ text }: { readonly text: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const nonce = crypto.randomUUID().replaceAll('-', '');
    const boot = `window.mxLoadResources=false;window.mxLoadStylesheets=false;window.addEventListener('message',function(e){if(e.source!==parent)return;var s=document.createElement('script');s.nonce='${nonce}';s.textContent=e.data.viewer;document.head.appendChild(s);var d=document.createElement('div');d.className='mxgraph';d.setAttribute('data-mxgraph',JSON.stringify({xml:e.data.xml,highlight:'none',nav:false,lightbox:false,toolbar:'',resize:true}));document.body.appendChild(d);GraphViewer.processElements();});`;
    element.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:"><style>body{margin:16px;background:#fff}</style><script nonce="${nonce}">${boot}</script></head><body></body></html>`;
    const load = () => void import('@hachej/boring-ui-kit/drawio-viewer').then(({ DRAWIO_VIEWER_SCRIPT }) => element.contentWindow?.postMessage({ viewer: DRAWIO_VIEWER_SCRIPT, xml: text }, '*'));
    element.addEventListener('load', load, { once: true });
    return () => element.removeEventListener('load', load);
  }, [text]);
  return <iframe ref={frame} data-testid="native-drawio" title="draw.io embed" sandbox="allow-scripts" className="h-[560px] w-full rounded-md border bg-background" />;
}

function Row({ name, native }: { readonly name: string; readonly native: ReactNode }) {
  return <section data-testid={`row-${name}`} className="grid grid-cols-1 gap-4 border-b p-4 lg:grid-cols-2">
    <div className="min-w-0"><h2 className="m-0 mb-2 text-sm font-medium">boring-ui drawing-viewer · {name}</h2>
      <div data-testid={`block-${name}`}>{kind.renderer({ text: fixtures[name]!, artifact: { title: name, target: { resource: { path: name } } } })}</div></div>
    <div className="min-w-0"><h2 className="m-0 mb-2 text-sm font-medium">Native · {name}</h2>{native}</div>
  </section>;
}

function App() {
  const only = params.get('only');
  const show = (name: string) => !only || only === name;
  return <main className="mx-auto max-w-[1440px]">
    <h1 className="m-0 p-4 text-lg font-semibold">Drawing viewer, fictional drawings</h1>
    {show('oakfield-garden.excalidraw') && <Row name="oakfield-garden.excalidraw" native={params.has('native') ? <NativeExcalidraw text={fixtures['oakfield-garden.excalidraw']!} /> : null} />}
    {show('bakery-morning.drawio') && <Row name="bakery-morning.drawio" native={params.has('native') ? <NativeDrawio text={fixtures['bakery-morning.drawio']!} /> : null} />}
    {!only && <section data-testid="row-plain" className="p-4"><h2 className="m-0 mb-2 text-sm font-medium">Plain (uncompressed) draw.io</h2>
      <DrawingViewer text={fixtures['bakery-morning-plain.drawio']!} path="bakery-morning-plain.drawio" onRead={drawing => { journey.read['bakery-morning-plain.drawio'] = drawing; }} /></section>}
    {!only && <section data-testid="row-broken" className="p-4"><h2 className="m-0 mb-2 text-sm font-medium">Unreadable file</h2>
      <DrawingViewer text={fixtures['broken.excalidraw']!} path="broken.excalidraw" /></section>}
    {!only && <section data-testid="row-unknown" className="p-4"><DrawingViewer text="just some words" /></section>}
    {/* The parse of each fixture through `onRead`, as an app takes it to describe the drawing to a model. */}
    <div hidden>{['oakfield-garden.excalidraw', 'bakery-morning.drawio'].filter(show).map(name =>
      <DrawingViewer key={name} text={fixtures[name]!} path={name} excalidrawAssets={assets} onRead={(drawing, { blocked }) => { journey.read[name] = drawing; journey.blocked[name] = blocked; }} />)}</div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
