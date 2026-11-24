import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { FloatingComposer } from '../../../registry/app-shell/floating-composer.tsx';
import { FLOATING_COMPOSER_PRESET } from '../../../registry/app-shell/composer-config.ts';
import { createDemoController } from '../../../ux/fixtures/demo-controller.mjs';
import script from '../../../ux/scenarios/scripts/design-system.json';

// `FloatingComposer` on a plain page, over the demo's scripted agent (fictional). The level is the host's (`composer.level` with `on.level`), unless `?uncontrolled=1`.
// `?level=` starts it; `?gap=1` adds a host class. `window.__changes` lists `on.level` calls; `window.__push(kind)` raises a notice the host built; `window.__set(level)` sets the controlled level.
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
try { for (const key of Object.keys(localStorage)) if (key.startsWith('boring-ui:sidebar-composer')) localStorage.removeItem(key); } catch { /* none */ }
const { controller, actions } = createDemoController({ script, pace: 1 });
window.__say = text => controller.send('followUp', { text, attachments: [], restore: { text: '', attachments: [] } });
window.__changes = [];
window.__clicks = 0;
const TONE = { done: 'success', input: 'warning', error: 'error' };
function App() {
  const [level, setLevel] = useState(params.get('level') ?? 'folded');
  const [notices, setNotices] = useState([]);
  window.__set = setLevel;
  window.__push = kind => setNotices(current => [{ id: `n${current.length}`, kind: TONE[kind], text: `Nightly export: ${kind === 'input' ? 'Which region?' : 'Done'}`,
    action: { label: 'Open', onSelect: () => { setLevel('open'); window.__changes.push('open'); setNotices(list => list.filter(item => item.kind === 'warning')); } },
    onDismiss: () => setNotices(list => list.filter(item => item.id !== `n${current.length}`)) }, ...current]);
  const agent = useMemo(() => ({ controller, label: 'Garage assistant', chatProps: { actions, labels: { title: 'Garage assistant' } } }), []);
  const composer = useMemo(() => ({ ...FLOATING_COMPOSER_PRESET, ...(params.get('uncontrolled') === '1' ? { defaultLevel: 'folded' } : { level, on: { level: next => { window.__changes.push(next); if (params.get('ignore') !== '1') setLevel(next); } } }) }), [level]);
  return <main className="min-h-dvh p-6"><h1 className="text-lg font-medium">Harbor Garage (fictional site)</h1>
    <Button type="button" data-testid="page-button" variant="outline" onClick={() => { window.__clicks += 1; }}>Page action</Button>
    {Array.from({ length: 20 }, (_, index) => <p key={index} className="m-0 mt-3 rounded-md border p-3">Paragraph {index + 1}</p>)}
    <FloatingComposer agent={agent} appId="harbor" person="visitor@example.test" composer={composer} notices={notices} {...(params.get('gap') === '1' ? { className: 'host-position' } : {})} />
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);
