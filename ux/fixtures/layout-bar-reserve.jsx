import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '../../registry/app-shell/app-shell.tsx';
import { ScreenBody } from '../../registry/app-shell/screen-body.tsx';
import { FileTextIcon, FolderIcon } from '../../registry/_shared/icons';
import { Button } from '@/components/ui/button';

// Layout scenario `layout:bar-reserve`: the real AppShell with `composer="bar"`, over a screen that is a long list of orders ending with one button.
// The shell keeps the assistant's bar from covering the end of the screen (`--agent-bar-reserve`): no per-screen padding here.
// Query: `dark=1`; `circle=1` the composer is a circle launcher (a support chat: `composer={{ launcher: 'circle' }}`), whose footprint the screen keeps free through `--composer-reserve-block`; `tabs=1` a second screen, so a phone shows its tab bar; `sticky=1` the screen has its own sticky bottom bar (`bottom: 0`: it sticks inside the screen's padding); `fab=1` a round button in the corner placed with `bottom: calc(var(--agent-bar-reserve) + 1rem)`;
// `rows=N` the number of orders (default 22). `window.__ux`: `reply()` the assistant answers (a card above the field), `tapped` how many times the last button ran.
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
window.__tapped = 0; window.__saved = 0; window.__helped = 0;

const assistant = text => ({ id: 3, kind: 'message', byTaskId: 7, model: [{ role: 'assistant', content: [{ type: 'text', text }], api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: 'stop', timestamp: 2 }] });
const asked = { id: 2, kind: 'message', model: [{ role: 'user', content: 'Which orders are late?', timestamp: 1 }] };
let snapshot = { identity: { runtimeId: 'fictional', scopeId: 'bar-reserve', principalId: 'fictional-reader' }, conversationId: 'bar-reserve', connection: { kind: 'connected' },
  view: { entries: [], docs: {} }, draft: { text: '', attachments: [], version: 0 }, outbox: [], echo: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
const listeners = new Set();
const change = patch => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); };
const controller = {
  getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  setText: text => change({ draft: { ...snapshot.draft, text, version: snapshot.draft.version + 1 } }),
  setAttachments: attachments => change({ draft: { ...snapshot.draft, attachments, version: snapshot.draft.version + 1 } }),
  send: async () => undefined, connect: async () => {}, stop: async () => {}, dispose: async () => {}, clearHistory() {}, loadEarlier: async () => {}, reconcile: async () => {}, retrySameRequest: async () => {},
};
const REPLY = 'Three orders are late: Delmore House, Axiom Insurance and Brown & Sons.\nI can remind each of them today.\nNothing else is waiting on you this week.';
// A reply that comes while the conversation is folded: the agent runs a moment (`pi.live`), then answers; the card shows the answer above the field.
window.__ux = { reply: () => {
  change({ view: { entries: [asked], docs: { 'pi.live': { run: { taskId: 7 } } } } });
  setTimeout(() => change({ view: { entries: [asked, assistant(REPLY)], docs: {} } }), 300);
} };

const ORDERS = ['Delmore House', 'Axiom Insurance', 'Brown & Sons', 'Rowan Partners', 'Northline Telecom', 'Larkin Stationery', 'Quay Fuel Station', 'Cedar Diner', 'Harbor Garage', 'Brook & Co', 'Market Street Rent'];
const rows = Math.max(5, Number(params.get('rows') ?? 22));

function Orders() {
  const [sent, setSent] = useState(false);
  return <ScreenBody>
    <h1 className="m-0 mb-3 text-lg font-semibold">Orders of the week (fictional)</h1>
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {Array.from({ length: rows }, (_, index) => <li key={index} data-testid="order-row" className="flex items-center justify-between rounded-md border p-3 text-sm"><span>{ORDERS[index % ORDERS.length]}</span><span className="tabular-nums">{`$${(index + 1) * 12}.00`}</span></li>)}
    </ul>
    <Button type="button" data-testid="last-control" className="mt-4 w-full" onClick={() => { window.__tapped += 1; setSent(true); }}>{sent ? 'Orders sent' : 'Send the week’s orders'}</Button>
    {params.get('sticky') === '1' && <div data-testid="sticky-bar" className="sticky bottom-0 mt-4 flex items-center justify-between gap-3 rounded-md border bg-card p-3 text-sm">
      <span>Unsaved changes</span><Button type="button" size="sm" data-testid="sticky-save" onClick={() => { window.__saved += 1; }}>Save</Button></div>}
    {params.get('fab') === '1' && <Button type="button" size="icon" data-testid="corner-button" aria-label="Help" style={{ bottom: 'calc(var(--agent-bar-reserve, 0px) + 1rem)' }} className="absolute right-4 z-10 rounded-full shadow-md" onClick={() => { window.__helped += 1; }}>?</Button>}
  </ScreenBody>;
}
const Other = () => <ScreenBody><h1 className="m-0 text-lg font-semibold">Documents (fictional)</h1></ScreenBody>;
const nav = [{ id: 'orders', label: 'Orders', icon: FileTextIcon, render: () => <Orders /> },
  ...(params.get('tabs') === '1' ? [{ id: 'documents', label: 'Documents', icon: FolderIcon, render: () => <Other /> }] : [])];
const agent = { controller, label: 'Assistant', chatProps: { title: 'Assistant', locale: 'en' } };
createRoot(document.getElementById('root')).render(<AppShell layout="screen" locale="en" title="Harbor Books (fictional)" nav={nav} route={{ id: 'orders', onChange() {} }} {...(params.get('circle') === '1' ? { composer: { launcher: 'circle', id: 'support' } } : { composer: 'bar' })} agent={agent} />);
