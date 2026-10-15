// The browser side of the accounts-payable demo (served by ./server.mjs).
//   [ chat ] [ right column ]
// The left `Dock` holds the chat. Its header carries two icon buttons: conversations (the searchable list of `pi-chat`) and the Library (the
// workspace's files), each a popover anchored to the chat, docked or floating. Dragging the divider narrow floats the chat as `AmbientChat`
// and the right column takes the whole width; docking it back restores both. The right column shows one thing at a time:
// a screen of the app (Approvals, Invoice, Supplier: each a fixed experience over registered cells, ./cells.mjs) or a workspace file.
// Every screen publishes `useAgentContext`; the chat reports its placement (docked or floating) by itself.
// @ts-nocheck: an example page, bundled by esbuild and not part of the typechecked sources.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarClock, Check, CheckCircle2, FileText, FolderOpenIcon, HistoryIcon, MoreHorizontal, Pause, Wallet, XIcon } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import { Experience } from '@hachej/boring-ui-kit/experience';
import { FileTree } from '@hachej/boring-ui-kit/file-tree-view';
import { connectRevisionProvider } from '@hachej/boring-files/revision';
import { Dock, DockLayout, DockMain } from '../../registry/dock/dock.tsx';
import { PiChat } from '../../registry/pi-chat/pi-chat.tsx';
import { AmbientChat } from '../../registry/pi-ambient/ambient.tsx';
import { useRemoteChat } from '../../registry/pi-chat/use-remote-chat.ts';
import { ConversationHistory } from '../../registry/pi-chat/history.tsx';
import { VoiceInput } from '../../registry/feedback/voice-input.tsx';
import { useRevisionAttachments } from '../../registry/pi-app/use-revision-attachments.ts';
import { useConversations } from '../../registry/pi-app/use-conversations.ts';
import { FileViewer } from '../../registry/pi-app/file-viewer.tsx';
import { PdfPane } from '../../registry/viewers/pdf-pane.tsx';
import { Button as ChatButton } from '../../registry/button/button.tsx';
import { cn } from '../../registry/utils/utils.ts';
import { Avatar, AvatarFallback } from './saas/ui/avatar.tsx';
import { Badge } from './saas/ui/badge.tsx';
import { Button } from './saas/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './saas/ui/card.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './saas/ui/dropdown-menu.tsx';
import { SidebarInset, SidebarProvider } from './saas/ui/sidebar.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './saas/ui/tabs.tsx';
import { DataTable, DataTableColumnHeader } from './saas/data-table.tsx';
import { AppSidebar, Header, Main } from './saas/layout.tsx';
import { TODAY, displayStatus } from './data.mjs';
import { AgentContextProvider, readAgentContext, useAgentContext } from '../../registry/app-shell/agent-context.ts';
import { ACTIONS, CELLS, SCREENS, experienceCells } from './cells.mjs';

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
    if (last) { seen.current = last.seq; go(last.screen === 'file' ? { screen: 'file', path: last.path } : last.id ? { screen: last.screen, id: last.id } : { screen: last.screen }); }
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
    '/ap/supplier/all': state.invoices.filter(item => item.supplier === supplier?.id).map(named),
    '/ap/invoices': state.invoices.map(named),
    '/ap/unpaid': state.invoices.filter(item => !item.paidOn && item.status !== 'on-hold').map(named),
    '/ap/suppliers': Object.values(state.suppliers),
  })[path];
  const approvalCount = state.invoices.filter(item => item.status === 'pending' && item.week).length;
  // Named actions. The durable ones are the backend's (a conditional write with a receipt); the others only move the page.
  const act = useCallback(async (name, args) => {
    if (!ACTIONS[name].durable) return void go(name === 'open_invoice' ? { screen: 'invoice', id: args.id } : { screen: 'supplier', id: args.id });
    const response = await authorized(new Request(at(`/api/ap/actions/${name}`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) }));
    const result = await response.json();
    setReceipts(previous => ({ ...previous, [args.invoice]: result }));
    await refresh();
  }, [go, refresh]);
  return <Ap.Provider value={{ resolve, act, receipts, accounts: state.accounts, suppliers: state.suppliers, approvalCount }}>{children}</Ap.Provider>;
}

// ---- Cell renderers, one per kind. They read their bindings through `resolve` and act through named actions. The look is the shadcn-admin
// template's (./saas, MIT): Card, Badge, Tabs and the data table; the cells, their bindings and their actions are unchanged units.
const label = 'text-xs font-medium uppercase tracking-wide text-muted-foreground';
const STATUS_STYLE = {
  pending: 'bg-amber-100/40 text-amber-900 dark:text-amber-200 border-amber-300/60 dark:border-amber-400/30',
  approved: 'bg-sky-100/40 text-sky-900 dark:text-sky-200 border-sky-300/60 dark:border-sky-400/30',
  paid: 'bg-teal-100/30 text-teal-900 dark:text-teal-200 border-teal-200 dark:border-teal-400/30',
  overdue: 'bg-destructive/10 dark:bg-destructive/50 text-destructive dark:text-primary border-destructive/10',
  'on-hold': 'bg-neutral-300/40 border-neutral-300 dark:border-neutral-600',
};
const StatusBadge = ({ invoice, testId }) => { const status = displayStatus(invoice); return <Badge variant="outline" data-testid={testId} className={cn('capitalize', STATUS_STYLE[status])}>{status}</Badge>; };
const Badge2 = ({ tone = 'muted', children }) => <Badge variant="outline" className={cn(tone === 'warn' && 'border-destructive/20 bg-destructive/10 text-destructive', tone === 'ok' && STATUS_STYLE.paid)}>{children}</Badge>;
const STATUS_OPTIONS = ['pending', 'approved', 'paid', 'overdue', 'on-hold'].map(value => ({ value, label: value === 'on-hold' ? 'On hold' : value[0].toUpperCase() + value.slice(1) }));

/** The invoice columns (the template's tasks-columns): sortable headers, status badge, amounts right-aligned in tabular numerals. */
function invoiceColumns({ suppliers, act }) {
  return [
    { accessorKey: 'id', header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice" />, meta: { className: 'ps-1', tdClassName: 'ps-4' },
      cell: ({ row }) => <div className="min-w-0"><div className="font-medium">{row.original.id}</div><div className="truncate text-xs text-muted-foreground">{row.original.number}</div></div> },
    { id: 'supplier', accessorFn: row => suppliers[row.supplier]?.name ?? row.supplier, header: ({ column }) => <DataTableColumnHeader column={column} title="Supplier" />, meta: { className: 'ps-1', tdClassName: 'ps-4' },
      cell: ({ row }) => <span className="block max-w-44 truncate font-medium">{row.getValue('supplier')}</span>, filterFn: (row, id, value) => value.includes(row.getValue(id)) },
    { accessorKey: 'due', header: ({ column }) => <DataTableColumnHeader column={column} title="Due" />, meta: { className: 'ps-1', tdClassName: 'ps-4' }, cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{day(row.original.due)}</span> },
    { id: 'status', accessorFn: row => displayStatus(row), header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />, meta: { className: 'ps-1', tdClassName: 'ps-4' },
      cell: ({ row }) => <StatusBadge invoice={row.original} />, filterFn: (row, id, value) => value.includes(row.getValue(id)) },
    { accessorKey: 'amount', header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" className="justify-end" />, meta: { className: 'text-end', tdClassName: 'text-end' },
      cell: ({ row }) => <span className="font-medium tabular-nums">{money(row.original.amount, row.original.currency)}</span> },
    { id: 'actions', enableHiding: false, meta: { className: 'w-10', tdClassName: 'w-10 pe-2' },
      cell: ({ row }) => <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${row.original.id}`} className="size-8 data-[state=open]:bg-muted" onClick={event => event.stopPropagation()}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40" onClick={event => event.stopPropagation()}>
          <DropdownMenuItem onClick={() => act('open_invoice', { id: row.original.id })}>Open invoice</DropdownMenuItem>
          <DropdownMenuItem onClick={() => act('open_supplier', { id: row.original.supplier })}>Open supplier</DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu> },
  ];
}
const invoiceFilter = (row, _column, value) => { const needle = String(value).toLowerCase(); return [row.original.id, row.original.number, row.original.po, row.getValue('supplier')].some(text => String(text).toLowerCase().includes(needle)); };

function InvoiceTable({ rows, testId, rowTestId, initialSorting, bare, pageSize = 10, filters = true }) {
  const { act, suppliers } = useAp();
  const view = useContext(ViewContext);
  const columns = useMemo(() => invoiceColumns({ suppliers, act }), [suppliers, act]);
  const supplierOptions = Object.values(suppliers).map(supplier => ({ value: supplier.name, label: supplier.name }));
  return <DataTable testId={testId} columns={columns} data={rows} bare={bare} pageSize={pageSize} initialSorting={initialSorting} initialFilter={view.q ?? ''} globalFilterFn={invoiceFilter}
    searchPlaceholder="Filter by invoice, number, PO or supplier..." filters={filters ? [{ columnId: 'status', title: 'Status', options: STATUS_OPTIONS }, { columnId: 'supplier', title: 'Supplier', options: supplierOptions }] : []}
    rowProps={row => ({ 'data-testid': `${rowTestId}-${row.id}`, className: 'cursor-pointer', onClick: () => act('open_invoice', { id: row.id }) })} emptyText="No invoices match." />;
}

function ApprovalQueue({ cell }) {
  const { resolve } = useAp();
  const rows = resolve(cell.state.rows) ?? [];
  return <section data-testid="approval-queue" aria-label="Approval queue" className="flex flex-col gap-3">
    <div className="flex items-baseline gap-2"><h2 className="text-sm font-semibold">Waiting for your approval</h2><span className="text-sm text-muted-foreground">({rows.length})</span></div>
    {rows.length === 0 ? <p className="rounded-md border bg-card p-6 text-center text-sm text-muted-foreground">Nothing is waiting.</p>
      : <InvoiceTable rows={rows} rowTestId="queue-row" initialSorting={[{ id: 'due', desc: false }]} bare />}
  </section>;
}

function InvoiceList({ cell }) {
  const { resolve } = useAp();
  const rows = resolve(cell.state.rows) ?? [];
  const scoped = cell.props.scope === 'payments' ? rows.filter(row => row.status === 'approved') : rows;
  return <section data-testid={cell.props.scope === 'payments' ? 'payments-table' : 'invoice-table'} aria-label={cell.props.scope === 'payments' ? 'Payments' : 'Invoices'} className="flex flex-1 flex-col">
    <InvoiceTable rows={scoped} rowTestId="invoice-row" initialSorting={[{ id: 'due', desc: cell.props.scope !== 'payments' }]} />
  </section>;
}

function RecentInvoices({ cell }) {
  const { resolve } = useAp();
  const rows = [...(resolve(cell.state.rows) ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 6);
  return <Card data-testid="recent-invoices" aria-label="Recent invoices" className="gap-4">
    <CardHeader><CardTitle>Recent invoices</CardTitle><CardDescription>The latest six invoices received.</CardDescription></CardHeader>
    <CardContent className="px-4 sm:px-6"><InvoiceTable rows={rows} rowTestId="recent-row" bare filters={false} /></CardContent>
  </Card>;
}

const TREND = { toApprove: [4, 5, 5, 6, 4, 3, 3], dueWeek: [2, 3, 3, 4, 4, 5, 5], overdue: [1, 1, 2, 2, 1, 2, 1], paid: [3, 4, 4, 6, 5, 7, 8] };
function Spark({ points, tone }) {
  const max = Math.max(...points), min = Math.min(...points), width = 72, height = 24;
  const path = points.map((value, index) => `${(index / (points.length - 1)) * width},${height - 2 - ((value - min) / (max - min || 1)) * (height - 4)}`).join(' ');
  return <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true" className={cn('shrink-0', tone)}><polyline points={path} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function KpiCards({ cell }) {
  const { resolve } = useAp();
  const rows = resolve(cell.state.rows) ?? [];
  const unpaid = rows.filter(row => !row.paidOn && row.status !== 'on-hold');
  const toApprove = rows.filter(row => row.status === 'pending' && row.week);
  const dueWeek = unpaid.filter(row => row.due >= TODAY && row.due <= '2031-03-14');
  const overdue = unpaid.filter(row => row.due < TODAY);
  const paid = rows.filter(row => row.paidOn?.startsWith('2031-03'));
  const sum = list => list.reduce((total, row) => total + row.amount, 0);
  const cards = [
    { id: 'to-approve', title: 'To approve', icon: CheckCircle2, value: String(toApprove.length), note: `${money(sum(toApprove))} waiting`, trend: '-2 vs last week', good: true, points: TREND.toApprove },
    { id: 'due-week', title: 'Due this week', icon: CalendarClock, value: money(sum(dueWeek)), note: `${dueWeek.length} invoices`, trend: '+12% vs last week', good: false, points: TREND.dueWeek },
    { id: 'overdue', title: 'Overdue', icon: AlertTriangle, value: money(sum(overdue)), note: `${overdue.length} ${overdue.length === 1 ? 'invoice' : 'invoices'}`, trend: 'Same as last week', good: true, points: TREND.overdue },
    { id: 'paid', title: 'Paid this month', icon: Wallet, value: money(sum(paid)), note: `${paid.length} invoices`, trend: '+18% vs February', good: true, points: TREND.paid },
  ];
  return <section data-testid="kpi-cards" aria-label="Key figures" className="grid gap-4 @lg/content:grid-cols-2 @4xl/content:grid-cols-4">
    {cards.map(card => <Card key={card.id} data-testid={`kpi-${card.id}`} className="gap-3 py-5">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-0"><CardTitle className="text-sm font-medium">{card.title}</CardTitle><card.icon className="size-4 text-muted-foreground" aria-hidden="true" /></CardHeader>
      <CardContent>
        <div className="flex items-end justify-between gap-2"><div className="text-2xl font-bold tabular-nums">{card.value}</div><Spark points={card.points} tone={card.good ? 'text-teal-600 dark:text-teal-400' : 'text-amber-600 dark:text-amber-400'} /></div>
        <p className="mt-1 text-xs text-muted-foreground">{card.note} · {card.trend}</p>
      </CardContent>
    </Card>)}
  </section>;
}

function CashDue({ cell }) {
  const { resolve } = useAp();
  const rows = [...(resolve(cell.state.rows) ?? [])].sort((a, b) => a.due.localeCompare(b.due));
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return <Card data-testid="cash-due" aria-label="Cash due" className="gap-3">
    <CardHeader><CardTitle>Cash due</CardTitle><CardDescription>What falls due and when.</CardDescription></CardHeader>
    <CardContent>
      <p className="mb-3 text-2xl font-bold tabular-nums">{money(total)}</p>
      <ul className="space-y-1.5 text-sm">{rows.map(row => <li key={row.id} className="flex justify-between gap-3"><span className="text-muted-foreground">{day(row.due)} · {row.id}</span><span className="tabular-nums">{money(row.amount, row.currency)}</span></li>)}</ul>
    </CardContent>
  </Card>;
}

function InvoiceSummary({ cell }) {
  const { resolve, act, receipts, accounts, suppliers } = useAp();
  const invoice = resolve(cell.state.invoice);
  const [account, setAccount] = useState('');
  if (!invoice) return <p role="status" className="text-sm text-muted-foreground">Loading invoice…</p>;
  const receipt = receipts[invoice.id];
  const done = invoice.status !== 'pending';
  const decide = (action, extra = {}) => act(action, { invoice: invoice.id, expected: invoice.revision, ...extra });
  const fields = [['Amount', money(invoice.amount, invoice.currency)], ['Invoice date', day(invoice.date)], ['Due', day(invoice.due)], ['PO', invoice.po], ['Payment terms', suppliers[invoice.supplier]?.terms ?? ''], ['Supplier', invoice.supplierName]];
  return <Card data-testid="invoice-summary" data-invoice={invoice.id} aria-label={`Invoice ${invoice.id}`} className="gap-0 py-0">
    <div className="flex flex-wrap items-start justify-between gap-3 p-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold"><button type="button" data-testid="open-supplier" className="cursor-pointer underline-offset-4 hover:underline" onClick={() => act('open_supplier', { id: invoice.supplier })}>{invoice.supplierName}</button></h2>
          <StatusBadge invoice={invoice} testId="invoice-status" /></div>
        <p className="mt-0.5 text-sm text-muted-foreground">{invoice.id} · {invoice.number} · {invoice.description}</p>
      </div>
    </div>
    <div role="toolbar" aria-label="Invoice actions" className="flex flex-wrap items-center gap-2 border-y bg-muted/30 px-6 py-3">
      <Button size="sm" data-testid="approve" disabled={done} onClick={() => decide('approve')}><Check />Approve</Button>
      <select aria-label="Account for re-code" data-testid="recode-account" value={account} onChange={event => setAccount(event.target.value)} disabled={done} className="h-8 rounded-md border bg-background px-2 text-sm shadow-xs disabled:opacity-50">
        <option value="">Code to another account…</option>{accounts.filter(name => name !== invoice.account).map(name => <option key={name}>{name}</option>)}
      </select>
      <Button size="sm" variant="outline" data-testid="recode" disabled={done || !account} onClick={() => decide('recode', { account })}>Approve and re-code</Button>
      <Button size="sm" variant="ghost" data-testid="hold" className="ms-auto" disabled={done} onClick={() => decide('hold')}><Pause />Hold</Button>
    </div>
    <dl className="grid gap-x-8 gap-y-4 p-6 sm:grid-cols-2">
      {fields.map(([name, value]) => <div key={name} className="flex items-baseline justify-between gap-4 border-b border-dashed pb-2 last:border-0 sm:[&:nth-last-child(2)]:border-0"><dt className="text-sm text-muted-foreground">{name}</dt><dd className="text-end font-medium tabular-nums">{value}</dd></div>)}
      <div className="flex items-baseline justify-between gap-4"><dt className="text-sm text-muted-foreground">Account</dt><dd data-testid="invoice-account" className="text-end font-medium">{invoice.account}</dd></div>
    </dl>
    {receipt && <p data-testid="receipt" className="border-t px-6 py-3 text-sm text-muted-foreground">{receipt.kind === 'committed' ? <>Saved. Receipt <code data-testid="receipt-id" className="rounded bg-muted px-1.5 py-0.5 text-xs">{receipt.receipt.operationId}</code></> : `Not saved: ${receipt.reason ?? receipt.kind}`}</p>}
  </Card>;
}

function DuplicateAlert({ cell }) {
  const { resolve, act } = useAp();
  const matches = resolve(cell.state.matches) ?? [];
  if (!matches.length) return null;
  return <section data-testid="duplicate-alert" role="note" aria-label="Possible duplicate" className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
    <div><h2 className="text-sm font-semibold text-destructive">Possible duplicate</h2>
      <p className="text-sm">Same supplier, PO and amount as {matches.map((match, index) => <span key={match.id}>{index ? ', ' : ''}<button type="button" className="cursor-pointer font-medium underline underline-offset-4" onClick={() => act('open_invoice', { id: match.id })}>{match.id}</button></span>)}.</p></div>
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
  return <section data-testid="invoice-pdf" className="flex h-80 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card shadow-sm" aria-label="Invoice document">
    {bytes ? <PdfPane name={`${invoice.id}.pdf`} bytes={bytes} testId="invoice-pdf-viewer" /> : <p role="status" className="m-auto text-sm text-muted-foreground">Loading document…</p>}
  </section>;
}

function PolicyExcerpt({ cell }) {
  const { resolve } = useAp();
  const invoice = resolve(cell.state.invoice);
  if (!invoice) return null;
  return <Card data-testid="policy-excerpt" aria-label="Policy" className="min-w-0 flex-1 gap-3 text-sm">
    <CardHeader><CardTitle>AP policy, in short</CardTitle></CardHeader>
    <CardContent className="space-y-2 text-muted-foreground">
      <p>{invoice.amount > 1000 ? 'Above 1,000 EUR: one approver, and the invoice number and PO must be new.' : 'Up to 1,000 EUR: one approver.'}</p>
      <p>Same supplier, PO and amount as an open invoice: held until the first is paid or rejected.</p>
    </CardContent>
  </Card>;
}

const initials = name => name.split(/\s+/).filter(word => /^[A-Za-z]/.test(word)).slice(0, 2).map(word => word[0]).join('').toUpperCase();

function SupplierList({ cell }) {
  const { resolve, act } = useAp();
  const rows = resolve(cell.state.rows) ?? [];
  const columns = useMemo(() => [
    { accessorKey: 'name', header: ({ column }) => <DataTableColumnHeader column={column} title="Supplier" />, meta: { className: 'ps-1', tdClassName: 'ps-4' },
      cell: ({ row }) => <div className="flex items-center gap-3"><Avatar className="size-8 rounded-lg"><AvatarFallback className="rounded-lg text-xs">{initials(row.original.name)}</AvatarFallback></Avatar><div className="min-w-0"><div className="truncate font-medium">{row.original.name}</div><div className="truncate text-xs text-muted-foreground">{row.original.terms}</div></div></div> },
    { accessorKey: 'country', header: ({ column }) => <DataTableColumnHeader column={column} title="Country" />, meta: { className: 'ps-1', tdClassName: 'ps-4' }, cell: ({ row }) => <span className="text-muted-foreground">{row.original.country}</span> },
    { id: 'status', accessorFn: row => row.flag ? 'flagged' : 'clear', header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />, meta: { className: 'ps-1', tdClassName: 'ps-4' },
      cell: ({ row }) => row.original.flag ? <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive">Flagged</Badge> : <Badge variant="outline" className={STATUS_STYLE.paid}>Clear</Badge>, filterFn: (row, id, value) => value.includes(row.getValue(id)) },
    { accessorKey: 'openBalance', header: ({ column }) => <DataTableColumnHeader column={column} title="Open balance" className="justify-end" />, meta: { className: 'text-end', tdClassName: 'text-end' },
      cell: ({ row }) => <span className="font-medium tabular-nums">{money(row.original.openBalance)}</span> },
  ], []);
  return <section data-testid="supplier-list" aria-label="Suppliers" className="flex flex-1 flex-col">
    <DataTable columns={columns} data={rows} searchPlaceholder="Filter suppliers..." filters={[{ columnId: 'status', title: 'Status', options: [{ value: 'flagged', label: 'Flagged' }, { value: 'clear', label: 'Clear' }] }]}
      globalFilterFn={(row, _column, value) => row.original.name.toLowerCase().includes(String(value).toLowerCase())}
      rowProps={row => ({ 'data-testid': `supplier-row-${row.id}`, className: 'cursor-pointer', onClick: () => act('open_supplier', { id: row.id }) })} />
  </section>;
}

function SupplierCard({ cell }) {
  const { resolve, act } = useAp();
  const supplier = resolve(cell.state.supplier), open = resolve(cell.state.invoices) ?? [], all = resolve(cell.state.all) ?? [];
  const openContract = useContext(OpenFile);
  if (!supplier) return <p role="status" className="text-sm text-muted-foreground">Loading supplier…</p>;
  return <Card data-testid="supplier-card" aria-label={supplier.name} className="gap-0 py-0">
    <div className="flex flex-wrap items-start gap-4 p-6">
      <Avatar className="size-14 rounded-xl"><AvatarFallback className="rounded-xl text-lg">{initials(supplier.name)}</AvatarFallback></Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{supplier.name}</h2>{supplier.flag && <Badge2 tone="warn">Flagged</Badge2>}</div>
        <p className="text-sm text-muted-foreground">{supplier.country} · {supplier.terms} · {supplier.iban}</p>
        {supplier.flag && <p data-testid="supplier-flag" className="mt-2 text-sm">{supplier.flag}</p>}
      </div>
      <div className="text-end"><div className={label}>Open balance</div><div className="text-xl font-semibold tabular-nums">{money(supplier.openBalance)}</div></div>
    </div>
    <Tabs defaultValue="overview" className="gap-0 border-t">
      <TabsList className="m-4 mb-0 w-fit"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="invoices" data-testid="supplier-tab-invoices">Invoices ({all.length})</TabsTrigger><TabsTrigger value="contract" data-testid="supplier-tab-contract">Contract</TabsTrigger></TabsList>
      <TabsContent value="overview" className="grid gap-4 p-6 sm:grid-cols-3">
        {[['Open invoices', String(open.length)], ['Payment terms', supplier.terms], ['Paid to date', money(all.filter(row => row.paidOn).reduce((sum, row) => sum + row.amount, 0))]].map(([name, value]) => <div key={name}><div className={label}>{name}</div><div className="text-lg font-semibold tabular-nums">{value}</div></div>)}
      </TabsContent>
      <TabsContent value="invoices" className="p-4"><InvoiceTable rows={all} rowTestId="supplier-invoice" bare filters={false} pageSize={5} /></TabsContent>
      <TabsContent value="contract" className="flex flex-wrap items-center justify-between gap-3 p-6">
        <div><div className="font-medium">Supply agreement</div><p className="text-sm text-muted-foreground">{supplier.contract}</p></div>
        <Button size="sm" variant="outline" data-testid="open-contract" onClick={() => openContract(supplier.contract)}><FileText />Open contract</Button>
      </TabsContent>
    </Tabs>
  </Card>;
}

const RENDER = { 'ap/approval-queue': ApprovalQueue, 'ap/invoice-table': InvoiceList, 'ap/recent-invoices': RecentInvoices, 'ap/kpi-cards': KpiCards, 'ap/cash-due': CashDue, 'ap/invoice-summary': InvoiceSummary,
  'ap/duplicate-alert': DuplicateAlert, 'ap/invoice-pdf': InvoicePdf, 'ap/policy-excerpt': PolicyExcerpt, 'ap/supplier-card': SupplierCard, 'ap/supplier-list': SupplierList };
const renderedCells = experienceCells.map(entry => { const cell = CELLS.find(item => item.ref === entry.ref), Component = RENDER[cell.kind]; return { ...entry, render: () => <Component cell={cell} /> }; });

// ---- The right column: the template's app chrome (sidebar, top bar) around one screen or one workspace file.
const OpenFile = createContext(() => {});
const ViewContext = createContext({});
const SCREEN_NAMES = { dashboard: 'Dashboard', approvals: 'Approvals', invoices: 'Invoices', invoice: 'Invoice', suppliers: 'Suppliers', supplier: 'Supplier', payments: 'Payments', reports: 'Reports', settings: 'Settings' };
const TITLES = { dashboard: ['Dashboard', 'Where the payables stand this week.'], approvals: ['Approvals', 'Invoices waiting for your decision.'], invoices: ['Invoices', 'Every invoice received, newest due date first.'],
  suppliers: ['Suppliers', 'Who you pay, and what is open with them.'], payments: ['Payments', 'Approved invoices, scheduled and paid.'], reports: ['Reports', 'Cash and approvals at a glance.'] };

function Screen({ view }) {
  // What the person is looking at, for the agent: the screen and what it shows (an id, never record content).
  useAgentContext({ name: SCREEN_NAMES[view.screen], params: view.id ? { id: view.id } : {} });
  const [title, description] = TITLES[view.screen] ?? [];
  if (view.screen === 'settings') return <Main title="Settings" description="Company and approval preferences."><Card className="max-w-xl gap-3"><CardHeader><CardTitle>Harbor &amp; Pine Foods</CardTitle><CardDescription>Fictional company settings are not part of this demo.</CardDescription></CardHeader>
    <CardContent className="text-sm text-muted-foreground">Approval limits and coding rules follow the AP policy in the Library (Policies/AP policy.md).</CardContent></Card></Main>;
  return <Main {...(title ? { title, description } : {})}><div data-testid={`screen-${view.screen}`} className="flex flex-1 flex-col"><Experience key={`${view.screen}-${view.q ?? ''}`} descriptor={SCREENS[view.screen]} cells={renderedCells} canView={() => true} /></div></Main>;
}

function Document({ view, provider, close, onUnsaved }) {
  useAgentContext({ name: 'Library document', params: { path: view.path } });
  const options = useMemo(() => ({ client: provider, identity: provider.identity, history: provider.history }), [provider]);
  return <div data-testid="library-document" data-path={view.path} className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card [&>*]:min-h-0 [&>*]:flex-1">
    <FileViewer key={view.path} path={view.path} locator={provider.locate(view.path)} options={options} onClose={close} onUnsavedChange={onUnsaved} />
  </div>;
}

function crumbsOf(view, suppliers) {
  const root = { label: 'Accounts payable', screen: { screen: 'dashboard' } };
  switch (view.screen) {
    case 'file': return [{ label: 'Library' }, ...view.path.split('/').map(label => ({ label }))];
    case 'invoice': return [root, { label: 'Invoices', screen: { screen: 'invoices' } }, { label: view.id }];
    case 'supplier': return [root, { label: 'Suppliers', screen: { screen: 'suppliers' } }, { label: suppliers[view.id]?.name ?? view.id }];
    default: return [root, { label: SCREEN_NAMES[view.screen] }];
  }
}

function Column({ view, go, provider, dirty }) {
  const { approvalCount, suppliers } = useAp();
  const root = useRef(null);
  const [open, setOpen] = useState(true);
  // The nav starts collapsed to its icons when the column is narrow (the chat is docked beside it), and expanded when there is room.
  useLayoutEffect(() => { if ((root.current?.clientWidth ?? 9999) < 800) setOpen(false); }, []);
  const name = view.screen === 'file' ? view.path : `${SCREEN_NAMES[view.screen]}${view.id ? ` ${view.id}` : ''}`;
  return <div ref={root} data-testid="right-column" className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background">
    <SidebarProvider open={open} onOpenChange={setOpen} className="min-h-0 flex-1">
      <AppSidebar view={view} go={go} approvals={approvalCount} />
      <SidebarInset className="@container/content min-h-0 min-w-0 overflow-y-auto">
        <span data-testid="viewing" className="sr-only">{name}</span>
        <Header crumbs={crumbsOf(view, suppliers)} go={go} onSearch={query => go({ screen: 'invoices', q: query })} />
        {view.screen === 'file'
          ? <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">{provider ? <Document view={view} provider={provider} close={() => go({ screen: 'approvals' })} onUnsaved={unsaved => { dirty.current = unsaved; }} /> : null}</div>
          : <Screen view={view} />}
      </SidebarInset>
    </SidebarProvider>
  </div>;
}

// ---- The left dock: the chat, with the conversations and the Library as header icons that open popovers anchored to it.
const WIDE = 640;
const transcribe = async (audio: Blob, signal: AbortSignal) => (await (await authorized(new Request(at('/api/transcribe'), { method: 'POST', headers: { 'content-type': audio.type || 'audio/webm' }, body: audio, signal }))).json()).text ?? '';

/** A popover anchored over the chat (docked `PiChat` or floating `AmbientChat`): a fixed frame at the chat's rectangle holding the panel and its backdrop. */
function OverChat({ children }) {
  const [rect, setRect] = useState<DOMRect>();
  useLayoutEffect(() => { setRect(document.querySelector('[data-boring=pi-chat], [data-boring=ambient-chat]')?.getBoundingClientRect()); }, []);
  if (!rect) return null;
  return <div className="pointer-events-none fixed z-50 [&>*]:pointer-events-auto" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>{children}</div>;
}

function LibraryPanel({ provider, view, go, close, feed }) {
  useEffect(() => { const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); }; document.addEventListener('keydown', escape); return () => document.removeEventListener('keydown', escape); }, [close]);
  return <>
    <button type="button" tabIndex={-1} aria-hidden="true" data-testid="library-backdrop" onClick={close} className="absolute inset-0 cursor-default" />
    <section role="dialog" aria-label="Library" data-testid="library-popover" className="absolute top-12 right-3 flex max-h-[min(34rem,calc(100%-4rem))] w-[23rem] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-background text-foreground shadow-lg">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
        <h3 className="m-0 min-w-0 flex-1 text-sm font-semibold tracking-tight">Library</h3>
        <ChatButton size="icon-sm" variant="ghost" aria-label="Close Library" title="Close" onClick={close}><XIcon className="size-4" aria-hidden="true" /></ChatButton>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {provider ? <FileTree variant="list" refresh={false} upload={false} history={false} revisionProvider={provider} refreshKey={feed} selectedPath={view.screen === 'file' ? view.path : undefined} onOpen={path => { if (go({ screen: 'file', path })) close(); }} />
          : <p role="status" className="p-3 text-sm text-muted-foreground">Loading…</p>}
      </div>
    </section>
  </>;
}

function Chat({ api, provider, go, view, active, setActive }) {
  const [panel, setPanel] = useState<'history' | 'library' | undefined>();
  const wide = useRef(440);
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
  if (chat.status !== 'ready') return <p role="status" data-testid="chat-connecting" className="p-4 text-sm text-muted-foreground">{chat.status === 'offline' ? 'Server unreachable. Retrying…' : 'Connecting…'}</p>;
  if (!api.floating && api.width >= WIDE) wide.current = api.width;
  const toggle = (name: 'history' | 'library') => setPanel(current => current === name ? undefined : name);
  const headerActions = [
    { id: 'history', label: 'Conversations', icon: HistoryIcon, pressed: panel === 'history', onSelect: () => toggle('history') },
    { id: 'library', label: 'Library', icon: FolderOpenIcon, pressed: panel === 'library', onSelect: () => toggle('library') },
  ];
  const tools = voice ? <VoiceInput controller={chat.controller} transcribe={transcribe} /> : undefined;
  const common = { controller: chat.controller, actions: chat.actions, headerActions, tools, ...(attachments ? { attachments, pasteToFile: {} } : {}), onOpenFile: path => go({ screen: 'file', path }) };
  return <div className="flex min-h-0 flex-1">
    {api.floating
      ? <AmbientChat {...common} variant="surface" defaultState="expanded" onDock={() => { api.dock(); api.setWidth(wide.current); }} />
      : <PiChat key={active} {...common} conversations={conversations} historyList={false} showHistory={false} showConnectionStatus={false} labels={{ title: 'AP helper' }} className="min-h-0 min-w-0 flex-1" />}
    {panel === 'history' && conversations && <OverChat><ConversationHistory conversations={conversations} onClose={() => setPanel(undefined)} /></OverChat>}
    {panel === 'library' && <OverChat><LibraryPanel provider={provider} view={view} go={go} close={() => setPanel(undefined)} feed={feed} /></OverChat>}
  </div>;
}

function App() {
  const [view, setView] = useState({ screen: 'approvals' });
  const [provider, setProvider] = useState();
  useEffect(() => { void connectRevisionProvider({ endpoint: at('/api/resources'), fetch: authorized }).then(setProvider); }, []);
  const [active, setActive] = useState(firstConversation);
  // An open Library document may hold unsaved edits: leaving it (another file, a screen, an agent command) asks first.
  const dirty = useRef(false);
  const go = useCallback(next => {
    if (dirty.current && !globalThis.confirm('This document has unsaved changes. Discard them and leave?')) return false;
    dirty.current = false;
    setView(next);
    return true;
  }, []);
  return <AgentContextProvider>
    <ApProvider view={view} go={go} conversation={active}>
      <ViewContext.Provider value={view}><OpenFile.Provider value={path => go({ screen: 'file', path })}>
        <DockLayout storageKey="workspace-demo" className="h-full">
          <Dock id="chat" side="left" floatable dragBelow={260} narrowBelow={720} defaultWidth={440} minWidth={300} labels={{ region: 'Agent chat', resize: 'Resize chat' }}>
            {api => <Chat api={api} provider={provider} go={go} view={view} active={active} setActive={setActive} />}
          </Dock>
          <DockMain><Column view={view} go={go} provider={provider} dirty={dirty} /></DockMain>
        </DockLayout>
      </OpenFile.Provider></ViewContext.Provider>
    </ApProvider>
  </AgentContextProvider>;
}

createRoot(document.getElementById('root')).render(<App />);
