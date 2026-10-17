// One ArtifactWorkspace holds the conversation and its file column in every Dock placement.
// The host owns navigation and its fixed cell-based screens. Pi owns execution.
// @ts-nocheck: an example page, bundled by esbuild and not part of the typechecked sources.
import { Component, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MaximizeIcon, PanelLeftIcon } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import { Experience } from '@hachej/boring-ui-kit/experience';
import { connectRevisionProvider } from '@hachej/boring-files/revision';
import { Dock, DockLayout, DockMain, useDock } from '../../registry/dock/dock.tsx';
import { ArtifactWorkspace } from '../../registry/pi-workspace/workspace.tsx';
import { AmbientChat } from '../../registry/pi-ambient/ambient.tsx';
import { useRemoteChat } from '../../registry/pi-chat/use-remote-chat.ts';
import { VoiceInput } from '../../registry/feedback/voice-input.tsx';
import { useRevisionAttachments } from '../../registry/pi-app/use-revision-attachments.ts';
import { useConversations } from '../../registry/pi-app/use-conversations.ts';
import { FileViewer } from '../../registry/pi-app/file-viewer.tsx';
import { BlockActions } from '../../registry/button/actions.tsx';
import { PdfPane } from '../../registry/viewers/pdf-pane.tsx';
import { Button, NavigationMenuIcon } from '../../registry/button/button.tsx';
import { cn } from '../../registry/utils/utils.ts';
import { AgentContextProvider, readAgentContext, useAgentContext } from '../../registry/app-shell/agent-context.ts';
import { ACTIONS, CELLS, SCREENS, experienceCells } from './cells.mjs';
import { validWorkspacePath } from './paths.mjs';
import { FinanceCell, Mark, Status, Transactions } from './finance';
import { WorkspaceNav, SiteHeader } from './navigation';
import { ChatTools } from './chat-tools';
import { SCREEN_NAMES } from './screen-names.mjs';
import { SidebarProvider, SidebarInset, useSidebar } from '../../examples/app-shell/components/ui/sidebar';

const { token, identity, conversation: firstConversation, voice } = window.__APP__;
const authorized = (request: Request) => { const headers = new Headers(request.headers); headers.set('authorization', `Bearer ${token}`); return fetch(new Request(request, { headers })); };
const at = (path: string) => new URL(path, location.href);
const money = (amount: number, currency = 'EUR') => new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount);
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// ---- The app's state and actions. Cells hold bindings (paths), never values: `resolve` turns a path into this viewer's data.
const Ap = createContext(null);
const useAp = () => useContext(Ap);

const TAB = Math.random().toString(36).slice(2); // this tab: agent commands are addressed to it

function ApProvider({ children, view, go, conversation }) {
  const [state, setState] = useState({ invoices: [], suppliers: {}, accounts: [], budgets: [], duplicates: {} });
  const [receipts, setReceipts] = useState({});
  const seen = useRef(0), skip = useRef(true), current = useRef(conversation);
  current.current = conversation;
  // Switching conversation drops whatever the old one had pending: a late command never moves this conversation's viewer.
  useEffect(() => { skip.current = true; }, [conversation]);
  const refresh = useCallback(async () => {
    const asked = conversation;
    const body = await (await authorized(new Request(at(`/api/ap/state?after=${seen.current}&conversation=${asked}&tab=${TAB}`)))).json();
    setState(body);
    if (current.current !== asked) return;
    if (skip.current) { skip.current = false; seen.current = body.latest; return; }
    const last = body.navigation.at(-1);
    if (last) { seen.current = last.seq; go(last.screen === 'file' ? { screen: 'file', path: last.path } : { screen: last.screen, id: last.id }, true); }
  }, [conversation, go]);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 400); return () => clearInterval(timer); }, [refresh]);
  const invoice = state.invoices.find(item => item.id === view.id);
  const supplier = state.suppliers[view.screen === 'supplier' ? view.id : invoice?.supplier];
  const named = item => ({ ...item, supplierName: state.suppliers[item.supplier]?.name });
  const resolve = path => ({
    '/ap/invoices': state.invoices.map(named),
    '/ap/suppliers': state.suppliers,
    '/ap/budgets': state.budgets,
    '/ap/approvals': state.invoices.filter(item => item.status === 'pending' && item.week).map(named),
    '/ap/invoice': invoice && named(invoice),
    '/ap/invoice/duplicates': (state.duplicates[view.id] ?? []).map(id => state.invoices.find(item => item.id === id)).filter(Boolean),
    '/ap/supplier': supplier && { ...supplier, openBalance: state.invoices.filter(item => item.supplier === supplier.id && item.status !== 'approved').reduce((sum, item) => sum + item.amount, 0) },
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
  return <Ap.Provider value={{ resolve, act, receipts, accounts: state.accounts, suppliers: state.suppliers, approvalCount: state.invoices.filter(item => item.status === 'pending' && item.week).length }}>{children}</Ap.Provider>;
}

// ---- Cell renderers, one per kind. They read their bindings through `resolve` and act through named actions.
const card = 'border-y border-border bg-background py-5 text-foreground';
const label = 'text-xs font-medium text-muted-foreground';
const Badge = ({ tone = 'muted', children }) => <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone === 'warn' ? 'bg-destructive/10 text-destructive' : tone === 'ok' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>{children}</span>;

function ApprovalQueue({ cell }) {
  const { resolve, act } = useAp();
  const rows = resolve(cell.state.rows) ?? [];
  return <Transactions rows={rows} act={act} approvals />;
}

function CashDue({ cell }) {
  const { resolve } = useAp();
  const rows = [...(resolve(cell.state.rows) ?? [])].sort((a, b) => a.due.localeCompare(b.due));
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return <section data-testid="cash-due" className={`${card} @container`} aria-label="Cash due">
    <div className="mb-5 flex items-baseline justify-between gap-4"><h2 className="text-sm font-semibold">Upcoming due dates</h2><p className="text-sm font-semibold tabular-nums">{money(total)} <span className="text-xs font-normal text-muted-foreground">total due</span></p></div>
    <ul className="grid gap-x-8 gap-y-3 text-sm @[38rem]:grid-cols-3">{rows.map(row => <li key={row.id} className="flex items-center justify-between gap-3 border-b border-border pb-3"><span><span className="block text-xs text-muted-foreground">{row.id}</span><span className="text-sm">{day(row.due)}</span></span><span className="text-sm font-medium tabular-nums">{money(row.amount, row.currency)}</span></li>)}</ul>
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
  return <section data-testid="invoice-summary" data-invoice={invoice.id} className={`${card} @container`} aria-label={`Invoice ${invoice.id}`}>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-center gap-3"><Mark name={invoice.supplierName} /><div><h2 className="text-base font-semibold"><button type="button" data-testid="open-supplier" className="inline-flex min-h-8 items-center underline-offset-4 hover:underline max-sm:min-h-11 pointer-coarse:min-h-11" onClick={() => act('open_supplier', { id: invoice.supplier })}>{invoice.supplierName}</button></h2><p className="text-sm text-muted-foreground">{invoice.id} · {invoice.number} · {invoice.description}</p></div></div>
      <div><Status value={invoice.status} /><span data-testid="invoice-status" className="sr-only">{invoice.status}</span></div>
    </div>
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 @[36rem]:grid-cols-4 [&_dd]:m-0">
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
    <p className="text-sm">Same supplier, PO and amount as {matches.map((match, index) => <span key={match.id}>{index ? ', ' : ''}<button type="button" className="inline-flex min-h-8 items-center font-medium underline underline-offset-4 max-sm:min-h-11 pointer-coarse:min-h-11" onClick={() => act('open_invoice', { id: match.id })}>{match.id}</button></span>)}.</p>
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
  return <section data-testid="invoice-pdf" className="flex h-[28rem] min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border" aria-label="Invoice document">
    {bytes ? <PdfPane name={`${invoice.id}.pdf`} bytes={bytes} testId="invoice-pdf-viewer" /> : <p role="status" className="m-auto text-sm text-muted-foreground">Loading document…</p>}
  </section>;
}

function PolicyExcerpt({ cell }) {
  const { resolve } = useAp();
  const invoice = resolve(cell.state.invoice);
  if (!invoice) return null;
  return <section data-testid="policy-excerpt" className="min-w-0 flex-1 rounded-lg border border-border bg-muted/20 p-5 text-sm" aria-label="Policy">
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

function Finance({ cell }) {
  const { resolve, act } = useAp();
  return <FinanceCell kind={cell.kind} rows={resolve(cell.state.rows) ?? []} suppliers={resolve(cell.state.suppliers) ?? {}} budgets={resolve(cell.state.budgets) ?? []} act={act} />;
}
const RENDER = { ...Object.fromEntries(['ap/kpis', 'ap/transactions', 'ap/suppliers', 'ap/budgets', 'ap/goals', 'ap/payments'].map(kind => [kind, Finance])), 'ap/approval-queue': ApprovalQueue, 'ap/cash-due': CashDue, 'ap/invoice-summary': InvoiceSummary, 'ap/duplicate-alert': DuplicateAlert,
  'ap/invoice-pdf': InvoicePdf, 'ap/policy-excerpt': PolicyExcerpt, 'ap/supplier-card': SupplierCard };
const renderedCells = experienceCells.map(entry => { const cell = CELLS.find(item => item.ref === entry.ref), Component = RENDER[cell.kind]; return { ...entry, render: () => <Component cell={cell} /> }; });

// ---- The right column.
const OpenFile = createContext(() => {});

function Screen({ view }) {
  // What the person is looking at, for the agent: the screen and what it shows (an id, never record content).
  useAgentContext({ name: SCREEN_NAMES[view.screen], params: view.id ? { id: view.id } : {} });
  return <div data-testid={`screen-${view.screen}`} className="mx-auto w-full max-w-7xl"><Experience key={view.screen} descriptor={SCREENS[view.screen]} cells={renderedCells} canView={() => true} /></div>;
}

/** A viewer that cannot render (a path the workspace refuses, a failed read) shows its error inline, with a way back, never a blank page. */
class ViewerBoundary extends Component {
  state = { error: undefined };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <div role="alert" data-testid="viewer-error" className="flex min-h-0 flex-1 flex-col items-start gap-3 p-4 text-sm">
      <p className="m-0 font-medium">This file cannot be shown.</p>
      <p className="m-0 text-muted-foreground">{String(this.state.error?.message ?? this.state.error)}</p>
      <Button size="sm" variant="outline" data-testid="viewer-error-close" onClick={this.props.onClose}>Close</Button>
    </div>;
  }
}

/** The agent's file viewer: one flat frame (a single header with the name, path, mode toggle and close) over the editor. `onBack` returns to the chat where the file replaces it. */
function Document({ path, provider, close, onBack, onUnsaved, setBeforeLeave }) {
  useAgentContext({ name: 'Library document', params: { path } });
  const options = useMemo(() => ({ client: provider, identity: provider.identity, history: provider.history }), [provider]);
  return <div data-testid="library-document" data-path={path} role="region" aria-label={`File ${path}`} tabIndex={-1} className="flex min-h-0 min-w-0 flex-1 flex-col outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&>*]:min-h-0 [&>*]:flex-1">
    <ViewerBoundary key={path} onClose={close}>
      <FileViewer path={path} locator={provider.locate(path)} options={options} onClose={close} {...(onBack ? { onBack, backLabel: 'Chat' } : {})} onUnsavedChange={onUnsaved} onBeforeLeaveChange={setBeforeLeave} />
    </ViewerBoundary>
  </div>;
}

/**
 * While the chat floats, a file replaces the chat in a floating window at the same corner (the chat's remembered position). The window is
 * clamped to the viewport on every resize: its top and left edges can never leave the screen, so the header with the back and close buttons
 * is always reachable. Only the content below the pinned header scrolls.
 */
function FloatingViewer({ children, header, active }) {
  const MARGIN = 8;
  const measure = () => ({ w: window.innerWidth, h: window.innerHeight });
  const [viewport, setViewport] = useState(measure);
  useEffect(() => { const on = () => setViewport(measure()); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  const phone = viewport.w < 640;
  const width = Math.min(704, viewport.w - 2 * MARGIN), height = Math.min(736, viewport.h - 2 * MARGIN);
  const stored = (() => { try { const value = JSON.parse(sessionStorage.getItem('boring.ambient.position') ?? 'null'); return typeof value?.right === 'number' && typeof value?.bottom === 'number' ? value : { right: 16, bottom: 16 }; } catch { return { right: 16, bottom: 16 }; } })();
  const clamp = (value: number, max: number) => Math.max(MARGIN, Math.min(value, max));
  const style = phone ? undefined : { width, height, right: clamp(stored.right, viewport.w - width - MARGIN), bottom: clamp(stored.bottom, viewport.h - height - MARGIN) };
  return <div data-testid={active ? 'floating-viewer' : 'agent-workspace'} role={active ? 'region' : undefined} aria-label={active ? 'File viewer' : undefined} style={active ? style : undefined}
    className={active ? cn('pi-chat fixed z-50 flex flex-col overflow-hidden border border-border bg-muted text-foreground shadow-lg', phone ? 'inset-0 h-dvh rounded-none border-0 p-0' : 'rounded-3xl p-2') : 'flex min-h-0 min-w-0 flex-1 flex-col'}>
    {header}
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden [&>*]:min-h-0 [&>*]:flex-1">{children}</div>
  </div>;
}

/** The app column: its own chrome (title, navigation) and its own screens. No documents here. */
function Column({ view }) {
  return <div data-testid="right-column" className="flex min-h-0 flex-1 flex-col bg-background">
    <div data-testid="app-scroll" className="min-h-0 flex-1 overflow-auto px-4 pb-28 pt-7 sm:px-6 lg:px-8"><div className="mx-auto mb-7 flex w-full max-w-7xl shrink-0 items-start justify-between gap-4"><div><h1 className="text-xl font-semibold tracking-tight">{SCREEN_NAMES[view.screen]}</h1><p className="mt-1.5 max-w-prose text-sm text-muted-foreground">{({ dashboard: 'An overview of your March payables.', approvals: 'Review the invoices that need a decision this week.', invoices: 'Track and review every supplier invoice.', suppliers: 'Supplier details, terms and open balances.', spend: 'Expense accounts and team savings targets.', payments: 'Approved and ready for your next payment run. No payments are sent.', invoice: 'Check the source document and coding before approval.', supplier: 'Terms, documents and outstanding invoices.' })[view.screen]}</p></div><span data-testid="viewing" className="sr-only">{`${SCREEN_NAMES[view.screen]}${view.id ? ` ${view.id}` : ''}`}</span></div><Screen view={view} /></div>
  </div>;
}

// The same chat and file column stay mounted in every Dock placement.
const PANEL = 560; // the file viewer's width beside the chat
const transcribe = async (audio: Blob, signal: AbortSignal) => (await (await authorized(new Request(at('/api/transcribe'), { method: 'POST', headers: { 'content-type': audio.type || 'audio/webm' }, body: audio, signal }))).json()).text ?? '';

function Chat({ api, provider, file, openFile, closeFile, setUnsaved, setBeforeLeave, active, conversations, feed }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const base = useRef(620), widened = useRef(false);
  const chat = useRemoteChat({ conversationId: active, endpoint: id => at(`/api/chat?conversation=${id}`), fetch: authorized, identity, requestContext: () => ({ ...readAgentContext(), tab: TAB }) });
  // The files the person attaches (and a long paste) are saved in the workspace, under uploads/, through the same provider as the Library.
  const attachments = useRevisionAttachments({ revisionProvider: provider });
  // The agent area widens by the viewer's width while a file is open beside the chat, and goes back when it closes.
  if (api.placement === 'docked' && !file && !widened.current) base.current = api.width;
  const side = api.placement === 'docked' && Boolean(file);
  const replaceChat = Boolean(file) && (api.floating || isMobile);
  useEffect(() => {
    if (side && !widened.current) { widened.current = true; api.setWidth(Math.min(base.current + PANEL, Math.max(base.current, Math.round(window.innerWidth * 0.62)))); }
    else if (!side && widened.current) { widened.current = false; if (!api.floating) api.setWidth(base.current); }
  }, [side]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (chat.status !== 'ready' || file) return;
    const composer = document.querySelector<HTMLTextAreaElement>('[data-dock=chat] [data-testid=composer-input]');
    if (composer?.checkVisibility()) composer.focus({ preventScroll: true });
  }, [api.placement, file, chat.status]);
  if (chat.status !== 'ready') return <p role="status" data-testid="chat-connecting" className="p-4 text-sm text-muted-foreground">{chat.status === 'offline' ? 'Server unreachable. Retrying…' : 'Connecting…'}</p>;
  const headerActions = [
    { id: 'navigation', label: 'Open navigation', icon: NavigationMenuIcon, onSelect: () => setOpenMobile(true) },
    { id: 'page', label: 'Agent as page', icon: MaximizeIcon, onSelect: () => api.setPlacement('page') },
  ];
  const placementActions = api.placement === 'page' ? [
    ...headerActions.filter(action => action.id === 'navigation'),
    { id: 'dock', label: 'Dock beside app', icon: PanelLeftIcon, onSelect: api.dock },
  ] : headerActions;
  const barTools = <ChatTools conversations={conversations} provider={provider} file={file} openFile={openFile} feed={feed} />;
  const tools = voice ? <VoiceInput controller={chat.controller} transcribe={transcribe} /> : undefined;
  const common = { controller: chat.controller, actions: chat.actions, headerActions, className: '[&_[data-action=navigation]]:md:hidden', tools, ...(attachments ? { attachments, pasteToFile: {} } : {}), onOpenFile: openFile, fileChanges: true };
  const viewer = file && provider ? <Document path={file} provider={provider} close={closeFile} onBack={replaceChat ? closeFile : undefined} onUnsaved={setUnsaved} setBeforeLeave={setBeforeLeave} /> : null;
  const header = <div data-testid="agent-panel-header" className="pi-chat flex h-14 shrink-0 items-center gap-0.5 px-3 text-foreground [&_button]:min-h-11 [&_button]:min-w-11">
    <h2 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">AP helper</h2>
    {barTools}<BlockActions actions={placementActions} testId="chat-action" menuLabel="More actions" className="[&_[data-action=navigation]]:md:hidden" />
  </div>;
  const conversation = <div hidden={replaceChat} inert={replaceChat} className={cn('min-h-0 flex-1 flex-col', replaceChat ? 'hidden' : 'flex')}>
    <AmbientChat key={active} {...common} headerTools={api.floating ? barTools : undefined} embedded={!api.floating} variant="surface" defaultState="expanded" labels={{ title: 'AP helper', placeholder: 'Ask about your payables…', empty: 'Review an invoice, check the policy, or ask what needs your approval.' }} onDock={() => { api.dock(); api.setWidth(base.current); }} />
  </div>;
  return <FloatingViewer active={replaceChat} header={!api.floating && !replaceChat ? header : null}>
    <ArtifactWorkspace chat={conversation} open={Boolean(file)} panel={viewer} onClose={closeFile} sheetBelow={0} minPanel={replaceChat ? 0 : 360} minChat={replaceChat ? 0 : 360} defaultWidth={PANEL} storageKey="workspace-demo.file-panel" panelLabel="File viewer" variant="inset"
      className={cn('bg-transparent', replaceChat && '[&>[data-testid=workspace-chat]]:hidden [&>[data-testid=workspace-divider]]:hidden [&>[data-testid=workspace-panel]]:!m-0 [&>[data-testid=workspace-panel]]:!w-full [&>[data-testid=workspace-panel]]:flex-1')} />
  </FloatingViewer>;
}

function WorkspaceLayout(props) {
  const api = useDock('chat');
  props.dock.current = api;
  const { approvalCount } = useAp();
  const [theme, setTheme] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const media = matchMedia('(prefers-color-scheme: dark)'), update = () => setTheme(media.matches ? 'dark' : 'light');
    media.addEventListener('change', update); return () => media.removeEventListener('change', update);
  }, [theme]);
  const conversations = useConversations({ endpoint: at('/api/conversations'), fetch: authorized, activeId: props.active, onSelect: props.setActive });
  const [feed, setFeed] = useState(0);
  useEffect(() => {
    if (!props.provider?.changes) return;
    const stop = new AbortController();
    void (async () => { try { for await (const event of props.provider.changes({ signal: stop.signal })) setFeed(event.seq); } catch { /* keep the last list */ } })();
    return () => stop.abort();
  }, [props.provider]);
  return <>
    <WorkspaceNav view={props.view} go={props.go} api={api} count={approvalCount} />
    <SidebarInset className="min-h-0 overflow-hidden">
      <SiteHeader title={api?.placement === 'page' ? 'Agent' : SCREEN_NAMES[props.view.screen]} theme={theme} setTheme={setTheme} />
      <div className="flex min-h-0 min-w-0 flex-1">
        <Dock id="chat" side="left" floatable dragBelow={260} narrowBelow={720} defaultPlacement="page" defaultWidth={620} minWidth={300} className="bg-muted/40" labels={{ region: 'Agent chat', resize: 'Resize chat' }}>
          {api => <Chat {...props} api={api} conversations={conversations} feed={feed} />}
        </Dock>
        <DockMain><Column view={props.view} /></DockMain>
      </div>
    </SidebarInset>
  </>;
}

function App() {
  const [view, setView] = useState({ screen: 'approvals' });
  const dock = useRef();
  const [file, setFile] = useState<string | undefined>();
  const [provider, setProvider] = useState();
  useEffect(() => { void connectRevisionProvider({ endpoint: at('/api/resources'), fetch: authorized }).then(setProvider); }, []);
  const [active, setActive] = useState(firstConversation);
  // An open document may hold unsaved edits: leaving it (another file, closing it, an agent command) asks first. App screens never touch it.
  const dirty = useRef(false);
  const beforeLeave = useRef<(() => Promise<boolean>) | null>(null);
  const setBeforeLeave = useCallback((flush: (() => Promise<boolean>) | null) => { beforeLeave.current = flush; }, []);
  const currentFile = useRef(file); currentFile.current = file;
  const leaving = useRef(false);
  const leave = async () => {
    if (leaving.current) return false;
    if (!dirty.current) return true;
    const selected = currentFile.current;
    leaving.current = true;
    try {
      const saved = await beforeLeave.current?.();
      if (currentFile.current !== selected) return false;
      return saved === true || !dirty.current || globalThis.confirm('This document has unsaved changes. Discard them and leave?');
    } finally { leaving.current = false; }
  };
  const openFile = useCallback(async (raw: string) => { const path = validWorkspacePath(raw); if (!path) return false; if (path === currentFile.current) return true; if (!await leave()) return false; dirty.current = false; setFile(path); return true; }, []);
  const closeFile = useCallback(async () => { if (!await leave()) return false; dirty.current = false; setFile(undefined); return true; }, []);
  // Commands (the agent's `show`) reach the app's screens, or the agent's own viewer for a file.
  const go = useCallback((next, fromAgent = false) => { if (next.screen === 'file') return openFile(next.path); setView(next); if (fromAgent || dock.current?.placement === 'page') dock.current?.setPlacement('floating'); return true; }, [openFile]);
  return <AgentContextProvider>
    <ApProvider view={view} go={go} conversation={active}>
      <OpenFile.Provider value={openFile}>
        <SidebarProvider style={{ '--sidebar-width': '14.5rem', minHeight: 0, height: '100%' }}>
          <DockLayout storageKey="workspace-demo" minMain={600} className="h-full">
            <WorkspaceLayout view={view} go={go} dock={dock} provider={provider} file={file} openFile={openFile} closeFile={closeFile} setBeforeLeave={setBeforeLeave} setUnsaved={unsaved => { dirty.current = unsaved; }} active={active} setActive={setActive} />
          </DockLayout>
        </SidebarProvider>
      </OpenFile.Provider>
    </ApProvider>
  </AgentContextProvider>;
}

createRoot(document.getElementById('root')).render(<App />);
