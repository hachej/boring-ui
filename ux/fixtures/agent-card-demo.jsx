import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AgentCard } from '../../registry/agent-card/agent-card.tsx';
import { createDemoController } from './demo-controller.mjs';
import script from '../scenarios/scripts/agent-cards.json';

// The agent cards' demo data: three agents in three colours, one unit of work per state (queued, running, needs you, done, failed) and one task card.
// Shared by the `component:agent-card` page and the design-system home's « Agent cards » section.
window.__answered ??= []; window.__stopped ??= 0; window.__opened ??= [];
const PACE = new URLSearchParams(location.search).get('pace') === 'instant' ? 0.15 : 1;

const asst = (content, stopReason, errorMessage) => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason, timestamp: 2, ...(errorMessage ? { errorMessage } : {}) });
let ids = 1;
const entry = (model, byTaskId = 7) => ({ id: ++ids, kind: 'message', byTaskId, model: [model] });
const say = text => ({ id: ++ids, kind: 'message', model: [{ role: 'user', content: text, timestamp: 1 }] });
const call = (id, name, args) => entry(asst([{ type: 'toolCall', id, name, arguments: args }], 'toolUse'));
const result = (id, name, text, isError = false) => entry({ role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text }], isError, timestamp: 3 }, 8);
const reply = text => entry(asst([{ type: 'text', text }], 'stop'));
const live = tools => ({ 'pi.live': { run: { taskId: 7 }, ...(tools ? { tools } : {}) } });

export const AGENTS = { ledger: { name: 'Ledger', color: 'chart-1' }, reader: { name: 'Reader', color: 'chart-2' }, mailer: { name: 'Mailer', color: 'chart-3' } };
export const TASKS = [
  { id: 'queued', title: 'Reconcile the February statement', agent: 'ledger', seed: () => ({ entries: [], docs: {} }), activity: 'Waiting for a free slot' },
  { id: 'running', title: 'Read the supplier invoices', agent: 'reader', autoplay: 'go',
    seed: () => ({ entries: [say('Read every supplier invoice of February.'), call('r1', 'ls', { path: 'invoices/' }), result('r1', 'ls', '12 files')], docs: live() }) },
  { id: 'needs', title: 'Send the payment reminders', agent: 'mailer',
    seed: () => ({ entries: [say('Remind the clients with an open invoice.'), call('m1', 'read', { path: 'invoices/open-february.csv' }), result('m1', 'read', '3 open invoices'),
      call('m2', 'send_email', { to: 'accounts@example.test', subject: 'Open invoice 0121' })], docs: live([{ callId: 'm2', taskId: 8, details: { 'boring.approval': { summary: 'Send 3 payment reminders?' } } }]) }) },
  { id: 'done', title: 'Match the January payments', agent: 'ledger',
    seed: () => ({ entries: [say('Match the January payments to the invoices.'), call('d1', 'read', { path: 'uploads/statement-january.pdf' }), result('d1', 'read', '40 lines'),
      call('d2', 'write', { path: 'reports/january-matches.csv' }), result('d2', 'write', 'Wrote 38 rows'),
      call('d3', 'present', { path: 'reports/january-matches.csv' }), result('d3', 'present', JSON.stringify({ artifact: { schema: 'boring.artifact', version: 1, title: 'january-matches.csv', type: 'code', mediaType: 'text/csv', target: { resource: { providerId: 'demo', path: 'reports/january-matches.csv' }, view: { kind: 'published' } }, revision: 'r1' } })),
      reply('38 of 40 payments matched. Two are listed in @reports/january-matches.csv.')], docs: {} }) },
  { id: 'failed', title: 'Export the VAT return', agent: 'reader',
    seed: () => ({ entries: [say('Export the VAT return for Q1.'), call('f1', 'bash', { command: 'export-vat --period 2026-Q1' }),
      result('f1', 'bash', "Traceback (most recent call last): File vat_fictional.py, line 41, KeyError: 'period'", true),
      entry(asst([], 'error', 'The export failed (fictional)'))], docs: {} }) },
  { id: 'task', title: 'Review the Brown & Sons contract', agent: 'mailer', task: true,
    seed: () => ({ entries: [say('Check the renewal terms in the Brown & Sons contract.'), call('t1', 'read', { path: 'contracts/brown-sons.pdf' }), result('t1', 'read', '14 pages'),
      reply('The contract renews on March 1 for twelve months. Nothing unusual.')], docs: {} }) },
];

export function makeRun(task) {
  const demo = createDemoController({ script, pace: PACE, seed: task.seed() });
  const actions = { answer: async (_id, text) => { window.__answered.push(text); void demo.play(text); return { kind: 'answered' }; } };
  const stop = demo.controller.stop;
  demo.controller.stop = async () => { window.__stopped += 1; return stop(); };
  return { ...demo, actions };
}
function useRun(task) { return useMemo(() => makeRun(task), [task]); }

function statusOf(snapshot) {
  const docs = snapshot.view.docs['pi.live'], entries = snapshot.view.entries;
  if ((docs?.tools ?? []).some(tool => tool.details?.['boring.approval'])) return { label: 'Needs you', tone: 'attention' };
  if (docs?.run) return { label: 'Running', tone: 'running' };
  if (!entries.length) return { label: 'Queued' };
  const last = entries.at(-1).model[0];
  if (last.role === 'assistant' && last.stopReason === 'error') return { label: 'Failed', tone: 'danger' };
  return { label: 'Done', tone: 'success' };
}

export function Task({ task, level, docked, dock, onLevel, onDocked }) {
  const run = useRun(task);
  const snapshot = useSyncExternalStore(run.controller.subscribe, run.controller.getSnapshot);
  useEffect(() => { if (task.autoplay) void run.play(task.autoplay); }, [run, task]);
  const meta = task.task ? <dl className="m-0 flex gap-4"><div><dt className="inline">Assignee </dt><dd className="inline font-medium text-foreground">Maya Collins (fictional)</dd></div><div><dt className="inline">Due </dt><dd className="inline font-medium text-foreground">Mar 3</dd></div></dl> : undefined;
  return <div data-task={task.id}><AgentCard controller={run.controller} agent={AGENTS[task.agent]} title={task.title} status={statusOf(snapshot)} activity={task.activity} meta={meta}
    level={level} onLevelChange={onLevel} dock={dock} docked={docked} onDockedChange={onDocked} chatProps={{ locale: 'en', actions: run.actions, title: task.title, onSent: () => { window.__sent = (window.__sent ?? 0) + 1; }, artifacts: { open: artifact => window.__opened.push(artifact.title) } }} /></div>;
}

