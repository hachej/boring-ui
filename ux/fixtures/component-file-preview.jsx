import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FileViewer } from '../../registry/pi-app/file-viewer.tsx';
import { ArtifactPanel } from '../../registry/pi-app/artifact-panel.tsx';
import { defaultKinds } from '../../registry/pi-app-kinds/pi-app-kinds.ts';
import { AppShell } from '../../registry/app-shell/app-shell.tsx';
import { useAgentLayer } from '../../registry/app-shell/agent-layer.tsx';

// Component scenario `component:file-preview`: the kit's FileViewer (registry/pi-app/file-viewer.tsx) with the default kinds (pi-app-kinds), alone on a
// neutral page, over a fake in-memory resource client with invented English files. The page around it is the consumer's own: two buttons that
// open a file and an `onClose` that shuts the viewer. FileViewer draws a CSV as plain text; the kit's table for a CSV is the artifact kind, mounted here
// with ArtifactPanel (`open=table`). Query: dark=1, pace (ignored), open=note|csv|table|text (opens that file at first).
// `host=pane`: the same files, the same list, in AppShell composer="bar": a file opens in the shell's right pane (`agent.files`, LocalFileViewer),
// with the list as the set it steps through; a fake controller with an empty conversation stands in for the agent.
// `window.__ux`: closed (how many times onClose ran), open(name).
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
window.__closed = 0;

const FILES = {
  'closing-notes.md': ['text/markdown', '# Closing notes\n\nFile **Harbor Studio (fictional)**, fiscal year 2025.\n\n- Justify the two January gaps (Harbor Garage, The Cedar Diner).\n- Remind Brown & Sons about the invoice of Jan 21: $1,150.00.\n- Check the payroll tax refund of $312.00.\n\n## Next step\n\nSend the file to maya.collins@example.test before February 15.\n'],
  'discrepancies-january.csv': ['text/csv', 'Date,Label,Amount,Status\nJan 09,Card Harbor Garage,"$12.00",Needs a receipt\nJan 15,Card The Cedar Diner,"-$12.00",Needs a receipt\nJan 17,Payroll tax refund,"$312.00",Pending\nJan 21,Transfer Brown & Sons,"$1,150.00",Pending\n'],
  'reminder-delmore.txt': ['text/plain', 'Hello,\n\nInvoice 0112 from Delmore House ($1,368.00 incl. tax) is still open.\nCould you confirm the payment date?\n\nKind regards,\nHarbor Studio\n'],
};
const identity = { scopeId: 'file-preview', principalId: 'maya', initiatorId: 'maya' };
const locate = path => ({ resource: { providerId: 'fictional', path }, view: { kind: 'published' } });
const client = { read: async ({ target }) => {
  const file = FILES[target.resource.path];
  if (!file) return { kind: 'missing' };
  return { kind: 'available', snapshot: { ref: { ...target, revision: 'r1' }, mediaType: file[0], bytes: new TextEncoder().encode(file[1]) } };
} };
const kinds = defaultKinds({ locale: 'en' });
const SHORT = { note: 'closing-notes.md', csv: 'discrepancies-january.csv', table: 'table:discrepancies-january.csv', text: 'reminder-delmore.txt' };
const csvArtifact = path => ({ schema: 'boring.artifact', version: 1, title: path, type: 'code', language: 'csv', mediaType: 'text/csv', target: locate(path), revision: 'latest' });

function App() {
  const [path, setPath] = useState(SHORT[params.get('open')] ?? null);
  window.__ux = { closed: () => window.__closed, open: name => setPath(name) };
  return <main className="flex min-h-dvh items-center justify-center bg-muted/30 p-4 sm:p-8">
    <div data-testid="surface" className="flex h-[34rem] w-full max-w-3xl flex-col overflow-hidden rounded-xl border bg-background shadow-sm">
      {path?.startsWith('table:') ? <ArtifactPanel key={path} active={{ descriptor: csvArtifact(path.slice(6)), follow: false }} versions={[]} options={{ client, identity, kinds }} onSelect={() => {}} onClose={() => { window.__closed += 1; setPath(null); }} />
        : path ? <FileViewer key={path} path={path} locator={locate(path)} options={{ client, identity, kinds }} onClose={() => { window.__closed += 1; setPath(null); }} />
        : <div data-testid="file-list" className="flex flex-col gap-2 p-6 text-sm">
          <h1 className="m-0 text-base font-semibold">Files of Harbor Studio (fictional)</h1>
          {Object.keys(FILES).map(name => <button key={name} type="button" data-testid="open-file" data-name={name} className="h-11 rounded-md border px-3 text-left hover:bg-muted" onClick={() => setPath(name)}>{name}</button>)}
        </div>}
    </div>
  </main>;
}
const names = Object.keys(FILES);
const files = { read: async path => { const file = FILES[path]; if (!file) throw new Error('introuvable'); return new Blob([file[1]], { type: file[0] }); } };
let snapshot = { identity: { runtimeId: 'fictional', scopeId: 'file-preview', principalId: 'julie' }, conversationId: 'file-preview', connection: { kind: 'connected' },
  view: { entries: [], docs: {} }, draft: { text: '', attachments: [], version: 0 }, outbox: [], echo: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
const listeners = new Set();
const controller = { getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  setText: text => { snapshot = { ...snapshot, draft: { ...snapshot.draft, text, version: snapshot.draft.version + 1 } }; for (const listener of listeners) listener(); },
  setAttachments() {}, send: async () => undefined, connect: async () => {}, stop: async () => {}, dispose: async () => {}, clearHistory() {}, loadEarlier: async () => {}, reconcile: async () => {}, retrySameRequest: async () => {} };
function PanePage() {
  const layer = useAgentLayer();
  const open = name => layer.pane.push({ file: name, files: names });
  const first = SHORT[params.get('open')]?.replace(/^table:/, '');
  const depth = layer.pane.depth;
  useEffect(() => { if (first) open(first); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (depth === 0 && window.__wasOpen) window.__closed += 1; window.__wasOpen = depth > 0; }, [depth]);
  window.__ux = { closed: () => window.__closed, open: name => name ? open(name) : layer.pane.close() };
  return <div data-testid="file-list" className="flex flex-col gap-2 p-6 text-sm">
    <h1 className="m-0 text-base font-semibold">Pièces du dossier Atelier Brun</h1>
    {names.map(name => <button key={name} type="button" data-testid="open-file" data-name={name} className="h-11 rounded-md border px-3 text-left hover:bg-muted" onClick={() => open(name)}>{name}</button>)}
  </div>;
}
const nav = [{ id: 'pieces', label: 'Pièces', icon: ({ className }) => <svg className={className} width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="14" height="16" rx="2" fill="currentColor" /></svg>, render: () => <PanePage /> }];
const Pane = () => <AppShell layout="screen" locale="fr" title="Pièces (fictif)" sidebar={false} nav={nav} route={{ id: 'pieces', onChange() {} }} composer="bar"
  agent={{ controller, label: 'Assistant', files, chatProps: { title: 'Assistant', locale: 'fr' } }} />;
createRoot(document.getElementById('root')).render(params.get('host') === 'pane' ? <Pane /> : <App />);

