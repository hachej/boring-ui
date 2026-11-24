import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { FloatingComposer } from '../../../registry/app-shell/floating-composer.tsx';
import { createDemoController } from '../../../ux/fixtures/demo-controller.mjs';
import script from '../../../ux/scenarios/scripts/design-system.json';

// `FloatingComposer` options: `className`, `storage`, the old drag position (`legacyPositionKey`), `autoDismissMs`, `maxToasts`, `renderComposer`, `composerLayout`, the model pill
// and the working ring. Every option is a query parameter; `window.__push(kind, title)` raises a notice the host built.
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
try {
  if (params.get('keep') !== '1') for (const key of Object.keys(localStorage)) if (key.startsWith('boring-ui:sidebar-composer')) localStorage.removeItem(key);
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
window.__clicks = 0;
const TONE = { done: 'success', input: 'warning', error: 'error' };
let raise = () => {};
window.__push = (kind, title = 'Nightly export') => raise({ id: `${title}:${Math.random()}`, kind: TONE[kind], text: `${title}: ${kind === 'input' ? 'Which region?' : kind === 'error' ? 'It broke' : 'Done'}` });
window.__hidden = hidden => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
// What an app's stock shadcn input group does: any disabled control inside (an empty draft's Send) dims the whole field.
if (params.get('stock') === '1') document.head.append(Object.assign(document.createElement('style'), { textContent: '@layer utilities { [data-slot=input-group]:has(:disabled) { opacity: 0.5 } }' }));
// A host rule that moves the bar (what `className` is for).
document.head.append(Object.assign(document.createElement('style'), { textContent: '@layer utilities { .host-moved { bottom: 12rem !important; } }' }));
const model = { options: [{ provider: 'openai', modelId: 'gpt-5-mini', label: 'GPT-5 mini' }, { provider: 'openai', modelId: 'gpt-5-nano', label: 'GPT-5 nano' }], change: () => {} };
const effort = { options: ['minimal', 'low', 'medium', 'high'], change: () => {} };
function App() {
  const [notices, setNotices] = useState([]);
  raise = notice => setNotices(current => [{ ...notice, onDismiss: () => setNotices(list => list.filter(item => item.id !== notice.id)) }, ...current]);
  const extra = {
    ...(params.get('class') ? { className: params.get('class') } : {}),
    ...(params.get('storage') ? { storage: params.get('storage') } : {}),
    ...(params.get('dismiss') ? { autoDismissMs: Number(params.get('dismiss')) } : {}),
    ...(params.get('max') ? { maxToasts: Number(params.get('max')) } : {}),
  };
  const chatProps = useMemo(() => ({ actions, labels: { title: 'Garage assistant' },
    ...(params.get('layout') ? { composerLayout: params.get('layout') } : {}),
    ...(params.get('render') === '1' ? { renderComposer: props => <div data-testid="host-composer"><span data-testid="host-composer-layout">{String(props.layout)}</span></div> } : {}),
    ...(params.get('model') === '1' ? { model, effort } : {}) }), []);
  const agent = useMemo(() => ({ controller, label: 'Garage assistant', chatProps }), [chatProps]);
  return <main className="min-h-dvh p-6"><h1 className="text-lg font-medium">Harbor Garage (fictional site)</h1>
    <Button type="button" data-testid="page-button" variant="outline" onClick={() => { window.__clicks += 1; }}>Page action</Button>
    {Array.from({ length: 20 }, (_, index) => <p key={index} className="m-0 mt-3 rounded-md border p-3">Paragraph {index + 1}</p>)}
    <FloatingComposer agent={agent} appId={params.get('key') ?? 'harbor'} person="visitor@example.test" legacyPositionKey="boring.ambient.position" notices={notices} {...extra} />
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);
