import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatTextProvider, chatTextFor } from '../../registry/pi-chat/pi-chat.tsx';
import { ConversationHistory } from '../../registry/pi-chat/history.tsx';
import { Button } from '@/components/ui/button';

// Component scenario `component:conversation-list`: the kit's list of past conversations (ConversationHistory of registry/pi-chat/history.tsx: a
// card on a wide screen, a bottom drawer on a phone, with New, search, the Archived filter and row actions) fed by the `conversations` config,
// on a neutral page. The "History" button is the consumer's own (PiChat draws its own in its header). Nothing is a model.
// Query: dark=1, pace (ignored), items=few (default 5) | many (28) | none (empty), open=1 (open at first).
// `window.__ux`: active (the open conversation id), count (items), opened (how many times a row was chosen).
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
const HOUR = 3600e3, NOW = Date.now();
const TITLES = ['January reconciliation', 'Reminder to Delmore House', 'Quarterly sales tax', 'Year-end closing 2025', 'November discrepancies', 'Brown & Sons invoice', 'Maya’s expense report', 'Payroll tax refund', 'Harbor Studio balance sheet', 'Quote from Harbor Garage', 'Deposit for The Cedar Diner', 'December statement', 'Fixed assets 2025', 'Paid leave', 'Axiom Insurance', 'Market Street rent', 'January payroll', 'Larkin Stationery contract', 'Apprenticeship levy', 'Account maintenance fees', 'Northline Telecom', 'Meal vouchers', 'Rowan Partners', 'Regional grant', 'Tax return', 'Cedar file', 'Year-end stock', 'Share capital'];
const COUNT = { none: 0, few: 5, many: TITLES.length }[params.get('items') ?? 'few'] ?? 5;
const make = i => ({ id: `c${i}`, title: TITLES[i], lastMessage: `Last exchange about “${TITLES[i]}”.`, updatedAt: NOW - (i === 0 ? 0.2 : 3 + i * 9) * HOUR, ...(i % 9 === 8 ? { archived: true } : {}) });
const START = Array.from({ length: COUNT }, (_, i) => make(i));
window.__opened = 0;

function App() {
  const [items, setItems] = useState(START);
  const [active, setActive] = useState(START[0]?.id);
  const [open, setOpen] = useState(params.get('open') === '1');
  window.__ux = { active: () => active, count: () => items.filter(item => !item.archived).length, opened: () => window.__opened };
  const conversations = useMemo(() => ({
    items: items.filter(item => !item.archived), activeId: active,
    onSelect: id => { window.__opened += 1; setActive(id); },
    onNew: () => { const id = `new-${Date.now()}`; setItems(list => [{ id, title: 'New conversation', lastMessage: '', updatedAt: Date.now() }, ...list]); setActive(id); },
    // Server-side search over every item, archived or not, as a real host answers it (a short wait).
    search: async (query, { archived }) => { await new Promise(done => setTimeout(done, 120)); const needle = query.toLowerCase();
      return items.filter(item => Boolean(item.archived) === archived && (!needle || (item.title ?? '').toLowerCase().includes(needle))); },
    rename: async (id, title) => setItems(list => list.map(item => item.id === id ? { ...item, title } : item)),
    archive: async (id, archived) => setItems(list => list.map(item => item.id === id ? { ...item, archived } : item)),
    remove: async id => setItems(list => list.filter(item => item.id !== id)),
  }), [items, active]);
  return <ChatTextProvider value={chatTextFor('en')}>
    <main className="flex min-h-dvh items-center justify-center bg-muted/30 p-4 sm:p-8">
      <div data-testid="surface" className="relative flex h-[34rem] w-full max-w-xl flex-col rounded-xl border bg-background p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2"><h1 className="m-0 text-base font-semibold">Assistant · Harbor Studio (fictional)</h1>
          <Button variant="outline" data-testid="history-open" className="min-h-11" onClick={() => setOpen(true)}>History</Button></div>
        <p className="mt-4 text-sm text-muted-foreground">Open conversation: <span data-testid="active-title">{items.find(item => item.id === active)?.title ?? 'none'}</span></p>
        {open && <ConversationHistory conversations={conversations} onClose={() => setOpen(false)} />}
      </div>
    </main>
  </ChatTextProvider>;
}
createRoot(document.getElementById('root')).render(<App />);
