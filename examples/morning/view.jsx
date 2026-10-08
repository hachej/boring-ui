import React, { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { randomUUID } from '@hachej/boring-files/platform';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import { MarkdownEditor } from '@hachej/boring-ui-kit/markdown-editor';
import { createExperienceDocumentController } from '@hachej/boring-ui-kit/experience/document';
import { ExperienceDocument } from '@hachej/boring-ui-kit/experience/document-viewer';
import { morningCells } from './composition.mjs';
import { createMorningClient } from './client.mjs';

const Context = createContext(null);
const useMorning = () => useContext(Context);
function Receipt({ app }) {
  const { outcomes, reconcile } = useMorning(), outcome = outcomes[app]?.result;
  if (!outcome) return null;
  return <div data-outcome={app}><output role="status">{outcome.kind === 'committed' && app === 'email' && outcome.receipt.changes.some(change => change.kind === 'create') ? 'Queued in fictional outbox' : outcome.kind}{'reason' in outcome ? `: ${outcome.reason}` : ''}</output>
    {outcome.kind === 'committed' && <code data-receipt={app}>{outcome.receipt.operationId}</code>}
    {outcome.kind === 'unknown' && <button onClick={() => void reconcile(app)}>Reconcile {app}</button>}</div>;
}
function HeaderCell() { return <h1>Fictional morning</h1>; }
function ReplyCell() {
  const { session } = useMorning();
  return <div data-fixed-reply><MarkdownEditor controller={session.reply} initialMode="source" title="Saved reply draft" /></div>;
}
function EmailCell() {
  const { apps, session, act, expanded, setExpanded, blocked } = useMorning(), email = apps.email;
  const reply = useSyncExternalStore(session.reply.subscribe, session.reply.getSnapshot, session.reply.getSnapshot);
  if (email.kind !== 'available') return <p role="status">Email unavailable: {email.kind}</p>;
  const base = reply.base;
  return <article data-cell="email"><h2>{email.document.subject}</h2><p>{email.document.status}</p>
    <button disabled={email.document.status === 'queued' || blocked('email') || reply.dirty || reply.save.kind === 'pending' || reply.save.kind === 'settled' && reply.save.result.kind === 'unknown' || base.kind !== 'revision'} onClick={() => void act('email', () => session.client.email.send({ expected: email.revision, draftRevision: base.target.revision }))}>Send saved reply</button>
    <button disabled={email.document.status === 'queued' || blocked('email')} onClick={() => void act('email', () => session.client.email.snooze({ expected: email.revision, option: 'later' }))}>Snooze</button>
    <button onClick={() => setExpanded(!expanded)}>Expand email</button>
    {expanded && <p>Local email details expanded</p>}
    <button onClick={() => document.querySelector('[data-fixed-reply] textarea')?.focus()}>Focus reply</button><Receipt app="email" />
  </article>;
}
function CalendarCell() {
  const { apps, session, act, blocked } = useMorning(), calendar = apps.calendar;
  if (calendar.kind !== 'available') return <p role="status">Calendar unavailable: {calendar.kind}</p>;
  return <article data-cell="calendar"><h2>{calendar.document.title}</h2><p>{calendar.document.attendees.join(', ')}</p>
    {calendar.document.options.map(option => <button key={option.id} disabled={blocked('calendar')} onClick={() => void act('calendar', () => session.client.calendar.acceptSlot({ expected: calendar.revision, optionId: option.id }))}>Accept {option.label}</button>)}
    <p>Selected: {calendar.document.selected ?? 'None'}</p><Receipt app="calendar" />
  </article>;
}
function TodoCell() {
  const { apps, session, act, blocked } = useMorning(), todo = apps.todo;
  if (todo.kind !== 'available') return <p role="status">Todo unavailable: {todo.kind}</p>;
  return <article data-cell="todo"><h2>Morning tasks</h2>{todo.document.items.map(item => <label key={item.id}>
    <input type="checkbox" aria-label={`Tick ${item.id}`} checked={item.completed} disabled={blocked('todo')} onChange={event => void act('todo', () => session.client.todo.setCompleted({ expected: todo.revision, itemId: item.id, completed: event.target.checked }))} />{item.title}
  </label>)}<Receipt app="todo" /></article>;
}
const renders = { 'morning/header': HeaderCell, 'morning/reply': ReplyCell, 'email/reply': EmailCell, 'calendar/conflict': CalendarCell, 'todo/morning': TodoCell };
const cells = morningCells.map(cell => ({ ...cell, render: renders[cell.ref] }));

export async function createMorningSession(client) {
  const config = await client.configuration();
  if (!config.identity) throw new Error('Morning configuration unavailable');
  const [draft, layout, email, calendar, todo] = await Promise.all([
    client.draft.read({ target: config.draftTarget, revision: { kind: 'latest' } }), client.layout.read({ target: config.layoutTarget, revision: { kind: 'latest' } }),
    client.email.read(), client.calendar.read(), client.todo.read(),
  ]);
  if (draft.kind !== 'available' || layout.kind !== 'available') throw new Error('Morning editors unavailable');
  const reply = createMarkdownController({ identity: config.identity, client: client.draft, source: { kind: 'saved', snapshot: draft.snapshot }, instanceId: randomUUID(), epoch: 'morning' });
  const visible = new Set(morningCells.map(cell => cell.ref));
  const experience = createExperienceDocumentController({ identity: config.identity, client: client.layout, source: { kind: 'saved', snapshot: layout.snapshot }, instanceId: randomUUID(), epoch: 'morning', cells: morningCells, canView: ref => visible.has(ref) });
  return { client, reply, experience, initialApps: { email, calendar, todo }, visible,
    async dispose() { await reply.dispose(); await experience.dispose(); } };
}

export function MorningView(props) {
  const [mount, setMount] = useState({ session: props.session, sequence: 0 });
  if (mount.session !== props.session) setMount({ session: props.session, sequence: mount.sequence + 1 });
  return <MountedMorningView key={mount.sequence} {...props} />;
}

function MountedMorningView({ session }) {
  const [apps, setApps] = useState(session.initialApps), [outcomes, setOutcomes] = useState({}), [expanded, setExpanded] = useState(false), [compositionStatus, setCompositionStatus] = useState('Default layout');
  const [visibility, setVisibility] = useState(0), [busy, setBusy] = useState({});
  const activeActions = useRef(new Set()), composition = useRef();
  useEffect(() => () => composition.current?.abort(), []);
  const canView = ref => session.visible.has(ref);
  async function act(app, operation) {
    if (activeActions.current.has(app) || outcomes[app]?.result.kind === 'unknown') return;
    activeActions.current.add(app); setOutcomes(previous => ({ ...previous, [app]: undefined })); setBusy(previous => ({ ...previous, [app]: true }));
    try {
      const outcome = await operation();
      const read = await session.client[app].read(); setApps(previous => ({ ...previous, [app]: read }));
      setOutcomes(previous => ({ ...previous, [app]: outcome })); return outcome;
    } finally { activeActions.current.delete(app); setBusy(previous => ({ ...previous, [app]: false })); }
  }
  async function reconcile(app) {
    const retained = outcomes[app]; if (!retained || retained.result.kind !== 'unknown') return;
    const result = await session.client[app].lookup(retained.intent.operationId);
    const read = await session.client[app].read(); setApps(previous => ({ ...previous, [app]: read }));
    setOutcomes(previous => ({ ...previous, [app]: { ...retained, result: result.kind === 'not-found' ? { kind: 'unknown', operationId: retained.intent.operationId, reason: 'No retained receipt; do not replay' } : result } }));
  }
  async function regenerate(request) {
    composition.current?.abort();
    const abort = new AbortController(); composition.current = abort;
    const signal = session.compositionAbort ? AbortSignal.any([abort.signal, session.compositionAbort.signal]) : abort.signal;
    setCompositionStatus('Composing; default retained');
    let result;
    try { result = await session.client.compose(session.experience.getSnapshot().descriptor, request.trigger, signal); }
    catch { setCompositionStatus('Composition unavailable or cancelled; current layout retained'); return; }
    if (signal.aborted) { setCompositionStatus('Composition cancelled; current layout retained'); return; }
    if (result.kind !== 'composed') { setCompositionStatus(`Composition ${result.kind}; current layout retained`); return; }
    const final = result.snapshots.findLast(snapshot => snapshot.kind === 'final');
    if (!final) { setCompositionStatus(`Composition ${result.snapshots.at(-1)?.reason ?? 'unavailable'}; current layout retained`); return; }
    const proposed = session.experience.actions.proposeRegion(request, final.descriptor);
    setCompositionStatus(proposed.kind === 'proposed' ? 'New arrangement ready; accept to adopt' : `Composition ${proposed.kind}; current layout retained`);
  }
  session.inspect = () => ({ apps, outcomes, compositionStatus, expanded });
  session.regenerate = regenerate;
  session.removeCell = ref => { session.visible.delete(ref); setVisibility(visibility + 1); };
  const context = { session, apps, outcomes, act, reconcile, expanded, setExpanded, blocked: app => busy[app] || outcomes[app]?.result.kind === 'unknown' };
  return <Context value={context}><p role="status" data-composition-status>{compositionStatus}</p>
    <ExperienceDocument controller={session.experience} cells={cells} canView={canView} onRegenerate={regenerate} title="Morning layout" /></Context>;
}

if (typeof document !== 'undefined' && document.getElementById('root')) {
  const faults = { loseActionReply: false, requests: [] }, root = createRoot(document.getElementById('root'));
  const transport = async request => {
    faults.requests.push(new URL(request.url).pathname);
    const headers = new Headers(request.headers); headers.set('authorization', 'Bearer fictional-morning');
    const response = await fetch(new Request(request, { headers }));
    if (faults.loseActionReply && ['/email/send', '/email/snooze', '/calendar/slot', '/todo/tick'].includes(new URL(request.url).pathname)) { faults.loseActionReply = false; throw new Error('Lost application acknowledgement'); }
    return response;
  };
  const client = createMorningClient({ origin: location.href, identity: { principalId: 'fictional-person', initiatorId: 'fictional-person', scopeId: 'fictional-morning' }, fetch: transport });
  createMorningSession(client).then(session => {
    flushSync(() => root.render(<MorningView session={session} />));
    window.morning = { session, faults, inspect: () => session.inspect(), async detach() { flushSync(() => root.render(null)); }, async remount() { flushSync(() => root.render(<MorningView session={session} />)); }, async close() { flushSync(() => root.render(null)); await session.dispose(); } };
  }).catch(error => { document.body.textContent = String(error); throw error; });
}
