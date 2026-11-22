import { useState } from 'react';
import { AgentCard } from '../../registry/agent-card/agent-card.tsx';
import { Button } from '@/components/ui/button';
import { AGENTS, TASKS, makeRun } from './agent-card-demo.jsx';

// The agent card on a host's own card (a board's task card): the host draws the header and the body, puts the tray inside its body (`slot`), and makes the conversation
// only on the first tap (`onChatRequest`). Used by the `component:agent-card` page. `window.__ux.log()` lists what the host saw, `created()` how many conversations it made.
const SOURCE = TASKS.find(task => task.id === 'done');
export const LINES = ['The statement is the February one', 'Every payment is matched to an invoice', 'Two unmatched payments are listed'];
window.__hostLog = []; window.__created = 0;
const log = text => { window.__hostLog.push(text); };

export function HostCard({ id, title, unread, start, dock, bodyOpen = false }) {
  const [open, setOpen] = useState(bodyOpen);
  const [slot, setSlot] = useState(null);
  const [run, setRun] = useState(() => { if (start === undefined) return null; window.__created += 1; return makeRun(SOURCE); });
  const [composer, setComposer] = useState(false);
  const [level, setLevel] = useState(start === 'd' || start === undefined ? 0 : Number(start));
  const [docked, setDocked] = useState(start === 'd');
  const request = () => { log('chat requested'); window.__created += 1; setRun(makeRun(SOURCE)); };
  const header = <div className="flex min-w-0 items-center gap-2 px-3 pt-3 pb-1">
    <Button type="button" variant="ghost" data-testid="host-header-toggle" aria-expanded={open} onClick={() => { log('header tapped'); setOpen(now => !now); }} className="min-w-0 flex-1 justify-start px-0 text-sm font-medium">
      <span className="truncate">{title}</span>
    </Button>
    <Button type="button" variant="outline" size="sm" data-testid="host-not-right" onClick={() => { log('not right'); setComposer(true); if (!run) request(); }}>Not right</Button>
  </div>;
  return <div data-task={id}><AgentCard agent={AGENTS.ledger} title={title} header={header} unread={unread}
    controller={run?.controller} onChatRequest={request} slot={open ? slot : null}
    level={level} onLevelChange={next => { setLevel(next); log(`level ${next}`); }} composer={composer} onComposerChange={next => { setComposer(next); log(`composer ${next ? 'open' : 'closed'}`); }}
    dock={dock} docked={docked} onDockedChange={setDocked}
    chatProps={{ locale: 'en', actions: run?.actions, title, artifacts: { open: artifact => window.__opened.push(artifact.title) } }}>
    {open && <div data-testid="host-body" className="px-3 pt-1 pb-2">
      <ul data-testid="host-lines" className="m-0 flex list-none flex-col gap-1 p-0 text-sm">{LINES.map(line => <li key={line}>{line}</li>)}</ul>
      <div ref={setSlot} data-testid="host-slot" />
    </div>}
  </AgentCard></div>;
}

/** Thirty folded cards with no controller: a board opens no conversation until a tap. */
export function Board({ count }) {
  return <div data-testid="board">{Array.from({ length: count }, (_, i) => <div key={i} data-task={`board-${i}`}>
    <AgentCard agent={AGENTS.mailer} title={`Card ${i + 1} of the board`} header={<p className="m-0 px-3 pt-3 pb-1 text-sm font-medium">Card {i + 1} of the board</p>} onChatRequest={() => { log(`chat requested ${i}`); }} /></div>)}</div>;
}
