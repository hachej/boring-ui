import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { AmbientChat, createNotificationStore } from '../../../registry/pi-ambient/ambient.tsx';
import { createDemoController } from '../../../ux/fixtures/demo-controller.mjs';
import script from '../../../ux/scenarios/scripts/design-system.json';

// `AmbientChat` with the props that used to keep the old window and now ride on the one composer: `className`, `storage`, the old drag position, `autoDismissMs`, `maxToasts`,
// `systemNotifications` (over a fake `Notification`), `renderComposer`, `composerLayout`, the model pill, and a controlled `state` the host ignores. Every option is a query parameter.
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
try {
  for (const key of Object.keys(localStorage)) if (key.startsWith('boring-ui:sidebar-composer')) localStorage.removeItem(key);
  if (params.get('keep') !== '1') for (const key of Object.keys(sessionStorage)) if (key.startsWith('boring-ui:sidebar-composer') || key === 'boring.ambient.position') sessionStorage.removeItem(key);
  if (params.get('legacy')) sessionStorage.setItem('boring.ambient.position', params.get('legacy'));
} catch { /* none */ }
const demo = createDemoController({ script, pace: 1 });
const { actions } = demo;
// `?model=1`: the agent's document says which model runs (what a real host's snapshot carries), so the pill has a name to show.
let lastBase, lastShown;
const controller = params.get('model') === '1' ? { ...demo.controller, getSnapshot: () => {
  const base = demo.controller.getSnapshot();
  if (base !== lastBase) { lastBase = base; lastShown = base.view ? { ...base, view: { ...base.view, docs: { ...base.view.docs, 'pi.agent': { model: { provider: 'openai', modelId: 'gpt-5-mini' } } } } } : base; }
  return lastShown;
} } : demo.controller;
window.__say = text => controller.send('followUp', { text, attachments: [], restore: { text: '', attachments: [] } });
window.__changes = [];
window.__clicks = 0;
window.__dismissed = [];
const store = createNotificationStore();
window.__push = (kind, title = 'Nightly export') => store.push({ kind, title, summary: kind === 'input' ? 'Which region?' : kind === 'error' ? 'It broke' : 'Done', conversationId: title });
// A fake browser Notification: permission starts `default`, a request grants it; shown ones are listed. `window.__hidden(true)` hides the page.
window.__system = [];
window.__asked = 0;
if (params.get('system') === '1') {
  let permission = 'default';
  window.Notification = class { constructor(title, options) { window.__system.push({ title, body: options?.body }); } static get permission() { return permission; } static requestPermission() { window.__asked += 1; permission = 'granted'; return Promise.resolve(permission); } };
}
window.__hidden = hidden => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
// What an app's stock shadcn input group does: any disabled control inside (an empty draft's Send) dims the whole field.
if (params.get('stock') === '1') document.head.append(Object.assign(document.createElement('style'), { textContent: '@layer utilities { [data-slot=input-group]:has(:disabled) { opacity: 0.5 } }' }));
// A host rule that moves the bar (what `className` is for).
document.head.append(Object.assign(document.createElement('style'), { textContent: '@layer utilities { .host-moved { bottom: 12rem !important; } }' }));
const model = { options: [{ provider: 'openai', modelId: 'gpt-5-mini', label: 'GPT-5 mini' }, { provider: 'openai', modelId: 'gpt-5-nano', label: 'GPT-5 nano' }], change: () => {} };
const effort = { options: ['minimal', 'low', 'medium', 'high'], change: () => {} };
function App() {
  const [state, setState] = useState(params.get('state') ?? undefined);
  window.__set = setState;
  const extra = {
    ...(params.get('class') ? { className: params.get('class') } : {}),
    ...(params.get('storage') ? { storage: params.get('storage') } : {}),
    ...(params.get('key') ? { storageKey: params.get('key') } : {}),
    ...(params.get('dismiss') ? { autoDismissMs: Number(params.get('dismiss')) } : {}),
    ...(params.get('max') ? { maxToasts: Number(params.get('max')) } : {}),
    ...(params.get('system') === '1' ? { systemNotifications: true } : {}),
    ...(params.get('layout') ? { composerLayout: params.get('layout') } : {}),
    ...(params.get('render') === '1' ? { renderComposer: props => <div data-testid="host-composer"><span data-testid="host-composer-layout">{String(props.layout)}</span></div> } : {}),
    ...(params.get('model') === '1' ? { model, effort } : {}),
  };
  return <main className="min-h-dvh p-6"><h1 className="text-lg font-medium">Harbor Garage (fictional site)</h1>
    <Button type="button" data-testid="page-button" variant="outline" onClick={() => { window.__clicks += 1; }}>Page action</Button>
    {Array.from({ length: 20 }, (_, index) => <p key={index} className="m-0 mt-3 rounded-md border p-3">Paragraph {index + 1}</p>)}
    <AmbientChat controller={controller} actions={actions} labels={{ title: 'Garage assistant' }} variant={params.get('surface') === '1' ? 'surface' : 'contrast'} notifications={store}
      {...(state ? { state } : {})} onStateChange={next => { window.__changes.push(next); if (params.get('ignore') !== '1') setState(next); }} {...extra} />
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);
