// The browser side of the accounts-payable demo (served by ./server.mjs).
//   [ agent area: chat (+ file viewer) ] [ the app: its own screens ]
// The agent is self-contained in the left `Dock`: the chat, and the files it works with (Library documents, files the agent wrote, uploads).
// A file opens in the agent's own viewer, beside the chat (`ArtifactWorkspace`, the dock widens while it is open) or, when the chat is
// floating (`AmbientChat`), in place of the chat in the same floating window with a back button. The chat header's two icons open the
// conversations list and the Library as popovers anchored to the chat. The app column holds only the app's screens (Approvals, Invoice,
// Supplier: each a fixed experience over registered cells, ./cells.mjs). Dragging the divider narrow floats the whole agent area.
// @ts-nocheck: an example page, bundled by esbuild and not part of the typechecked sources.
import { Component, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FolderOpenIcon, HistoryIcon, XIcon } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import { Experience } from '@hachej/boring-ui-kit/experience';
import { FileTree } from '@hachej/boring-ui-kit/file-tree-view';
import { connectRevisionProvider } from '@hachej/boring-files/revision';
import { Dock, DockLayout, DockMain } from '../../registry/dock/dock.tsx';
import { ArtifactWorkspace } from '../../registry/pi-workspace/workspace.tsx';
import { PiChat } from '../../registry/pi-chat/pi-chat.tsx';
import { AmbientChat } from '../../registry/pi-ambient/ambient.tsx';
import { useRemoteChat } from '../../registry/pi-chat/use-remote-chat.ts';
import { ConversationHistory } from '../../registry/pi-chat/history.tsx';
import { VoiceInput } from '../../registry/feedback/voice-input.tsx';
import { useRevisionAttachments } from '../../registry/pi-app/use-revision-attachments.ts';
import { useConversations } from '../../registry/pi-app/use-conversations.ts';
import { FileViewer } from '../../registry/pi-app/file-viewer.tsx';
import { PdfPane } from '../../registry/viewers/pdf-pane.tsx';
import { Button } from '../../registry/button/button.tsx';
import { cn } from '../../registry/utils/utils.ts';
import { AgentContextProvider, readAgentContext, useAgentContext } from '../../registry/app-shell/agent-context.ts';
import { ACTIONS, CELLS, SCREENS, experienceCells } from './cells.mjs';
import { validWorkspacePath } from './paths.mjs';

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
  const [state, setState] = useState({ invoices: [], suppliers: {}, accounts: [], duplicates: {} });
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
    if (last) { seen.current = last.seq; go(last.screen === 'approvals' ? { screen: 'approvals' } : last.screen === 'file' ? { screen: 'file', path: last.path } : { screen: last.screen, id: last.id }); }
  }, [conversation, go]);
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
function Document({ path, provider, close, onBack, onUnsaved }) {
  useAgentContext({ name: 'Library document', params: { path } });
  const options = useMemo(() => ({ client: provider, identity: provider.identity, history: provider.history }), [provider]);
  return <div data-testid="library-document" data-path={path} className="flex min-h-0 min-w-0 flex-1 flex-col [&>*]:min-h-0 [&>*]:flex-1">
    <ViewerBoundary key={path} onClose={close}>
      <FileViewer path={path} locator={provider.locate(path)} options={options} onClose={close} {...(onBack ? { onBack, backLabel: 'Chat' } : {})} onUnsavedChange={onUnsaved} />
    </ViewerBoundary>
  </div>;
}

/**
 * While the chat floats, a file replaces the chat in a floating window at the same corner (the chat's remembered position). The window is
 * clamped to the viewport on every resize: its top and left edges can never leave the screen, so the header with the back and close buttons
 * is always reachable. Only the content below the pinned header scrolls.
 */
function FloatingViewer({ children }) {
  const MARGIN = 8;
  const measure = () => ({ w: window.innerWidth, h: window.innerHeight });
  const [viewport, setViewport] = useState(measure);
  useEffect(() => { const on = () => setViewport(measure()); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  const phone = viewport.w < 640;
  const width = Math.min(704, viewport.w - 2 * MARGIN), height = Math.min(736, viewport.h - 2 * MARGIN);
  const stored = (() => { try { const value = JSON.parse(sessionStorage.getItem('boring.ambient.position') ?? 'null'); return typeof value?.right === 'number' && typeof value?.bottom === 'number' ? value : { right: 16, bottom: 16 }; } catch { return { right: 16, bottom: 16 }; } })();
  const clamp = (value: number, max: number) => Math.max(MARGIN, Math.min(value, max));
  const style = phone ? undefined : { width, height, right: clamp(stored.right, viewport.w - width - MARGIN), bottom: clamp(stored.bottom, viewport.h - height - MARGIN) };
  return <div data-testid="floating-viewer" role="region" aria-label="File viewer" style={style}
    className={cn('pi-chat fixed z-50 flex flex-col overflow-hidden border border-border bg-background text-foreground shadow-lg', phone ? 'inset-0 h-dvh rounded-none border-0' : 'rounded-3xl')}>
    {children}
  </div>;
}

/** The app column: its own chrome (title, navigation) and its own screens. No documents here. */
function Column({ view, go }) {
  return <div data-testid="right-column" className="flex min-h-0 flex-1 flex-col bg-background">
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-background px-4">
      <h1 className="mr-4 text-sm font-semibold">Harbor &amp; Pine · Accounts payable</h1>
      <Button size="sm" variant={view.screen === 'approvals' ? 'secondary' : 'ghost'} data-testid="nav-approvals" onClick={() => go({ screen: 'approvals' })}>Approvals</Button>
      <span data-testid="viewing" className="ml-auto truncate text-xs text-muted-foreground">{`${SCREEN_NAMES[view.screen]}${view.id ? ` ${view.id}` : ''}`}</span>
    </header>
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-muted/20 p-4 sm:p-6"><Screen view={view} /></div>
  </div>;
}

// ---- The left dock: the chat, with the conversations and the Library as header icons that open popovers anchored to it.
const PANEL = 560; // the file viewer's width beside the chat
const transcribe = async (audio: Blob, signal: AbortSignal) => (await (await authorized(new Request(at('/api/transcribe'), { method: 'POST', headers: { 'content-type': audio.type || 'audio/webm' }, body: audio, signal }))).json()).text ?? '';

/** A popover anchored over the chat (docked `PiChat` or floating `AmbientChat`): a fixed frame at the chat's rectangle holding the panel and its backdrop. A collapsed floating bar is only a bar high, so the panel then opens above it. */
function OverChat({ children }) {
  const [rect, setRect] = useState<DOMRect>();
  useLayoutEffect(() => { setRect(document.querySelector('[data-boring=pi-chat], [data-boring=ambient-chat]')?.getBoundingClientRect()); }, []);
  if (!rect) return null;
  const above = rect.height < 200;
  return <div data-placement={above ? 'above' : 'below'} className="pointer-events-none fixed z-50 [&>*]:pointer-events-auto" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>{children(above)}</div>;
}

function LibraryPanel({ provider, file, openFile, close, feed, above }) {
  const panel = useRef<HTMLElement>(null);
  // The search field takes focus once the tree has loaded, so typing filters at once.
  useEffect(() => {
    let frame = 0, tries = 0;
    const focus = () => { const input = panel.current?.querySelector('input[type=search]'); if (input) input.focus(); else if (tries++ < 60) frame = requestAnimationFrame(focus); };
    focus();
    return () => cancelAnimationFrame(frame);
  }, [provider]);
  return <>
    <button type="button" tabIndex={-1} aria-hidden="true" data-testid="library-backdrop" onClick={() => close(true)} className="absolute inset-0 cursor-default" />
    {/* Escape closes the Library and goes no further: it must not also collapse the floating chat. */}
    <section ref={panel} role="dialog" aria-label="Library" data-testid="library-popover" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } }}
      className={cn('absolute right-3 flex w-[23rem] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-background text-foreground shadow-lg', above ? 'bottom-full mb-2 max-h-[min(26rem,60dvh)]' : 'top-12 max-h-[min(34rem,calc(100dvh-5rem))]')}>
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
        <h3 className="m-0 min-w-0 flex-1 text-sm font-semibold tracking-tight">Library</h3>
        <Button size="icon-sm" variant="ghost" aria-label="Close Library" title="Close" onClick={() => close(true)}><XIcon className="size-4" aria-hidden="true" /></Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {provider ? <FileTree variant="list" refresh={false} upload={false} history={false} revisionProvider={provider} refreshKey={feed} selectedPath={file} onOpen={path => { if (openFile(path)) close(false); }} />
          : <p role="status" className="p-3 text-sm text-muted-foreground">Loading…</p>}
      </div>
    </section>
  </>;
}

function Chat({ api, provider, file, openFile, closeFile, setUnsaved, active, setActive }) {
  const [panel, setPanel] = useState<'history' | 'library' | undefined>();
  const base = useRef(760), widened = useRef(false);
  const conversations = useConversations({ endpoint: at('/api/conversations'), fetch: authorized, activeId: active, onSelect: setActive });
  const chat = useRemoteChat({ conversationId: active, endpoint: id => at(`/api/chat?conversation=${id}`), fetch: authorized, identity, requestContext: () => ({ ...readAgentContext(), tab: TAB }) });
  // The files the person attaches (and a long paste) are saved in the workspace, under uploads/, through the same provider as the Library.
  const attachments = useRevisionAttachments({ revisionProvider: provider });
  // The workspace's change feed: the Library list reloads when the agent (or anyone) writes a file.
  const [feed, setFeed] = useState(0);
  useEffect(() => {
    if (!provider?.changes) return;
    const stop = new AbortController();
    void (async () => { try { for await (const event of provider.changes({ signal: stop.signal })) setFeed(event.seq); } catch { /* the list keeps what it has */ } })();
    return () => stop.abort();
  }, [provider]);
  // The agent area widens by the viewer's width while a file is open beside the chat, and goes back when it closes.
  if (!api.floating && !file && !widened.current) base.current = api.width;
  const side = !api.floating && Boolean(file);
  useEffect(() => {
    if (side && !widened.current) { widened.current = true; api.setWidth(Math.min(base.current + PANEL, Math.max(base.current, Math.round(window.innerWidth * 0.62)))); }
    else if (!side && widened.current) { widened.current = false; if (!api.floating) api.setWidth(base.current); }
  }, [side]); // eslint-disable-line react-hooks/exhaustive-deps
  if (chat.status !== 'ready') return <p role="status" data-testid="chat-connecting" className="p-4 text-sm text-muted-foreground">{chat.status === 'offline' ? 'Server unreachable. Retrying…' : 'Connecting…'}</p>;
  // Closing returns focus to the icon that opened the panel (a pick moves focus to the opened file instead).
  const closePanel = (refocus: boolean) => { const name = panel; setPanel(undefined); if (refocus && name) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid=chat-action-${name}], [data-testid=ambient-action-${name}]`)?.focus()); };
  const toggle = (name: 'history' | 'library') => setPanel(current => current === name ? undefined : name);
  const headerActions = [
    { id: 'history', label: 'Conversations', icon: HistoryIcon, pressed: panel === 'history', onSelect: () => toggle('history') },
    { id: 'library', label: 'Library', icon: FolderOpenIcon, pressed: panel === 'library', onSelect: () => toggle('library') },
  ];
  const tools = voice ? <VoiceInput controller={chat.controller} transcribe={transcribe} /> : undefined;
  const common = { controller: chat.controller, actions: chat.actions, headerActions, tools, ...(attachments ? { attachments, pasteToFile: {} } : {}), onOpenFile: openFile };
  const viewer = file && provider ? <Document path={file} provider={provider} close={closeFile} onBack={api.floating ? closeFile : undefined} onUnsaved={setUnsaved} /> : null;
  const pi = <PiChat key={active} {...common} conversations={conversations} historyList={false} showHistory={false} showConnectionStatus={false} labels={{ title: 'AP helper' }} className="min-h-0 min-w-0 flex-1 bg-transparent" />;
  return <div className="flex min-h-0 flex-1">
    {api.floating
      ? (viewer ? <FloatingViewer>{viewer}</FloatingViewer> : <AmbientChat {...common} variant="surface" defaultState="expanded" onDock={() => { api.dock(); api.setWidth(base.current); }} />)
      : <ArtifactWorkspace chat={pi} open={Boolean(file)} panel={viewer} onClose={closeFile} sheetBelow={0} minPanel={360} minChat={340} defaultWidth={PANEL} storageKey="workspace-demo.file-panel" panelLabel="File viewer" className="bg-transparent [&_[data-testid=workspace-panel]]:bg-transparent" />}
    {panel === 'history' && conversations && <OverChat>{above => <ConversationHistory conversations={conversations} placement={above ? 'above' : 'below'} onClose={() => closePanel(true)} />}</OverChat>}
    {panel === 'library' && <OverChat>{above => <LibraryPanel provider={provider} file={file} openFile={openFile} close={closePanel} feed={feed} above={above} />}</OverChat>}
  </div>;
}

function App() {
  const [view, setView] = useState({ screen: 'approvals' });
  const [file, setFile] = useState<string | undefined>();
  const [provider, setProvider] = useState();
  useEffect(() => { void connectRevisionProvider({ endpoint: at('/api/resources'), fetch: authorized }).then(setProvider); }, []);
  const [active, setActive] = useState(firstConversation);
  // An open document may hold unsaved edits: leaving it (another file, closing it, an agent command) asks first. App screens never touch it.
  const dirty = useRef(false);
  const leave = () => !dirty.current || globalThis.confirm('This document has unsaved changes. Discard them and leave?');
  const openFile = useCallback((raw: string) => { const path = validWorkspacePath(raw); if (!path) return false; if (path === file) return true; if (!leave()) return false; dirty.current = false; setFile(path); return true; }, [file]);
  const closeFile = useCallback(() => { if (!leave()) return false; dirty.current = false; setFile(undefined); return true; }, []);
  // Commands (the agent's `show`) reach the app's screens, or the agent's own viewer for a file.
  const go = useCallback(next => { if (next.screen === 'file') return openFile(next.path); setView(next); return true; }, [openFile]);
  return <AgentContextProvider>
    <ApProvider view={view} go={go} conversation={active}>
      <OpenFile.Provider value={openFile}>
        <DockLayout storageKey="workspace-demo" className="h-full">
          <Dock id="chat" side="left" floatable dragBelow={260} narrowBelow={720} defaultWidth={760} minWidth={300} className="bg-muted/70" labels={{ region: 'Agent chat', resize: 'Resize chat' }}>
            {api => <Chat api={api} provider={provider} file={file} openFile={openFile} closeFile={closeFile} setUnsaved={unsaved => { dirty.current = unsaved; }} active={active} setActive={setActive} />}
          </Dock>
          <DockMain><Column view={view} go={go} /></DockMain>
        </DockLayout>
      </OpenFile.Provider>
    </ApProvider>
  </AgentContextProvider>;
}

createRoot(document.getElementById('root')).render(<App />);
