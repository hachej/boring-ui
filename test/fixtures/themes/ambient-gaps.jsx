import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { AmbientChat } from '../../../registry/pi-ambient/ambient.tsx';
import { BellIcon, DownloadIcon } from '../../../registry/_shared/icons.ts';
import { ViewerFrame, ViewerWindowProvider } from '../../../registry/viewer-frame/viewer-frame.tsx';
import { createDemoController } from '../../../ux/fixtures/demo-controller.mjs';
import script from '../../../ux/scenarios/scripts/design-system.json';

// `AmbientChat` with the window-content props the one composer now takes, over a fictional history that holds one finished reply and an artifact card (a plan).
// `?embedded=1` mounts it in a container; `?panel=1` gives `artifactPanel` (the artifact opens in the window); `?host=1` gives `artifacts` with `artifactTarget="host"`; `?actions=1` gives
// the header controls, Dock, Open in full chat and thumbs. `window.__log` lists what the host's callbacks received; `window.__panel` the panel's last api.
const params = new URLSearchParams(location.search);
try { for (const key of Object.keys(localStorage)) if (key.startsWith('boring-ui:sidebar-composer')) localStorage.removeItem(key); } catch { /* none */ }
const descriptor = { schema: 'boring.artifact', version: 1, id: 'plan', title: 'Launch plan', type: 'code', mediaType: 'text/plain', language: 'text',
  target: { resource: { providerId: 'fictional', path: 'plan.txt' }, view: { kind: 'published' } }, revision: 'r1' };
const entries = [{ id: 1, kind: 'message', model: [
  { role: 'user', content: 'Write the launch plan', timestamp: 1 },
  { role: 'assistant', content: [{ type: 'toolCall', id: 'p1', name: 'present', arguments: { path: 'plan.txt' } }], stopReason: 'toolUse' },
  { role: 'toolResult', toolCallId: 'p1', toolName: 'present', content: [{ type: 'text', text: JSON.stringify({ artifact: descriptor }) }] },
  { role: 'assistant', content: [{ type: 'text', text: 'The launch plan is ready: three steps, one owner each.' }], stopReason: 'stop', timestamp: 2 },
] }];
const { controller, actions } = createDemoController({ script, pace: 1, seed: { entries, docs: {} } });
window.__log = [];
window.__clicks = 0;

function Panel({ artifact, api }) {
  window.__panel = api;
  return <ViewerWindowProvider value={{ fullscreen: api.fullscreen, onFullscreenChange: api.onFullscreenChange }}>
    <div data-testid="host-panel" data-follow={api.follow ? 'true' : 'false'} data-sheet={api.sheet ? 'true' : 'false'} className="pi-chat flex h-full min-h-0 flex-col">
      <ViewerFrame title={artifact.title} testId="host-artifact" titleTestId="host-artifact-title" onClose={api.close}>
        <p className="m-0 p-4 text-sm">1. Draft the announcement. 2. Review it with legal. 3. Publish on Friday. (Fictional.)</p>
      </ViewerFrame>
    </div>
  </ViewerWindowProvider>;
}

function App() {
  const [state] = useState(params.get('state') ?? undefined);
  const extra = useMemo(() => ({
    ...(params.get('panel') === '1' ? { artifactPanel: (artifact, api) => <Panel artifact={artifact} api={api} /> } : {}),
    ...(params.get('host') === '1' ? { artifacts: { open: artifact => window.__log.push(`host-open:${artifact.title}`) }, artifactTarget: 'host' } : {}),
    ...(params.get('actions') === '1' ? {
      headerTools: <Button type="button" variant="ghost" size="icon" data-testid="host-tool" aria-label="Host tool" onClick={() => window.__log.push('tool')}><BellIcon aria-hidden="true" /></Button>,
      headerActions: [{ id: 'export', label: 'Export plan', icon: DownloadIcon, onSelect: () => window.__log.push('export') }, { id: 'archive', label: 'Archive chat', placement: 'menu', onSelect: () => window.__log.push('archive') }],
      onDock: () => window.__log.push('dock'), onOpenFull: id => window.__log.push(`full:${id}`), onFeedback: (reply, value) => window.__log.push(`feedback:${value}:${reply.text.slice(0, 15)}`),
    } : {}),
  }), []);
  const bar = <AmbientChat controller={controller} actions={actions} labels={{ title: 'Garage assistant' }} variant={params.get('surface') === '1' ? 'surface' : 'contrast'} notifications={false}
    {...(state ? { state } : {})} {...(params.get('fr') === '1' ? { locale: 'fr' } : {})} {...extra} {...(params.get('embedded') === '1' ? { embedded: true } : {})} />;
  return <main className="flex min-h-dvh flex-col p-6"><h1 className="text-lg font-medium">Harbor Garage (fictional site)</h1>
    <Button type="button" data-testid="page-button" variant="outline" onClick={() => { window.__clicks += 1; }}>Page action</Button>
    {params.get('embedded') === '1'
      ? <div data-testid="embed-host" className="mt-4 flex h-[28rem] w-full max-w-xl min-w-0 flex-col overflow-hidden rounded-lg border">{bar}</div>
      : <>{Array.from({ length: 12 }, (_, index) => <p key={index} className="m-0 mt-3 rounded-md border p-3">Paragraph {index + 1}</p>)}{bar}</>}
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);
