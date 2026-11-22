import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TASKS, Task } from './agent-card-demo.jsx';
import { Board, HostCard, TwiceCard } from './agent-card-host-demo.jsx';

// Component scenario `component:agent-card`: the kit's AgentCard (and the AgentChat inside it) on a neutral page, one card per state of a unit of agent work
// (queued, running, needs you, done, failed), three agents in three colours, and one task card (the same card with a `meta`), over a scripted agent: no model, no network.
// Query: dark=1, pace, at=<id>:<level> (0 folded, 1 tray, 2 open, d docked; several joined by commas, e.g. at=running:1,needs:0). The host card (`host`) has no conversation until `at=host:<level>`
// or its first tap; body=1 opens its body; many=<n> shows n cards of a board with no controller; twice=1 adds two folded cards that get two replies unseen (`unreadCount` default and `false`).
// `window.__ux`: answered (what Approve and Deny sent), stopped (how many times a card's controller was stopped), log (what the host's card saw), created (conversations made).
const params = new URLSearchParams(location.search);
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
try { localStorage.removeItem('boring-ui:chat-mode'); } catch { /* none */ }
window.__answered = []; window.__stopped = 0; window.__opened = [];

const many = Number(params.get('many') ?? 0);
const initial = Object.fromEntries((params.get('at') ?? '').split(',').filter(Boolean).map(part => part.split(':')));
function App() {
  const [levels, setLevels] = useState(() => Object.fromEntries(TASKS.map(task => [task.id, initial[task.id] === 'd' ? 0 : Number(initial[task.id] ?? 0)])));
  const [dockedId, setDockedId] = useState(Object.entries(initial).find(([, value]) => value === 'd')?.[0] ?? null);
  const [dock, setDock] = useState(null);
  return <main className="flex min-h-dvh flex-col gap-6 bg-muted/30 p-4 sm:p-8 md:flex-row">
    <div data-testid="cards" className="flex w-full max-w-xl min-w-0 flex-col md:shrink-0">
      <h1 className="m-0 mb-3 text-base font-semibold">Agent work of Harbor Studio (fictional)</h1>
      {many > 0 ? <Board count={many} /> : <>
        {TASKS.map(task => <Task key={task.id} task={task} level={levels[task.id]} onLevel={level => setLevels(now => ({ ...now, [task.id]: level }))}
          dock={dock} docked={dockedId === task.id} onDocked={value => setDockedId(value ? task.id : null)} />)}
        <h2 className="m-0 mt-3 mb-3 text-sm font-semibold text-muted-foreground">On the host's own card (fictional)</h2>
        <HostCard id="host" title="Match the January payments" start={initial.host} bodyOpen={params.get('body') === '1'} dock={dock} />
        <HostCard id="unread" title="Send the payment reminders" unread />
        {params.get('twice') === '1' && <>
          <TwiceCard id="twice" title="Chase the late payers" />
          <TwiceCard id="twice-quiet" title="Chase the late payers (dot only)" quiet />
        </>}
      </>}
    </div>
    <aside ref={setDock} data-testid="dock" className="h-136 min-w-0 flex-1 overflow-hidden rounded-(--radius-3xl) bg-card ring-1 ring-border md:sticky md:top-8">
      {dockedId === null && <p className="m-0 p-4 text-sm text-muted-foreground">A docked agent chat appears here.</p>}
    </aside>
  </main>;
}
window.__ux = { answered: () => window.__answered.slice(), stopped: () => window.__stopped, log: () => window.__hostLog.slice(), created: () => window.__created, twice: () => window.__twice ?? 0, sent: () => window.__sent ?? 0 };
createRoot(document.getElementById('root')).render(<App />);
