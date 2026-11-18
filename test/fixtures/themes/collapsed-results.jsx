import { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { AppShell } from '../../../registry/app-shell/app-shell.tsx';
import { FloatingComposer } from '../../../registry/app-shell/floating-composer.tsx';
import { ScreenBody } from '../../../registry/app-shell/screen-body.tsx';
import { useAgentLayer } from '../../../registry/app-shell/agent-layer.tsx';
import { FileTextIcon, FolderIcon } from '../../../registry/_shared/icons';
import { createDemoController } from '../../../ux/fixtures/demo-controller.mjs';
import script from './collapsed-results.json';

// Same page as float-composer.jsx over a script with one turn per kind of agent result (collapsed-results.json), for test/contracts/collapsed-results.test.mjs.
// The one composer floating over a page and folded to an icon, in the real AppShell (`?fr=1` French) or on a page with no shell (`?standalone=1`), over the demo's scripted agent (fictional).
// `window.__layer` is the layer's public api; `window.__say(text)` sends a message as the person ('approval' waits for a decision, 'answer' replies); `window.__clicks` counts the page's own button.
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
const fr = params.get('fr') === '1';
if (params.get('keep') !== '1') { try { for (const key of Object.keys(localStorage)) if (key.startsWith('boring-ui:sidebar-composer')) localStorage.removeItem(key); } catch { /* none */ } }
const { controller, actions } = createDemoController({ script, pace: 1 });
window.__say = text => controller.send('followUp', { text, attachments: [], restore: { text: '', attachments: [] } });
window.__clicks = 0;
window.__idle = () => !controller.getSnapshot().view.docs['pi.live'];
// The host pushes an AppShell notice (`window.__notify('error', 'text')`): the collapsed-composer tests check it stays visible.
window.__notify = (kind, text) => window.__setNotices?.(list => [{ id: `n${list.length + 1}`, kind, text }, ...list]);
const Probe = () => { const api = useAgentLayer(); useLayoutEffect(() => { window.__layer = api; }); return null; };
const Page = () => <div data-testid="page" className="flex min-h-0 flex-1 flex-col gap-3 p-4">
  <Probe />
  <h1 className="text-lg font-medium">Harbor file (fictional)</h1>
  <Button type="button" data-testid="page-button" variant="outline" className="self-start" onClick={() => { window.__clicks += 1; }}>Page action</Button>
  {Array.from({ length: 12 }, (_, index) => <p key={index} className="m-0 rounded-md border p-3">Entry {index + 1}</p>)}
</div>;
const agent = { controller, label: 'Assistant', chatProps: { actions } };
const nav = [{ id: 'one', label: 'Entries', icon: FileTextIcon, render: () => <ScreenBody><Page /></ScreenBody> }, { id: 'two', label: 'Files', icon: FolderIcon, render: () => <ScreenBody><p>Files</p></ScreenBody> }];
function Shell() { const [route, setRoute] = useState('one'); const [notices, setNotices] = useState([]); window.__setNotices = setNotices; return <AppShell layout="screen" title="Harbor" appId="harbor" locale={fr ? 'fr' : 'en'} nav={nav} route={{ id: route, onChange: setRoute }} composer="bar" notices={notices} agent={agent} floatingComposer={params.get('plain') !== '1'} account={{ name: 'Visitor', email: 'visitor@example.test', menu: [] }} />; }
// A site with no shell: its own page, and the composer floating over it.
function Site() {
  return <main className="min-h-dvh p-6"><h1 className="text-lg font-medium">Harbor Garage (fictional site)</h1>
    <Button type="button" data-testid="page-button" variant="outline" onClick={() => { window.__clicks += 1; }}>Page action</Button>
    {Array.from({ length: 20 }, (_, index) => <p key={index} className="m-0 mt-3 rounded-md border p-3">Paragraph {index + 1}</p>)}
    <FloatingComposer agent={agent} appId="harbor-site" locale={fr ? 'fr' : 'en'} start={params.get('start') === 'icon' ? 'icon' : 'float'} /></main>;
}
createRoot(document.getElementById('root')).render(params.get('standalone') === '1' ? <Site /> : <Shell />);
