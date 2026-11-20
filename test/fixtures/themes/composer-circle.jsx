import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPrivacyPolicy } from '@hachej/boring-feedback/page';
import { createFeedbackSession } from '@hachej/boring-feedback/ui';
import { AppShell } from '../../../registry/app-shell/app-shell.tsx';
import { FloatingComposer } from '../../../registry/app-shell/floating-composer.tsx';
import { ScreenBody } from '../../../registry/app-shell/screen-body.tsx';
import { FileTextIcon, FolderIcon } from '../../../registry/_shared/icons';
import { createDemoController } from '../../../ux/fixtures/demo-controller.mjs';
import script from '../../../ux/scenarios/scripts/design-system.json';

// `launcher: 'circle'` in the real components over a page of data (a fictional orders table). `?scene=support` (default): AppShell with a support circle, a panel and a full page of the conversation
// (the hand-off); `?scene=crowded`: a standalone page with two circles stacking on the bottom right, a drawer tab the circles step around and a toast that reads the published reserve; `?scene=feedback`:
// the support circle with the pointing tool. `?notice=1` adds the update notice row, `?dark=1` dark. `window.__say(text, which)` sends a message as the person ('answer' replies, 'approval' waits for a
// decision), `window.__opened` lists the conversation ids the hand-off gave the app, `window.__layer` is the layer's public api.
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
const scene = params.get('scene') ?? 'support';
const keep = params.get('keep') === '1';
if (!keep) { try { for (const key of Object.keys(localStorage)) if (key.startsWith('boring-ui:sidebar-')) localStorage.removeItem(key); } catch { /* none */ } }
const support = createDemoController({ script, pace: 1 });
const ideas = createDemoController({ script, pace: 1 });
const controllers = { support, ideas };
window.__say = (text, which = 'support') => controllers[which].controller.send('followUp', { text, attachments: [], restore: { text: '', attachments: [] } });
window.__opened = [];
const ROWS = [['Marlowe Bakery', '12 Nov', '€1,240', 'Paid'], ['Quay Studio', '13 Nov', '€380', 'Late'], ['Tern Logistics', '14 Nov', '€2,910', 'Paid'], ['Hollis & Daughters', '16 Nov', '€640', 'Late'], ['Alder Print', '17 Nov', '€95', 'Paid'], ['Fennel Cafe', '18 Nov', '€410', 'Paid']];
const Page = () => <div data-testid="page" data-feedback-visible="" className="flex min-h-0 flex-1 flex-col gap-3 p-4">
  <div className="flex items-center justify-between"><h1 className="m-0 text-lg font-medium">Orders</h1></div>
  <table data-testid="orders" className="w-full border-collapse text-left text-sm"><thead className="text-muted-foreground"><tr><th className="p-2">Customer</th><th className="p-2">Date</th><th className="p-2">Total</th><th className="p-2">Status</th></tr></thead>
    <tbody>{ROWS.map(row => <tr key={row[0]} className={row[3] === 'Late' ? 'bg-muted' : undefined}>{row.map((cell, index) => <td key={index} className="p-2">{cell}</td>)}</tr>)}</tbody></table>
</div>;
const session = scene === 'feedback' ? createFeedbackSession({ app: 'fictional-orders', build: 'dev-fixture', root: document.body, policy: createPrivacyPolicy({}), save: async () => ({ kind: 'saved', id: 'fb_7Q2mK9xRt4vW1cZp', revision: 'r1' }) }) : undefined;
window.__feedback = session;
const agentOf = (demo, label) => ({ controller: demo.controller, label, chatProps: { actions: demo.actions }, ...(session ? { feedback: session } : {}) });

function Support() {
  const [route, setRoute] = useState('orders');
  const nav = [{ id: 'orders', label: 'Orders', icon: FileTextIcon, render: () => <ScreenBody><Page /></ScreenBody> },
    { id: 'support', label: 'Support', icon: FolderIcon, render: () => <ScreenBody><p data-testid="support-page" className="m-0 p-4">The whole support conversation, on the app's own page.</p></ScreenBody> }];
  const notices = params.get('notice') === '1' ? [{ id: 'n', kind: 'info', text: 'A newer version is online.', action: { label: 'Reload', onSelect() {} } }] : [];
  return <AppShell layout="screen" title="Harbor" appId="harbor" nav={nav} route={{ id: route, onChange: setRoute }} notices={notices} agent={agentOf(support, 'Support')}
    composer={() => ({ id: 'support', launcher: 'circle', handoff: { openFull: id => { window.__opened.push(id); setRoute('support'); } }, suspended: route === 'support',
      ...(params.get('note') === '1' ? { note: signals => signals.unread ? 'New reply' : 'Support' } : {}) })}
    account={{ name: 'Visitor', email: 'visitor@example.test', menu: [] }} />;
}

function Crowded() {
  return <div className="min-h-dvh p-4">
    <Page />
    {/* The app's own drawer tab and toast: the circles step around the tab, and the toast lands above the stack by reading the published reserve. */}
    <div data-reserved="" data-testid="drawer-tab" style={{ position: 'fixed', right: 0, bottom: 24, width: 36, height: 150, zIndex: 45 }} className="flex items-center justify-center rounded-l-lg bg-muted text-xs text-muted-foreground shadow">Docs</div>
    <div data-testid="toast" style={{ position: 'fixed', insetInlineEnd: 56, bottom: 'calc(var(--composer-reserve-block, 0px) + 12px)', zIndex: 40 }} className="rounded-lg bg-foreground px-3 py-2 text-xs text-background shadow">Saved</div>
    <FloatingComposer agent={agentOf(support, 'Support')} composer={{ id: 'support', launcher: 'circle', avoid: ['[data-reserved]'], handoff: { openFull: id => window.__opened.push(id) } }} />
    <FloatingComposer agent={agentOf(ideas, 'Improve the app')} composer={{ id: 'pm', launcher: 'circle', avoid: ['[data-reserved]'], note: signals => signals.working ? 'Improve the app · thinking' : 'Improve the app' }} />
  </div>;
}

function Feedback() {
  return <div className="min-h-dvh p-4"><Page />
    <FloatingComposer agent={agentOf(support, 'Support')} composer={{ id: 'support', launcher: 'circle', handoff: { openFull: id => window.__opened.push(id) } }} />
  </div>;
}
createRoot(document.getElementById('root')).render(scene === 'crowded' ? <Crowded /> : scene === 'feedback' ? <Feedback /> : <Support />);
