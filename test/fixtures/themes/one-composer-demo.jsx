import { useMemo, useState } from 'react';
import { createFileTreeController } from '@hachej/boring-ui-kit/file-tree';
import { FileTreeView } from '../../../registry/file-tree/file-tree.tsx';
import { ATTACHMENTS } from './one-composer-files.js';

// The UX demo layer (`?demo=1`, UX loop): what a person does with the one composer, over invented English bookkeeping content:
// a library (the kit's FileTreeView over an in-memory provider), earlier conversations (the chat's History list), a long conversation,
// a record opened from a page row, a quote from the page. Nothing here changes the default fixture page.
export const DEMO = new URLSearchParams(location.search).get('demo') === '1';

const TREE = {
  '': [['uploads', 'directory'], ['invoices', 'directory'], ['receipts', 'directory'], ['exports', 'directory'], ['videos', 'directory'], ['closing-notes.md', 'file', 2400]],
  receipts: [['receipt-harbor-garage-0109.pdf', 'file', 2100], ['note-gap-0109.md', 'file', 300], ['ticket-harbor-garage-0109.png', 'file', 18000]],
  exports: [['entries-january.json', 'file', 400], ['reminder-delmore.txt', 'file', 200]],
  videos: [['studio-tour.webm', 'file', 30000]],
  uploads: [['statement-january.pdf', 'file', 84000], ['statement-february.pdf', 'file', 79000], ['discrepancies-january.csv', 'file', 900]],
  invoices: [['invoice-delmore-0112.pdf', 'file', 41000], ['invoice-axiom-0108.pdf', 'file', 38000], ['invoice-brown-0121.pdf', 'file', 40500]],
};
const ALL = Object.entries(TREE).flatMap(([dir, rows]) => rows.filter(row => row[1] === 'file').map(([name, kind, size]) => ({ path: dir ? `${dir}/${name}` : name, kind, size })));
const provider = {
  identity: { scopeId: 'demo', principalId: 'maya', initiatorId: 'maya' }, workspace: { providerId: 'demo', instanceId: 'one', incarnation: 'one', viewId: 'one' },
  locate: path => ({ resource: { providerId: 'demo', path }, view: { kind: 'published' } }),
  list: async ({ directory = '' } = {}) => ({ entries: (TREE[directory] ?? []).map(([name, kind, size = 1000]) => ({ path: directory ? `${directory}/${name}` : name, kind, size })) }),
  search: async ({ query }) => ({ entries: ALL.filter(entry => entry.path.toLowerCase().includes(String(query).toLowerCase())) }),
  history: async () => [], read: async () => { throw new Error('unavailable'); }, publish: async () => { throw new Error('unavailable'); }, lookup: async () => undefined,
};
let tree;
/** The files of `path`'s folder, in the tree's order: the set previous and next step through. */
const siblings = path => { const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''; return (TREE[dir] ?? []).filter(row => row[1] === 'file').map(([name]) => dir ? `${dir}/${name}` : name); };
// `open` is the app's own preview (`?viewer=app`); without it the pick goes to the kit's viewer with its folder (`onPicked({ path, files })`).
export const demoLibrary = open => onPicked => {
  tree ??= createFileTreeController({ revisionProvider: provider });
  void tree.refresh();
  return <div data-testid="fixture-library"><FileTreeView controller={tree} locale="en" upload={false} history={false} onOpen={path => { if (open) { open(path); onPicked(); } else onPicked({ path, files: siblings(path) }); }} /></div>;
};

const Table = ({ head, rows }) => <table className="w-full border-collapse text-left text-sm"><thead><tr className="border-b text-xs text-muted-foreground">{head.map((cell, i) => <th key={cell} className={`py-1 ${i === head.length - 1 ? 'text-right' : ''}`}>{cell}</th>)}</tr></thead>
  <tbody>{rows.map(row => <tr key={row.join()} className="border-b last:border-b-0">{row.map((cell, i) => <td key={i} className={`py-2 ${i === row.length - 1 ? 'text-right tabular-nums' : ''}`}>{cell}</td>)}</tr>)}</tbody></table>;
export const fileView = path => {
  const name = path.split('/').at(-1);
  const body = name.endsWith('.csv') ? <><Table head={['Date', 'Label', 'Gap']} rows={[['Jan 09', 'Card Harbor Garage', '$12.00'], ['Jan 15', 'Card The Cedar Diner', '−$12.00']]} /><p className="text-muted-foreground">Two gaps to justify before the closing.</p></>
    : name.startsWith('statement') ? <><p className="text-muted-foreground">Bank statement · Harbor Studio (fictional)</p><Table head={['Date', 'Label', 'Amount']} rows={[['Jan 02', 'Transfer Delmore House', '$1,240.00'], ['Jan 03', 'Direct debit Northgrid Energy', '−$186.40'], ['Jan 05', 'Card Larkin Stationery', '−$42.90'], ['Jan 06', 'Client transfer Brook & Co', '$2,880.00']]} /></>
    : name.startsWith('invoice') ? <><p className="font-medium">Invoice {name.replace('.pdf', '').split('-').at(-1)}</p><Table head={['Description', 'Qty', 'Total excl. tax']} rows={[['Consulting', '3', '$1,050.00'], ['Travel', '1', '$90.00']]} /><p className="text-right font-medium">Total incl. tax: $1,368.00</p></>
    : <><p className="font-medium">Closing notes</p><ul className="list-disc pl-5"><li>Justify the two January gaps.</li><li>Remind Brown &amp; Sons about the invoice of Jan 21.</li><li>Check the payroll tax refund.</li></ul></>;
  return { title: name, content: <div data-testid="fixture-preview" className="flex flex-col gap-3 p-4 text-sm"><p className="font-medium">{name}</p>{body}</div> };
};
// The line detail an app pushes on the pane (S-1): the line, its gap checkbox (state that back must keep), its attachments (each opens in the kit's
// viewer on top, “← Entry of Jan 09”, stepping through the three) and the line's history, long enough to scroll.
const HISTORY = ['Statement imported', 'Automatic reconciliation', 'Discrepancy found: $12.00', 'Ticket added by Maya', 'Note added', 'Reminder to the garage', 'Answer from the garage', 'Discrepancy explained', 'Accountant review', 'Entry corrected', 'Approval', 'Month closed'];
export const recordView = ([date, label, amount, status], quote, open) => ({ title: `Entry of ${date}`, content: <div data-testid="fixture-record" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 text-sm">
  <p className="text-base font-medium">{label}</p><p className="text-2xl font-semibold tabular-nums">{amount}</p><p className="text-muted-foreground">Status: {{ ok: 'reconciled', gap: 'gap to justify', wait: 'needs a receipt' }[status]}</p>
  <label className="flex min-h-11 items-center gap-2"><input type="checkbox" data-testid="record-justified" className="size-4" />Gap justified</label>
  <button type="button" data-testid="record-quote" className="h-10 self-start rounded-md border px-3" onClick={quote}>Quote in the assistant</button>
  {open && <><p className="mt-2 font-medium">Attachments</p><ul className="m-0 flex list-none flex-col gap-1 p-0">{ATTACHMENTS.map(path => <li key={path}>
    <button type="button" data-testid="record-attachment" data-path={path} className="min-h-11 w-full rounded-md border px-3 text-left hover:bg-muted" onClick={() => open(path, ATTACHMENTS)}>{path.split('/').at(-1)}</button></li>)}</ul></>}
  <p className="mt-2 font-medium">History of the entry</p>
  <ol data-testid="record-history" className="m-0 flex flex-col gap-2 pl-5">{HISTORY.map((step, i) => <li key={step} className="py-2">{`Jan ${String(i + 2).padStart(2, '0')} · ${step}`}</li>)}</ol></div> });

const say = (id, text) => ({ id, kind: 'message', model: [{ role: 'user', content: text, timestamp: 1 }] });
const answer = (id, text) => ({ id, kind: 'message', byTaskId: 7, model: [{ role: 'assistant', content: [{ type: 'text', text }], api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: 'stop', timestamp: 2 }] });
const QA = [['How many lines are left to reconcile?', 'Three lines are left: two gaps and a payroll tax refund to justify.'], ['What is the bank balance?', 'The balance is $8,412.10 on January 31.'], ['Which invoices are late?', 'The Brown & Sons invoice of Jan 21 ($1,150.00) has been pending for 19 days.'],
  ['Draft a reminder for Brown & Sons.', 'Here is a draft: “Hello, the invoice of January 21 is still open. Could you confirm the payment date?”'], ['And the Axiom insurance?', 'The $212.00 direct debit of Jan 8 is reconciled, nothing to do.'], ['Summarize the January discrepancies.', 'Two gaps of $12.00: Harbor Garage (Jan 9) and The Cedar Diner (Jan 15).']];
const longConversation = () => Array.from({ length: 22 }, (_, i) => [say(100 + i * 2, `${QA[i % QA.length][0]} (${i + 1})`), answer(101 + i * 2, `${QA[i % QA.length][1]} Point ${i + 1} of 22 of the year-end closing.`)]).flat();
export const CONVERSATIONS = {
  cedre: { title: 'Harbor file', last: 'The fictional Harbor file is waiting for two documents.' },
  long: { title: 'Year-end closing 2025', last: 'Point 22 of 22 of the year-end closing.', entries: longConversation() },
  tva: { title: 'Quarterly sales tax', last: 'Sales tax collected is $4,120.00.', entries: [say(300, 'Compute the sales tax collected this quarter.'), answer(301, 'Sales tax collected is $4,120.00, deductible $1,735.00.')] },
  relance: { title: 'December customer reminders', last: 'Three reminders are ready.', entries: [say(310, 'Prepare the December reminders.'), answer(311, 'Three reminders are ready: Brown & Sons, Delmore House, Rowan Partners.')] },
  ecarts: { title: 'November discrepancies', last: 'The discrepancies are settled.', entries: [say(320, 'Where do the November discrepancies stand?'), answer(321, 'The discrepancies are settled.')] },
};
const NOW = Date.now();
const listItems = extra => [...extra, ...Object.entries(CONVERSATIONS).map(([id, c], i) => ({ id, title: c.title, lastMessage: c.last, updatedAt: NOW - (i + 1) * 3600e3 * 7 }))];
// The app root with the conversation list: History lists them, a pick opens one, New starts an empty one. `show(entries)` swaps the controller's transcript.
export function useDemoConversations(show, cedre) {
  const [active, setActive] = useState('cedre');
  const [fresh, setFresh] = useState([]);
  return useMemo(() => DEMO ? { conversations: { items: listItems(fresh), activeId: active,
    onSelect: id => { setActive(id); show(id === 'cedre' ? cedre : (CONVERSATIONS[id]?.entries ?? [])); },
    onNew: () => { const id = `new-${fresh.length + 1}`; setFresh([{ id, title: 'New conversation', lastMessage: '', updatedAt: Date.now() }, ...fresh]); setActive(id); show([]); } } } : {}, [active, fresh, show, cedre]);
}
