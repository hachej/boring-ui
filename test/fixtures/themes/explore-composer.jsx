import { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '../../../registry/app-shell/app-shell.tsx';
import { ScreenBody } from '../../../registry/app-shell/screen-body.tsx';
import { useAgentLayer } from '../../../registry/app-shell/agent-layer.tsx';
import { FileTextIcon, FolderIcon } from '../../../registry/_shared/icons';
import { createDemoController } from '../../../ux/fixtures/demo-controller.mjs';
import script from '../../../ux/scenarios/scripts/design-system.json';

// `composer="explore"` in the real AppShell over a page of data (a fictional orders table), `?fr=1` French, `?context=0` without a context line, `?dark=1` dark. `window.__layer` is the layer's public api,
// `window.__say(text)` sends a message as the person ('answer' replies, 'approval' waits for a decision), `window.__clicks` counts the page's own button.
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
const fr = params.get('fr') === '1';
if (params.get('keep') !== '1') { try { for (const key of Object.keys(localStorage)) if (key.startsWith('boring-ui:sidebar-explore')) localStorage.removeItem(key); } catch { /* none */ } }
const { controller, actions } = createDemoController({ script, pace: 1 });
window.__say = text => controller.send('followUp', { text, attachments: [], restore: { text: '', attachments: [] } });
window.__clicks = 0;
const ROWS = [['Marlowe Bakery', '12 Nov', '€1,240', 'Paid'], ['Quay Studio', '13 Nov', '€380', 'Late'], ['Tern Logistics', '14 Nov', '€2,910', 'Paid'], ['Hollis & Daughters', '16 Nov', '€640', 'Late'], ['Alder Print', '17 Nov', '€95', 'Paid'], ['Fennel Cafe', '18 Nov', '€410', 'Paid']];
const Probe = () => { const api = useAgentLayer(); useLayoutEffect(() => { window.__layer = api; }); return null; };
const Page = () => <div data-testid="page" className="flex min-h-0 flex-1 flex-col gap-3 p-4">
  <Probe />
  <div className="flex items-center justify-between"><h1 className="m-0 text-lg font-medium">Orders</h1><button type="button" data-testid="page-button" className="rounded-lg border border-input px-2 py-1 text-xs" onClick={() => { window.__clicks += 1; }}>Last 30 days</button></div>
  <table data-testid="orders" className="w-full border-collapse text-left text-sm"><thead className="text-muted-foreground"><tr><th className="p-2">Customer</th><th className="p-2">Date</th><th className="p-2">Total</th><th className="p-2">Status</th></tr></thead>
    <tbody>{ROWS.map(row => <tr key={row[0]} className={row[3] === 'Late' ? 'bg-muted' : undefined}>{row.map((cell, index) => <td key={index} className="p-2">{cell}</td>)}</tr>)}</tbody></table>
</div>;
const agent = { controller, label: 'Assistant', chatProps: { actions, ...(fr ? { locale: 'fr' } : {}) } };
const nav = [{ id: 'one', label: 'Orders', icon: FileTextIcon, render: () => <ScreenBody><Page /></ScreenBody> }, { id: 'two', label: 'Customers', icon: FolderIcon, render: () => <ScreenBody><p>Customers</p></ScreenBody> }];
function Shell() {
  const [route, setRoute] = useState('one');
  const context = params.get('context') === '0' ? undefined : { title: fr ? 'Commandes, 30 derniers jours' : 'Orders, last 30 days', detail: fr ? '6 lignes' : '6 rows' };
  return <AppShell layout="screen" title="Harbor" appId="harbor" locale={fr ? 'fr' : 'en'} nav={nav} route={{ id: route, onChange: setRoute }} composer="explore" {...(context ? { context } : {})} agent={agent} account={{ name: 'Visitor', email: 'visitor@example.test', menu: [] }} />;
}
createRoot(document.getElementById('root')).render(<Shell />);
