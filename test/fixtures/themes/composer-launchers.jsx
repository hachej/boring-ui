import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPrivacyPolicy } from '@hachej/boring-feedback/page';
import { createFeedbackSession } from '@hachej/boring-feedback/ui';
import { AppShell } from '../../../registry/app-shell/app-shell.tsx';
import { FloatingComposer } from '../../../registry/app-shell/floating-composer.tsx';
import { FeedbackChip } from '../../../registry/feedback/feedback-session.tsx';
import { useAgentLayer } from '../../../registry/app-shell/agent-layer.tsx';
import { ScreenBody } from '../../../registry/app-shell/screen-body.tsx';
import { FileTextIcon, FolderIcon } from '../../../registry/_shared/icons';
import { createDemoController } from '../../../ux/fixtures/demo-controller.mjs';
import script from '../../../ux/scenarios/scripts/design-system.json';

// The composer config on every launcher, in the real components over a page of data (a fictional orders table). `?scene=`:
//  `level`    a floating bar (FloatingComposer) with `level` controlled by the page, `on.level`, `avoid` (a drawer tab) and `note`; buttons set the level; `window.__levels` lists what `on.level` heard;
//  `stack`    two launchers with ids on one corner (a floating bar and a circle) stacking, with the published reserve read by a toast;
//  `title`    the support circle with the app's own feedback slot in the panel's title row (`feedbackSlot` as a function);
//  `field`    a floating bar at the top right with the feedback slot in the composer's row, and the review chip (opens below a top anchor);
//  `nav`      AppShell with a circle where the Support screen says `composer: false` and the Reports screen gives its own bar.
// `?dark=1` dark. `window.__say(text)` sends a message as the person; `window.__feedback` is the session; `window.__slot` is the last context the slot was given; `window.__layer` the layer's public api.
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
const scene = params.get('scene') ?? 'level';
const keep = params.get('keep') === '1';
if (!keep) { try { for (const key of Object.keys(localStorage)) if (key.startsWith('boring-ui:sidebar-')) localStorage.removeItem(key); } catch { /* none */ } }
const main = createDemoController({ script, pace: 1 });
const second = createDemoController({ script, pace: 1 });
const controllers = { main, second };
window.__say = (text, which = 'main') => controllers[which].controller.send('followUp', { text, attachments: [], restore: { text: '', attachments: [] } });
window.__levels = [];
window.__opened = [];
const ROWS = [['Marlowe Bakery', '12 Nov', '€1,240', 'Paid'], ['Quay Studio', '13 Nov', '€380', 'Late'], ['Tern Logistics', '14 Nov', '€2,910', 'Paid'], ['Hollis & Daughters', '16 Nov', '€640', 'Late'], ['Alder Print', '17 Nov', '€95', 'Paid'], ['Fennel Cafe', '18 Nov', '€410', 'Paid']];
const Page = () => <div data-testid="page" data-feedback-visible="" className="flex min-h-0 flex-1 flex-col gap-3 p-4">
  <div className="flex items-center justify-between"><h1 className="m-0 text-lg font-medium">Orders</h1></div>
  <table data-testid="orders" className="w-full border-collapse text-left text-sm"><thead className="text-muted-foreground"><tr><th className="p-2">Customer</th><th className="p-2">Date</th><th className="p-2">Total</th><th className="p-2">Status</th></tr></thead>
    <tbody>{ROWS.map(row => <tr key={row[0]} className={row[3] === 'Late' ? 'bg-muted' : undefined}>{row.map((cell, index) => <td key={index} className="p-2">{cell}</td>)}</tr>)}</tbody></table>
</div>;
const session = scene === 'title' || scene === 'field' ? createFeedbackSession({ app: 'fictional-orders', build: 'dev-fixture', root: document.body, policy: createPrivacyPolicy({}), save: async () => ({ kind: 'saved', id: 'fb_7Q2mK9xRt4vW1cZp', revision: 'r1' }) }) : undefined;
window.__feedback = session;
window.__slot = null;
// The app's own control for the pointing tool: what it is given is on the DOM (`data-*`) and in `window.__slot`.
const slot = context => { window.__slotCtx = context; window.__slot = { level: context.level, phase: context.phase, count: context.count, where: context.where };
  return <>{context.phase === 'review' && <FeedbackChip session={window.__feedback} />}<button type="button" data-testid="app-feedback" data-where={context.where} data-level={context.level} data-phase={context.phase} data-count={context.count} aria-label="Show what is wrong"
    className="rounded-md border px-2 py-1 text-xs" onClick={() => context.annotate()}>{context.phase === 'active' ? `Done (${context.count})` : `Show (${context.count})`}</button></>; };
const agentOf = (demo, label, extra = {}) => ({ controller: demo.controller, label, chatProps: { actions: demo.actions }, ...(session ? { feedback: session, feedbackSlot: slot } : {}), ...extra });
const Probe = () => { window.__layer = useAgentLayer(); return null; };
const Tab = () => <div data-reserved="" data-testid="drawer-tab" style={{ position: 'fixed', right: 0, bottom: 24, width: 36, height: 150, zIndex: 45 }} className="flex items-center justify-center rounded-l-lg bg-muted text-xs text-muted-foreground shadow">Tab</div>;

function Level() {
  const [level, setLevel] = useState('folded');
  const [busy, setBusy] = useState(false);
  window.__setLevel = setLevel;
  return <div className="min-h-dvh p-4"><Page /><Tab />
    <div className="flex gap-2 px-4" data-testid="level-buttons">{['folded', 'open', 'grown', 'full'].map(one => <button key={one} type="button" data-testid={`level-${one}`} className="rounded-md border px-2 py-1 text-xs" onClick={() => setLevel(one)}>{one}</button>)}
      <button type="button" data-testid="busy" className="rounded-md border px-2 py-1 text-xs" onClick={() => setBusy(value => !value)}>work</button><span data-testid="level-readout">{level}</span></div>
    <FloatingComposer agent={agentOf(main, 'Assistant')} composer={{ id: 'main', launcher: 'bar', sizes: ['open', 'grown', 'full'], fold: 'circle', float: { movable: true }, level, on: { level: next => { window.__levels.push(next); setLevel(next); } },
      avoid: ['[data-reserved]'], at: { offset: { inline: 24, block: 20 } }, note: () => busy ? 'Assistant · thinking' : null }}><Probe /></FloatingComposer>
  </div>;
}

function Stack() {
  return <div className="min-h-dvh p-4"><Page />
    <div data-testid="toast" style={{ position: 'fixed', insetInlineEnd: 96, bottom: 'calc(var(--composer-reserve-block, 0px) + 12px)', zIndex: 40 }} className="rounded-lg bg-foreground px-3 py-2 text-xs text-background shadow">Saved</div>
    <FloatingComposer agent={agentOf(main, 'Assistant')} composer={{ id: 'main', launcher: 'bar', sizes: ['open', 'grown'], fold: 'circle', float: { movable: true }, at: { stack: 0 } }} />
    <FloatingComposer agent={agentOf(second, 'Improve the app')} composer={{ id: 'pm', launcher: 'circle', at: { stack: 1 }, note: () => 'Improve the app' }} />
  </div>;
}

function Title() {
  return <div className="min-h-dvh p-4"><Page />
    <FloatingComposer agent={agentOf(main, 'Support')} composer={{ id: 'support', launcher: 'circle', handoff: { openFull: id => window.__opened.push(id) } }}><Probe /></FloatingComposer></div>;
}

function Field() {
  return <div className="min-h-dvh p-4"><Page />
    <FloatingComposer agent={agentOf(main, 'Assistant')} composer={{ id: 'top', launcher: 'bar', sizes: ['open', 'grown'], fold: 'circle', float: { movable: true }, at: { place: params.get('corner') === 'bottom' ? 'bottom-end' : 'top-end' } }}><Probe /></FloatingComposer></div>;
}

function Nav() {
  const [route, setRoute] = useState('orders');
  const nav = [{ id: 'orders', label: 'Orders', icon: FileTextIcon, render: () => <ScreenBody><Page /></ScreenBody> },
    { id: 'support', label: 'Support', icon: FolderIcon, composer: false, render: () => <ScreenBody><p data-testid="support-page" className="m-0 p-4">The whole support conversation, on the app's own page.</p></ScreenBody> },
    { id: 'reports', label: 'Reports', icon: FileTextIcon, composer: { id: 'support', launcher: 'circle', at: { offset: { inline: 16, block: 160 } } }, render: () => <ScreenBody><p data-testid="reports-page" className="m-0 p-4">Reports (this screen moves the circle up).</p></ScreenBody> }];
  return <AppShell layout="screen" title="Harbor" appId="harbor" nav={nav} route={{ id: route, onChange: setRoute }} agent={agentOf(main, 'Help desk')} composer={{ id: 'support', launcher: 'circle', handoff: { openFull: id => { window.__opened.push(id); setRoute('support'); } } }}
    account={{ name: 'Visitor', email: 'visitor@example.test', menu: [] }} />;
}
createRoot(document.getElementById('root')).render(scene === 'stack' ? <Stack /> : scene === 'title' ? <Title /> : scene === 'field' ? <Field /> : scene === 'nav' ? <Nav /> : <Level />);
