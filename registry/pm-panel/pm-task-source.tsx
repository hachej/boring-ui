'use client';

// The one-line app's task source (spec 2 « Mes demandes » and C7's request card): the host's same-origin task API, behind a feature
// check. This file is the one adapter between the host's records and `TaskRecord`: the host contract's field names change here only.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { EntryRecord } from '@earendil-works/pi-durable';
import type { TaskRecord, TaskState } from '@hachej/boring-ui-kit/task-board';
import { taskReference } from '@hachej/boring-ui-kit/task-board';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TaskRequestCard } from '../task-board/task-board';
import type { ImproveSpec, StudioTaskBoardSeam } from './use-pm-panel';
import type { PmText } from './pm-text';

/**
 * One task of `GET {tasks}?mine=1` (`{ tasks, cursor }`, hachej/boring-factory#892): the viewer's own requests for this app, as requester
 * or waiting on them. The D-ref is `ref` (list) or `number` (`tasks_create`), the update time `updated` or `updated_at`.
 */
export interface HostTask {
  readonly id: string;
  readonly ref?: string;
  readonly number?: string;
  readonly title: string;
  readonly display?: string;
  readonly technical?: boolean;
  readonly state: string;
  /** Host wording, shown as is. */
  readonly status?: string;
  readonly created?: string | number;
  readonly created_at?: string | number;
  readonly updated?: string | number;
  readonly updated_at?: string | number | null;
  readonly waiting_on_you?: boolean;
  /** The question, when the task waits on the viewer. */
  readonly question?: string;
  readonly waiting_on?: { readonly question?: string };
  /** ISO time the requester answered « Confirmer »; absent until then. */
  readonly confirmed_at?: string;
  /** The viewer filed the task. `mine=1` also lists tasks only waiting on the viewer, so only `true` lets them withdraw it. */
  readonly is_requester?: boolean;
  /** Why a `done` or `closed` task ended (the platform's field, 2026-10-29); omitted on open tasks. */
  readonly closed_reason?: 'shipped' | 'withdrawn' | 'closed';
}

/** A finished request's muted label in « Mes demandes »: « En ligne » (shipped or done), « Retirée » (withdrawn), « Fermée » (any other close). */
export type TaskOutcome = 'live' | 'withdrawn' | 'closed';

/**
 * A host task as the one line draws it: `is_requester` stays here, in the adapter, for « Retirer » only; `outcome` is set on finished
 * tasks only.
 */
export type HostTaskRecord = TaskRecord & { readonly is_requester?: true; readonly outcome?: TaskOutcome };

const STATES: readonly TaskState[] = ['waiting', 'working', 'open', 'done', 'closed'];
const REASONS: Readonly<Record<string, TaskOutcome>> = { shipped: 'live', withdrawn: 'withdrawn', closed: 'closed' };

/** The host's `closed_reason` on a `done` or `closed` task; without it, `done` is « En ligne » and `closed` is « Fermée ». Open: undefined. */
export function taskOutcome(state: string, reason?: string): TaskOutcome | undefined {
  if (state !== 'done' && state !== 'closed') return undefined;
  return (reason !== undefined && Object.hasOwn(REASONS, reason) ? REASONS[reason] : undefined) ?? (state === 'done' ? 'live' : 'closed');
}

/** « Terminées »' label for any record: the host's outcome when the one line mapped it, else from the state alone. Undefined while open. */
export const requestOutcome = (task: TaskRecord): TaskOutcome | undefined => (task as HostTaskRecord).outcome ?? taskOutcome(task.state);
const stamp = (value: string | number | null | undefined) => value == null ? undefined : new Date(value).toISOString();

/** Every listed task is the viewer's (the host filtered them), so the viewer is their requester for « Mes demandes ». */
export function toTaskRecord(task: HostTask, viewer: string): HostTaskRecord {
  const ended = task.state === 'done' || task.state === 'closed' || task.status === 'abandoned' || task.status === 'shipped';
  const waiting = !ended && task.waiting_on_you === true;
  const created = stamp(task.created ?? task.created_at), updated = stamp(task.updated ?? task.updated_at), confirmed = stamp(task.confirmed_at), ref = task.ref ?? task.number;
  const state: TaskState = task.status === 'abandoned' ? 'closed' : task.status === 'shipped' ? 'done' : waiting ? 'waiting' : STATES.includes(task.state as TaskState) ? task.state as TaskState : 'open', outcome = taskOutcome(state, task.closed_reason ?? (task.status === 'abandoned' ? 'withdrawn' : undefined));
  return {
    id: task.id, ...(ref ? { number: ref } : {}), title: task.title, ...(task.display ? { display: task.display } : {}), ...(task.technical === undefined ? {} : { technical: task.technical }), ...(task.status ? { status: task.status } : {}), requesterId: viewer, waiting_on_you: waiting, state,
    ...(waiting ? { waiting_on: { who: viewer, type: 'person' as const, ...((task.question ?? task.waiting_on?.question) ? { question: task.question ?? task.waiting_on?.question } : {}) } } : {}),
    ...(created ? { created_at: created } : {}), ...(updated ? { updated_at: updated } : {}), ...(confirmed ? { confirmed_at: confirmed } : {}),
    ...(task.is_requester === true ? { is_requester: true as const } : {}), ...(outcome ? { outcome } : {}),
  };
}

/** Member request vocabulary is shared by the thread card and « Mes demandes », not inferred from status prose. */
export function PmRequestStatus({ task, text }: { readonly task: TaskRecord; readonly text: PmText }) {
  const outcome = requestOutcome(task);
  const status = outcome === 'live' ? 'live' : outcome === 'withdrawn' ? 'withdrawn' : outcome === 'closed' ? 'closed'
    : task.waiting_on_you === true ? 'waiting' : task.status === 'blocked' ? 'blocked' : task.status === 'verifying' ? 'verifying' : 'preparing';
  const label = status === 'live' ? text.outcomeLive : status === 'withdrawn' ? text.outcomeWithdrawn : status === 'closed' ? text.outcomeClosed
    : status === 'waiting' ? text.awaiting : status === 'blocked' ? text.blocked : status === 'verifying' ? text.verifying : text.preparing;
  return <Badge data-task-status={status} variant={status === 'blocked' ? 'destructive' : 'secondary'}>{label}</Badge>;
}

/** `null`: no task source for this viewer just now (404 or 403). The hook reads again later; it never latches it (decided 2026-10-29). */
export async function readTasks(url: string, viewer: string, signal?: AbortSignal): Promise<readonly HostTaskRecord[] | null> {
  const response = await fetch(`${url}?mine=1`, { credentials: 'same-origin', ...(signal ? { signal } : {}) });
  if (response.status === 404 || response.status === 403) return null;
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const body = await response.json() as { readonly tasks?: readonly HostTask[] };
  return (body.tasks ?? []).map(task => toTaskRecord(task, viewer));
}

/** Answers the question the task waits on, as the viewer. « Confirmer » is such an answer. */
export async function answerTask(url: string, id: string, text: string): Promise<void> {
  const response = await fetch(`${url}/${encodeURIComponent(id)}/answer`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
}

/**
 * Withdraws the viewer's own request (`POST {tasks}/<id>/withdraw`, requester only): `withdrawn` on 200, whether its body is empty or
 * `{ task }` (the body is not read: the list is read again); `started` on 409, once work has started; `refused` otherwise (404 for a
 * non-requester, a network failure).
 */
export async function withdrawTask(url: string, id: string): Promise<'withdrawn' | 'started' | 'refused'> {
  const response = await fetch(`${url}/${encodeURIComponent(id)}/withdraw`, { method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
  return response?.ok ? 'withdrawn' : response?.status === 409 ? 'started' : 'refused';
}

/** Withdraws only what the viewer filed and nobody started: `is_requester`, and `open` or waiting on the viewer. */
export const withdrawable = (task: TaskRecord) => (task as HostTaskRecord).is_requester === true && (task.state === 'open' || task.waiting_on_you === true);

/** « Retirer » on the requester's card in « Mes demandes »: one tap asks « Retirer cette demande ? », the second withdraws. */
function WithdrawAction({ task, failed, text, onWithdraw }: { readonly task: HostTaskRecord; readonly failed: boolean; readonly text: PmText; readonly onWithdraw: (task: HostTaskRecord) => Promise<void> }) {
  const [asking, setAsking] = useState(false), [busy, setBusy] = useState(false);
  const withdraw = () => { setBusy(true); void onWithdraw(task).finally(() => { setBusy(false); setAsking(false); }); };
  return <>
    {withdrawable(task) && (asking ? <>
      <p data-testid="pm-withdraw-ask" className="col-span-2 m-0 flex min-h-0! items-center text-sm font-medium">{text.withdrawAsk}</p>
      <Button variant="destructive" data-testid="pm-withdraw-confirm" disabled={busy} onClick={withdraw}>{text.withdraw}</Button>
      <Button variant="outline" data-testid="pm-withdraw-cancel" disabled={busy} onClick={() => setAsking(false)}>{text.cancel}</Button>
    </> : <Button variant="outline" data-testid="pm-withdraw" className="col-span-2" onClick={() => setAsking(true)}>{text.withdraw}</Button>)}
    {failed && <p role="status" data-testid="pm-withdraw-failed" className="col-span-2 m-0 min-h-0! text-[13px] text-muted-foreground">{text.withdrawFailed}</p>}
  </>;
}

const REF = /\bD-\d+\b/, UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
/** A D-ref or task id in a tool result: `details` fields first (`ref`, `number`, `id`, nested `task`), then the text. */
function referenceIn(value: unknown): { readonly ref?: string; readonly id?: string } | undefined {
  if (typeof value === 'string') { const ref = REF.exec(value)?.[0], id = UUID.exec(value)?.[0]; return ref || id ? { ...(ref ? { ref } : {}), ...(id ? { id } : {}) } : undefined; }
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['ref', 'number', 'id', 'task']) { const found = record[key] === undefined ? undefined : referenceIn(record[key]); if (found) return found; }
  return undefined;
}

/**
 * The PM's task tool (hachej/boring-factory#892): `content[0].text` is JSON `{ created, task: { id, number: 'D-n', title, state, status,
 * updated_at, waiting_on_you?, confirmed_at?, is_requester? } }`. With an id and a title, `task` draws the request card on its own.
 */
export const TASK_CREATE_TOOL = 'tasks_create';
export interface CreatedTask { readonly ref?: string; readonly id?: string; readonly task?: HostTask }
function exactTask(message: { readonly toolName: string; readonly content: readonly { readonly type: string; readonly text?: string }[] }): CreatedTask | undefined {
  if (message.toolName !== TASK_CREATE_TOOL || message.content[0]?.type !== 'text') return undefined;
  try {
    const task = (JSON.parse(message.content[0].text ?? '') as { readonly task?: Record<string, unknown> }).task;
    const id = typeof task?.['id'] === 'string' ? task['id'] : undefined, ref = typeof task?.['number'] === 'string' ? task['number'] : undefined;
    if (!id && !ref) return undefined;
    const whole = id && typeof task?.['title'] === 'string' && typeof task['state'] === 'string' ? task as unknown as HostTask : undefined;
    return { ...(ref ? { ref } : {}), ...(id ? { id } : {}), ...(whole ? { task: whole } : {}) };
  } catch { return undefined; }
}

/**
 * The task a PM reply created, from a tool result run in the same turn before that reply: `tasks_create`'s JSON first; then, tolerant
 * (an older or renamed tool), any tool whose name contains `task` and whose result carries a D-ref or an id. Adjust here when it changes.
 */
export function createdTask(entries: readonly EntryRecord[], reply: EntryRecord): CreatedTask | undefined {
  const at = entries.findIndex(entry => entry.id === reply.id);
  for (let index = (at < 0 ? entries.length : at) - 1; index >= 0; index--) {
    for (const message of [...(entries[index]!.model ?? [])].reverse()) {
      if (message.role === 'user') return undefined;
      if (message.role !== 'toolResult' || message.isError || !/task/i.test(message.toolName)) continue;
      const found = exactTask(message) ?? referenceIn(message.details) ?? referenceIn(message.content.map(part => part.type === 'text' ? part.text : '').join('\n'));
      if (found) return found;
    }
  }
  return undefined;
}

/** The request card's record: the `tasks_create` result merged with the list's record, the list winning on conflicts. */
export function requestRecord(made: CreatedTask, listed: readonly HostTaskRecord[], viewer: string): HostTaskRecord | undefined {
  const fromList = listed.find(each => each.id === made.id || (made.ref !== undefined && taskReference(each) === made.ref));
  const fromTool = made.task ? toTaskRecord(made.task, viewer) : undefined;
  if (!fromList || !fromTool) return fromList ?? fromTool;
  const { waiting_on: _, ...tool } = fromTool;
  return { ...tool, ...fromList };
}

/**
 * `spec.tasks` for the one line: read when `active`, again when the conversation grows (a PM reply may have created a task), on `refresh`
 * (the panel opens, « Mes demandes » opens), after an answer and after a withdraw refused with 409. A 403, 404 or network error is
 * « unavailable for now », never latched: the next read may answer (decided 2026-10-29). The request card is drawn from the `tasks_create`
 * result even before or without the list. A request withdrawn in this session is « Retirée » at once, before the host's `closed_reason` says
 * so, and its chat card goes; « Confirmer » shows « Envoyée » at once.
 */
export function useHostTasks(url: string | undefined, viewer: string | undefined, controller: ImproveSpec['controller'] | undefined, text: PmText): StudioTaskBoardSeam | undefined {
  const [read, setTasks] = useState<readonly HostTaskRecord[] | null>();
  // Withdrawn in this session: id → when, so the card moves to « Terminées » as « Retirée » (newest first) whatever the host says yet.
  const [withdrawn, setWithdrawn] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [refused, setRefused] = useState<ReadonlySet<string>>(() => new Set());
  // « Envoyée » at once: confirmed, nobody started yet. Kept until the host's record says so (or the answer fails).
  const [confirmed, setConfirmed] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [confirming, setConfirming] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmFailed, setConfirmFailed] = useState<ReadonlySet<string>>(() => new Set());
  const pendingConfirm = useRef(new Set<string>());
  const settle = useCallback((task: HostTaskRecord): HostTaskRecord => {
    const gone = withdrawn.get(task.id);
    // The host has the last word once it says something newer: shipped, or reopened after the withdraw.
    const reopened = task.outcome === undefined && Date.parse(task.updated_at ?? '') > Date.parse(gone ?? '');
    if (gone !== undefined && task.outcome !== 'live' && !reopened) {
      const { waiting_on: _, is_requester: __, ...rest } = task;
      return { ...rest, state: 'closed', waiting_on_you: false, outcome: 'withdrawn', updated_at: task.state === 'closed' ? task.updated_at ?? gone : gone };
    }
    const at = confirmed.get(task.id);
    if (at === undefined || !task.waiting_on_you) return task;
    const { waiting_on: _, ...rest } = task;
    return { ...rest, state: 'open', waiting_on_you: false, confirmed_at: task.confirmed_at ?? at };
  }, [confirmed, withdrawn]);
  const tasks = useMemo(() => (read ?? []).map(settle), [read, settle]);
  const entries = useSyncExternalStore(controller?.subscribe ?? noSubscribe, () => controller?.getSnapshot().view?.entries.length ?? 0, () => 0);
  const [answered, setAnswered] = useState(0);
  const [asked, setAsked] = useState(0);
  const refresh = useCallback(() => setAsked(count => count + 1), []);
  useEffect(() => {
    if (!url || !viewer) return;
    const abort = new AbortController();
    // A network error keeps what was read before; 403 and 404 mean « unavailable for now ».
    const timer = setTimeout(() => { readTasks(url, viewer, abort.signal).then(setTasks, () => { if (!abort.signal.aborted) setTasks(current => current ?? null); }); }, 300);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [url, viewer, entries, answered, asked]);
  const confirm = useCallback(async (task: TaskRecord) => {
    if (!url) return;
    if (pendingConfirm.current.has(task.id)) return;
    pendingConfirm.current.add(task.id);
    setConfirming(current => new Set(current).add(task.id));
    setConfirmFailed(current => { const next = new Set(current); next.delete(task.id); return next; });
    const done = await answerTask(url, task.id, text.confirm).then(() => true, () => false);
    pendingConfirm.current.delete(task.id);
    setConfirming(current => { const next = new Set(current); next.delete(task.id); return next; });
    if (done) setConfirmed(current => new Map(current).set(task.id, task.confirmed_at ?? new Date().toISOString()));
    else setConfirmFailed(current => new Set(current).add(task.id));
    setAnswered(count => count + 1);
  }, [url, text.confirm]);
  const withdraw = useCallback(async (task: HostTaskRecord) => {
    if (!url) return;
    setRefused(current => { const next = new Set(current); next.delete(task.id); return next; });
    const outcome = await withdrawTask(url, task.id);
    if (outcome !== 'refused') setAnswered(count => count + 1);
    if (outcome === 'withdrawn') { setWithdrawn(current => new Map(current).set(task.id, new Date().toISOString())); return; }
    // Started meanwhile (409): the list is read again, so the card shows its real state.
    setRefused(current => new Set(current).add(task.id));
  }, [url]);
  return useMemo(() => !url || !viewer ? undefined : {
    tasks, currentUser: viewer, refresh,
    // No task route in the one line: a card is the request, its answer happens in the PM chat.
    onOpen: () => undefined,
    cardActions: (task: TaskRecord) => withdrawable(task) || refused.has(task.id) ? <WithdrawAction key={task.id} task={task} failed={refused.has(task.id)} text={text} onWithdraw={withdraw} /> : undefined,
    renderRequest: ({ entry, edit }) => {
      const made = createdTask(controller?.getSnapshot().view?.entries ?? [], entry);
      const found = made && !withdrawn.has(made.id ?? '') ? requestRecord(made, tasks, viewer) : undefined;
      if (!found) return undefined;
      const task = settle(found);
      return <TaskRequestCard task={task} variant="compact" locale={text.locale} pill={<PmRequestStatus task={task} text={text} />} actions={task.waiting_on_you ? <>
        <Button variant="outline" data-testid="pm-request-modify" disabled={confirming.has(task.id)} onClick={() => edit(task.title)}>{text.modify}</Button>
        <Button data-testid="pm-request-confirm" disabled={confirming.has(task.id)} aria-busy={confirming.has(task.id) || undefined} onClick={() => { void confirm(task); }}>{confirming.has(task.id) ? text.confirming : text.confirm}</Button>
        {confirmFailed.has(task.id) && <p role="alert" data-testid="pm-confirm-failed" className="col-span-2 m-0 text-sm">{text.confirmFailed}</p>}
      </> : undefined} />;
    },
  }, [url, tasks, viewer, text, confirm, withdraw, refused, withdrawn, settle, refresh, controller, confirming, confirmFailed]);
}
const noSubscribe = () => () => undefined;
