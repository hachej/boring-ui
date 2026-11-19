import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { AmbientChat, createNotificationStore } from '../../../registry/pi-ambient/ambient.tsx';
import { createDemoController } from '../../../ux/fixtures/demo-controller.mjs';
import script from '../../../ux/scenarios/scripts/design-system.json';

// `AmbientChat` with props the one composer takes: it is the floating composer on a plain page, over the demo's scripted agent (fictional).
// `?state=` controls the window state, `?gap=1` adds a prop the composer does not take (the old window), `?surface=1` is `variant="surface"`.
// `window.__changes` lists `onStateChange` calls; `window.__push(kind)` raises a background notification; `window.__set(state)` sets the controlled state.
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
try { for (const key of Object.keys(localStorage)) if (key.startsWith('boring-ui:sidebar-composer')) localStorage.removeItem(key); } catch { /* none */ }
const { controller, actions } = createDemoController({ script, pace: 1 });
window.__say = text => controller.send('followUp', { text, attachments: [], restore: { text: '', attachments: [] } });
window.__changes = [];
window.__clicks = 0;
const store = createNotificationStore();
window.__push = kind => store.push({ kind, title: 'Nightly export', summary: kind === 'input' ? 'Which region?' : 'Done', conversationId: 'other' });
function App() {
  const [state, setState] = useState(params.get('state') ?? undefined);
  window.__set = setState;
  const extra = useMemo(() => params.get('gap') === '1' ? { onOpenFull: () => {} } : {}, []);
  return <main className="min-h-dvh p-6"><h1 className="text-lg font-medium">Harbor Garage (fictional site)</h1>
    <Button type="button" data-testid="page-button" variant="outline" onClick={() => { window.__clicks += 1; }}>Page action</Button>
    {Array.from({ length: 20 }, (_, index) => <p key={index} className="m-0 mt-3 rounded-md border p-3">Paragraph {index + 1}</p>)}
    <AmbientChat controller={controller} actions={actions} labels={{ title: 'Garage assistant' }} variant={params.get('surface') === '1' ? 'surface' : 'contrast'} notifications={store}
      {...(state ? { state } : {})} onStateChange={next => { window.__changes.push(next); if (params.get('uncontrolled') !== '1') setState(next); }} {...extra} />
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);
