// The browser side of the accounts-payable demo (served by ./server.mjs).
//   [ sessions pane | chat ] [ right column ]
// The left `Dock` holds the sessions pane (conversations and the Library) beside the chat; dragging its divider narrow floats the chat as
// `AmbientChat` and the right column takes the whole width; docking it back restores all three. The right column shows one thing at a time:
// a screen of the app (Approvals, Invoice, Supplier: each a fixed experience over registered cells, ./cells.mjs) or a Library document.
// Every screen publishes `useAgentContext`; the chat reports its placement (docked or floating) by itself.
// @ts-nocheck: an example page, bundled by esbuild and not part of the typechecked sources.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Experience } from '@hachej/boring-ui-kit/experience';
import { FileTree } from '@hachej/boring-ui-kit/file-tree-view';
import { connectRevisionProvider } from '@hachej/boring-files/revision';
import { Dock, DockLayout, DockMain } from '../../registry/dock/dock.tsx';
import { PiChat } from '../../registry/pi-chat/pi-chat.tsx';
import { AmbientChat } from '../../registry/pi-ambient/ambient.tsx';
import { useRemoteChat } from '../../registry/pi-chat/use-remote-chat.ts';
import { SessionsPane } from '../../registry/pi-app/sessions.tsx';
import { useConversations } from '../../registry/pi-app/use-conversations.ts';
import { FileViewer } from '../../registry/pi-app/file-viewer.tsx';
import { PdfPane } from '../../registry/viewers/pdf-pane.tsx';
import { Button } from '../../registry/button/button.tsx';
import { AgentContextProvider, readAgentContext, useAgentContext } from '../../registry/app-shell/agent-context.ts';
import { ACTIONS, CELLS, SCREENS, experienceCells } from './cells.mjs';

const { token, identity, conversation: firstConversation } = window.__APP__;
const authorized = (request: Request) => { const headers = new Headers(request.headers); headers.set('authorization', `Bearer ${token}`); return fetch(new Request(request, { headers })); };
const at = (path: string) => new URL(path, location.href);
const money = (amount: number, currency = 'EUR') => new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount);
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// ---- The app's state and actions. Cells hold bindings (paths), never values: `resolve` turns a path into this viewer's data.
const Ap = createContext(null);
const useAp = () => useContext(Ap);

function ApProvider({ children, view, go }) {
  const [state, setState] = useState({ invoices: [], suppliers: {}, accounts: [], duplicates: {} });
  const [receipts, setReceipts] = useState({});
  const [seen, setSeen] = useState(0);
  const refresh = useCallback(async () => {
    const body = await (await authorized(new Request(at(`/api/ap/state?after=${seen}`)))).json();
    setState(body);
    const last = body.navigation.at(-1);
    if (last) { setSeen(last.seq); go(last.screen === 'approvals' ? { screen: 'approvals' } : { screen: last.screen, id: last.id }); }
  }, [seen, go]);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 400); return () => clearInterval(timer); }, [refresh]);
  const invoice = state.invoices.find(item => item.id === view.id);
  const supplier = state.suppliers[view.screen === 'supplier' ? view.id : invoice?.supplier];
  const named = item => ({ ...item, supplierName: state.suppliers[item.supplier]?.name });
  const resolve = path => ({
    '/ap/approvals': state.invoices.filter(item => item.status === 'pending' && item.week).map(named),
    '/ap/invoice': invoice && named(invoice),
    '/ap/invoice/duplicates': (state.duplicates[view.id] ?? []).map(id => state.invoices.find(item => item.id === id)).filter(Boolean),
    '/ap/supplier': supplier,
    '/ap/supplier/invoices': state.invoices.filter(item => item.supplier === supplier?.id && item.status !== 'approved').map(named),
    '/ap/supplier/duplicates': state.invoices.filter(item => item.supplier === supplier?.id && (state.duplicates[item.id] ?? []).length),
  })[path];
  // Named actions. The durable ones are the backend's (a conditional write with a receipt); the others only move the page.
  const act = useCallback(async (name, args) => {
    if (!ACTIONS[name].durable) return void go(name === 'open_invoice' ? { screen: 'invoice', id: args.id } : { screen: 'supplier', id: args.id });
    const response = await authorized(new Request(at(`/api/ap/actions/${name}`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) }));
    const result = await response.json();
    setReceipts(previous => ({ ...previous, [args.invoice]: result }));
    await refresh();
  }, [go, refresh]);
  return <Ap.Provider value={{ resolve, act, receipts, accounts: state.accounts, suppliers: state.suppliers }}>{children}</Ap.Provider>;
}

// ---- Cell renderers, one per kind. They read their bindings through `resolve` and act through named actions.
const card = 'rounded-lg border border-border bg-card p-4 text-card-foreground';
const label = 'text-xs font-medium uppercase tracking-wide text-muted-foreground';
const Badge = ({ tone = 'muted', children }) => <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone === 'warn' ? 'bg-destructive/10 text-destructive' : tone === 'ok' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>{children}</span>;

function ApprovalQueue({ cell }) {
  const { resolve, act } = useAp();
  const rows = resolve(cell.state.rows) ?? [];
  return <section data-testid="approval-queue" className={card} aria-label="Approval queue">
    <h2 className="mb-3 text-sm font-semibold">Waiting for your approval <span className="font-normal text-muted-foreground">({rows.length})</span></h2>
    {rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing is waiting.</p> : <ul className="divide-y divide-border">
      {rows.map(row => <li key={row.id}><button type="button" data-testid={`queue-row-${row.id}`} onClick={() => act('open_invoice', { id: row.id })} className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-muted/50">
        <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">{row.id}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{row.supplierName}</span>
        <span className="hidden shrink-0 text-muted-foreground sm:inline">due {day(row.due)}</span>
        <span className="w-24 shrink-0 text-right tabular-nums">{money(row.amount, row.currency)}</span>
      </button></li>)}
    </ul>}
  </section>;
}

function CashDue({ cell }) {
  const { resolve } = useAp();
  const rows = [...(resolve(cell.state.rows) ?? [])].sort((a, b) => a.due.localeCompare(b.due));
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return <section data-testid="cash-due" className={card} aria-label="Cash due">
    <h2 className="mb-1 text-sm font-semibold">Cash due</h2>
    <p className="mb-3 text-2xl font-semibold tabular-nums">{money(total)}</p>
    <ul className="space-y-1.5 text-sm">{rows.map(row => <li key={row.id} className="flex justify-between gap-3"><span className="text-muted-foreground">{day(row.due)}</span><span className="tabular-nums">{money(row.amount, row.currency)}</span></li>)}</ul>
  </section>;
}

function InvoiceSummary({ cell }) {
  const { resolve, act, receipts, accounts } = useAp();
  const invoice = resolve(cell.state.invoice);
  const [account, setAccount] = useState('');
  if (!invoice) return <p role="status" className={card}>Loading invoice…</p>;
  const receipt = receipts[invoice.id];
  const done = invoice.status !== 'pending';
  const decide = (action, extra = {}) => act(action, { invoice: invoice.id, expected: invoice.revision, ...extra });
  return <section data-testid="invoice-summary" data-invoice={invoice.id} className={card} aria-label={`Invoice ${invoice.id}`}>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold"><button type="button" data-testid="open-supplier" className="underline-offset-4 hover:underline" onClick={() => act('open_supplier', { id: invoice.supplier })}>{invoice.supplierName}</button></h2><p className="text-sm text-muted-foreground">{invoice.id} · {invoice.number} · {invoice.description}</p></div>
      <Badge tone={invoice.status === 'approved' ? 'ok' : invoice.status === 'on-hold' ? 'warn' : 'muted'}><span data-testid="invoice-status">{invoice.status}</span></Badge>
    </div>
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
      {[['Amount', money(invoice.amount, invoice.currency)], ['Invoice date', day(invoice.date)], ['Due', day(invoice.due)], ['PO', invoice.po]].map(([name, value]) => <div key={name}><dt className={label}>{name}</dt><dd className="font-medium tabular-nums">{value}</dd></div>)}
      <div><dt className={label}>Account</dt><dd data-testid="invoice-account" className="font-medium">{invoice.account}</dd></div>
    </dl>
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
      <Button size="sm" variant="default" data-testid="approve" disabled={done} onClick={() => decide('approve')}>Approve</Button>
      <select aria-label="Account for re-code" data-testid="recode-account" value={account} onChange={event => setAccount(event.target.value)} disabled={done} className="h-8 rounded-md border border-border bg-background px-2 text-sm">
        <option value="">Code to another account…</option>{accounts.filter(name => name !== invoice.account).map(name => <option key={name}>{name}</option>)}
      </select>
      <Button size="sm" variant="outline" data-testid="recode" disabled={done || !account} onClick={() => decide('recode', { account })}>Approve and re-code</Button>
      <Button size="sm" variant="ghost" data-testid="hold" disabled={done} onClick={() => decide('hold')}>Hold</Button>
    </div>
    {receipt && <p data-testid="receipt" className="mt-3 text-sm text-muted-foreground">{receipt.kind === 'committed' ? <>Saved. Receipt <code data-testid="receipt-id" className="rounded bg-muted px-1.5 py-0.5 text-xs">{receipt.receipt.operationId}</code></> : `Not saved: ${receipt.reason ?? receipt.kind}`}</p>}
  </section>;
}

function DuplicateAlert({ cell }) {
  const { resolve, act } = useAp();
  const matches = resolve(cell.state.matches) ?? [];
  if (!matches.length) return null;
  return <section data-testid="duplicate-alert" role="note" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4" aria-label="Possible duplicate">
    <h2 className="mb-1 text-sm font-semibold text-destructive">Possible duplicate</h2>
    <p className="text-sm">Same supplier, PO and amount as {matches.map((match, index) => <span key={match.id}>{index ? ', ' : ''}<button type="button" className="font-medium underline underline-offset-4" onClick={() => act('open_invoice', { id: match.id })}>{match.id}</button></span>)}.</p>
  </section>;
}

function InvoicePdf({ cell }) {
  const { resolve } = useAp();
  const invoice = resolve(cell.state.invoice);
  const [bytes, setBytes] = useState();
  useEffect(() => {
    setBytes(undefined);
    if (!invoice) return;
    let off = false;
    void authorized(new Request(at(`/api/ap/pdf/${invoice.id}`))).then(response => response.arrayBuffer()).then(buffer => { if (!off) setBytes(new Uint8Array(buffer)); });
    return () => { off = true; };
  }, [invoice?.id]);
  return <section data-testid="invoice-pdf" className="flex h-80 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border" aria-label="Invoice document">
    {bytes ? <PdfPane name={`${invoice.id}.pdf`} bytes={bytes} testId="invoice-pdf-viewer" /> : <p role="status" className="m-auto text-sm text-muted-foreground">Loading document…</p>}
  </section>;
}

function PolicyExcerpt({ cell }) {
  const { resolve } = useAp();
  const invoice = resolve(cell.state.invoice);
  if (!invoice) return null;
  return <section data-testid="policy-excerpt" className={`${card} min-w-0 flex-1 text-sm`} aria-label="Policy">
    <h2 className="mb-2 text-sm font-semibold">AP policy, in short</h2>
    <p className="mb-2 text-muted-foreground">{invoice.amount > 1000 ? 'Above 1,000 EUR: one approver, and the invoice number and PO must be new.' : 'Up to 1,000 EUR: one approver.'}</p>
    <p className="text-muted-foreground">Same supplier, PO and amount as an open invoice: held until the first is paid or rejected.</p>
  </section>;
}

function SupplierCard({ cell }) {
  const { resolve, act } = useAp();
  const supplier = resolve(cell.state.supplier), invoices = resolve(cell.state.invoices) ?? [];
  const openContract = useContext(OpenFile);
  if (!supplier) return <p role="status" className={card}>Loading supplier…</p>;
  return <section data-testid="supplier-card" className={card} aria-label={supplier.name}>
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{supplier.name}</h2><p className="text-sm text-muted-foreground">{supplier.country} · {supplier.terms} · {supplier.iban}</p></div>
      {supplier.flag && <Badge tone="warn">Flagged</Badge>}</div>
    {supplier.flag && <p data-testid="supplier-flag" className="mb-3 text-sm">{supplier.flag}</p>}
    <p className="mb-3 text-sm text-muted-foreground">Open balance <span className="font-medium text-foreground tabular-nums">{money(supplier.openBalance)}</span></p>
    <ul className="mb-3 space-y-1 text-sm">{invoices.map(invoice => <li key={invoice.id}><button type="button" className="underline-offset-4 hover:underline" onClick={() => act('open_invoice', { id: invoice.id })}>{invoice.id}</button> <span className="text-muted-foreground">{money(invoice.amount, invoice.currency)}</span></li>)}</ul>
    <Button size="sm" variant="outline" data-testid="open-contract" onClick={() => openContract(supplier.contract)}>Open contract</Button>
  </section>;
}

const RENDER = { 'ap/approval-queue': ApprovalQueue, 'ap/cash-due': CashDue, 'ap/invoice-summary': InvoiceSummary, 'ap/duplicate-alert': DuplicateAlert,
  'ap/invoice-pdf': InvoicePdf, 'ap/policy-excerpt': PolicyExcerpt, 'ap/supplier-card': SupplierCard };
const renderedCells = experienceCells.map(entry => { const cell = CELLS.find(item => item.ref === entry.ref), Component = RENDER[cell.kind]; return { ...entry, render: () => <Component cell={cell} /> }; });

// ---- The right column.
const OpenFile = createContext(() => {});
const SCREEN_NAMES = { approvals: 'Approvals', invoice: 'Invoice', supplier: 'Supplier' };

function Screen({ view }) {
  // What the person is looking at, for the agent: the screen and what it shows (an id, never record content).
  useAgentContext({ name: SCREEN_NAMES[view.screen], params: view.id ? { id: view.id } : {} });
  return <div data-testid={`screen-${view.screen}`} className="mx-auto w-full max-w-4xl"><Experience key={view.screen} descriptor={SCREENS[view.screen]} cells={renderedCells} canView={() => true} /></div>;
}

function Document({ view, provider, close }) {
  useAgentContext({ name: 'Library document', params: { path: view.path } });
  const options = useMemo(() => ({ client: provider, identity: provider.identity, history: provider.history }), [provider]);
  return <div data-testid="library-document" data-path={view.path} className="flex min-h-0 flex-1 flex-col [&>*]:min-h-0 [&>*]:flex-1">
    <FileViewer key={view.path} path={view.path} locator={provider.locate(view.path)} options={options} onClose={close} />
  </div>;
}

function Column({ view, go, provider }) {
  return <div data-testid="right-column" className="flex min-h-0 flex-1 flex-col bg-muted/30">
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-background px-4">
      <h1 className="mr-4 text-sm font-semibold">Harbor &amp; Pine · Accounts payable</h1>
      <Button size="sm" variant={view.screen === 'approvals' ? 'secondary' : 'ghost'} data-testid="nav-approvals" onClick={() => go({ screen: 'approvals' })}>Approvals</Button>
      <span data-testid="viewing" className="ml-auto truncate text-xs text-muted-foreground">{view.screen === 'file' ? view.path : `${SCREEN_NAMES[view.screen]}${view.id ? ` ${view.id}` : ''}`}</span>
    </header>
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4 sm:p-6">
      {view.screen === 'file' ? (provider ? <Document view={view} provider={provider} close={() => go({ screen: 'approvals' })} /> : null) : <Screen view={view} />}
    </div>
  </div>;
}

// ---- The left dock: the sessions pane (conversations, Library) beside the chat while docked; AmbientChat alone while floating.
const WIDE = 640;
function Chat({ api, provider, go, view }) {
  const [active, setActive] = useState(firstConversation);
  const [pane, setPane] = useState('conversations');
  const wide = useRef(760);
  const conversations = useConversations({ endpoint: at('/api/conversations'), fetch: authorized, activeId: active, onSelect: setActive });
  const chat = useRemoteChat({ conversationId: active, endpoint: id => at(`/api/chat?conversation=${id}`), fetch: authorized, identity, requestContext: readAgentContext });
  if (chat.status !== 'ready') return <p role="status" data-testid="chat-connecting" className="p-4 text-sm text-muted-foreground">{chat.status === 'offline' ? 'Server unreachable. Retrying…' : 'Connecting…'}</p>;
  // The sessions pane needs room: a narrow dock keeps only the chat. Docking back returns to the last width that had room for it.
  const sessions = api.width >= WIDE;
  if (!api.floating && sessions) wide.current = api.width;
  if (api.floating) return <AmbientChat controller={chat.controller} actions={chat.actions} variant="surface" defaultState="expanded" onDock={() => { api.dock(); api.setWidth(wide.current); }} />;
  return <div className="flex min-h-0 flex-1">
    {sessions && <SessionsPane drawer={false} conversations={conversations} view={pane} onViewChange={setPane}
      libraryContent={() => provider ? <FileTree revisionProvider={provider} upload={false} history={false} selectedPath={view.screen === 'file' ? view.path : undefined} onOpen={path => go({ screen: 'file', path })} /> : <p role="status" className="p-3 text-sm text-muted-foreground">Loading…</p>} />}
    <PiChat key={active} controller={chat.controller} actions={chat.actions} conversations={conversations} historyList={false} showHistory={false} labels={{ title: 'AP helper' }} className="min-h-0 min-w-0 flex-1" />
  </div>;
}

function App() {
  const [view, setView] = useState({ screen: 'approvals' });
  const [provider, setProvider] = useState();
  useEffect(() => { void connectRevisionProvider({ endpoint: at('/api/resources'), fetch: authorized }).then(setProvider); }, []);
  const go = useCallback(next => setView(next), []);
  return <AgentContextProvider>
    <ApProvider view={view} go={go}>
      <OpenFile.Provider value={path => go({ screen: 'file', path })}>
        <DockLayout storageKey="workspace-demo" className="h-full">
          <Dock id="chat" side="left" floatable dragBelow={260} narrowBelow={720} defaultWidth={760} minWidth={300} labels={{ region: 'Agent chat', resize: 'Resize chat' }}>
            {api => <Chat api={api} provider={provider} go={go} view={view} />}
          </Dock>
          <DockMain><Column view={view} go={go} provider={provider} /></DockMain>
        </DockLayout>
      </OpenFile.Provider>
    </ApProvider>
  </AgentContextProvider>;
}

createRoot(document.getElementById('root')).render(<App />);
