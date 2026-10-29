'use client';

// The one-line app's task source (spec 2 « Mes demandes » and C7's request card): the host's same-origin task API, behind a feature
// check. This file is the one adapter between the host's records and `TaskRecord`: the host contract's field names change here only.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { EntryRecord } from '@earendil-works/pi-durable';
import type { TaskRecord, TaskState } from '@hachej/boring-ui-kit/task-board';
import { taskReference } from '@hachej/boring-ui-kit/task-board';
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
  readonly state: string;
  /** Host wording, shown as is. */
  readonly status?: string;
  readonly created?: string | number;
  readonly updated?: string | number;
  readonly updated_at?: string | number;
  readonly waiting_on_you?: boolean;
  /** The question, when the task waits on the viewer. */
  readonly question?: string;
  /** ISO time the requester answered « Confirmer »; absent until then. */
  readonly confirmed_at?: string;
  /** The viewer filed the task. `mine=1` also lists tasks only waiting on the viewer, so only `true` lets them withdraw it. */
  readonly is_requester?: boolean;
}

/** A host task as the one line draws it: `is_requester` stays here, in the adapter, for « Retirer » only. */
export type HostTaskRecord = TaskRecord & { readonly is_requester?: true };

const STATES: readonly TaskState[] = ['waiting', 'working', 'open', 'done', 'closed'];
const stamp = (value: string | number | undefined) => value === undefined ? undefined : new Date(value).toISOString();

/** Every listed task is the viewer's (the host filtered them), so the viewer is their requester for « Mes demandes ». */
export function toTaskRecord(task: HostTask, viewer: string): HostTaskRecord {
  const waiting = task.waiting_on_you === true;
  const created = stamp(task.created), updated = stamp(task.updated ?? task.updated_at), confirmed = stamp(task.confirmed_at), ref = task.ref ?? task.number;
  return {
    id: task.id, ...(ref ? { number: ref } : {}), title: task.title, ...(task.status ? { status: task.status } : {}), requesterId: viewer, waiting_on_you: waiting,
    state: waiting ? 'waiting' : STATES.includes(task.state as TaskState) ? task.state as TaskState : 'open',
    ...(waiting ? { waiting_on: { who: viewer, type: 'person' as const, ...(task.question ? { question: task.question } : {}) } } : {}),
    ...(created ? { created_at: created } : {}), ...(updated ? { updated_at: updated } : {}), ...(confirmed ? { confirmed_at: confirmed } : {}),
    ...(task.is_requester === true ? { is_requester: true as const } : {}),
  };
}

/** `null`: the host has no task source for this viewer (404 or 403), so « Mes demandes » stays disabled. */
export async function readTasks(url: string, viewer: string, signal?: AbortSignal): Promise<readonly HostTaskRecord[] | null> {
  const response = await fetch(`${url}?mine=1`, { credentials: 'same-origin', ...(signal ? { signal } : {}) });
  if (response.status === 404 || response.status === 403) return null;
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const body = await response.json() as { readonly tasks?: readonly HostTask[] };
  return (body.tasks ?? []).map(task => toTaskRecord(task, viewer));
}

/** Answers the question the task waits on, as the viewer. « Confirmer » is such an answer. */
export async function answerTask(url: string, id: string, text: string): Promise<void> {
  const response = await fetch(`${url}/${encodeURIComponent(id)}/answer`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
}

/**
 * Withdraws the viewer's own request (`POST {tasks}/<id>/withdraw`, requester only): `withdrawn` on 200; `started` on 409, once work has
 * started; `refused` otherwise (404 for a non-requester, a network failure).
 */
export async function withdrawTask(url: string, id: string): Promise<'withdrawn' | 'started' | 'refused'> {
  const response = await fetch(`${url}/${encodeURIComponent(id)}/withdraw`, { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
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

/** The PM's task tool (hachej/boring-factory#892): `content[0].text` is JSON `{ created, task: { id, number: 'D-n', title, state, status, updated_at } }`. */
export const TASK_CREATE_TOOL = 'tasks_create';
function exactTask(message: { readonly toolName: string; readonly content: readonly { readonly type: string; readonly text?: string }[] }): { readonly ref?: string; readonly id?: string } | undefined {
  if (message.toolName !== TASK_CREATE_TOOL || message.content[0]?.type !== 'text') return undefined;
  try {
    const task = (JSON.parse(message.content[0].text ?? '') as { readonly task?: { readonly id?: unknown; readonly number?: unknown } }).task;
    const id = typeof task?.id === 'string' ? task.id : undefined, ref = typeof task?.number === 'string' ? task.number : undefined;
    return id || ref ? { ...(ref ? { ref } : {}), ...(id ? { id } : {}) } : undefined;
  } catch { return undefined; }
}

/**
 * The task a PM reply created, from a tool result run in the same turn before that reply: `tasks_create`'s JSON first; then, tolerant
 * (an older or renamed tool), any tool whose name contains `task` and whose result carries a D-ref or an id. Adjust here when it changes.
 */
export function createdTask(entries: readonly EntryRecord[], reply: EntryRecord): { readonly ref?: string; readonly id?: string } | undefined {
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

/**
 * `spec.tasks` for the one line: read when `active`, again when the conversation grows (a PM reply may have created a task), after an
 * answer and after a withdraw refused with 409. `undefined` until the host answers, and for good when it has no task source. A withdrawn
 * request leaves the list; « Confirmer » shows « Envoyée » at once.
 */
export function useHostTasks(url: string | undefined, viewer: string | undefined, controller: ImproveSpec['controller'] | undefined, text: PmText): StudioTaskBoardSeam | undefined {
  const [read, setTasks] = useState<readonly HostTaskRecord[] | null>();
  const [withdrawn, setWithdrawn] = useState<ReadonlySet<string>>(() => new Set());
  const [refused, setRefused] = useState<ReadonlySet<string>>(() => new Set());
  const tasks = useMemo(() => read?.filter(task => !withdrawn.has(task.id)) ?? read, [read, withdrawn]);
  const entries = useSyncExternalStore(controller?.subscribe ?? noSubscribe, () => controller?.getSnapshot().view?.entries.length ?? 0, () => 0);
  const [answered, setAnswered] = useState(0);
  const absent = read === null;
  useEffect(() => {
    if (!url || !viewer || absent) return;
    const abort = new AbortController();
    const timer = setTimeout(() => { readTasks(url, viewer, abort.signal).then(setTasks, () => undefined); }, 300);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [url, viewer, absent, entries, answered]);
  const confirm = useCallback(async (task: TaskRecord) => {
    if (!url) return;
    // « Envoyée » at once: confirmed, nobody started yet.
    setTasks(current => current?.map(each => {
      if (each.id !== task.id) return each;
      const { waiting_on: _, ...rest } = each;
      return { ...rest, state: 'open', waiting_on_you: false, confirmed_at: each.confirmed_at ?? new Date().toISOString() };
    }));
    await answerTask(url, task.id, text.confirm).catch(() => undefined);
    setAnswered(count => count + 1);
  }, [url, text.confirm]);
  const withdraw = useCallback(async (task: HostTaskRecord) => {
    if (!url) return;
    setRefused(current => { const next = new Set(current); next.delete(task.id); return next; });
    const outcome = await withdrawTask(url, task.id);
    if (outcome === 'withdrawn') { setWithdrawn(current => new Set(current).add(task.id)); return; }
    setRefused(current => new Set(current).add(task.id));
    // Started meanwhile: read again, so the card shows its real state.
    if (outcome === 'started') setAnswered(count => count + 1);
  }, [url]);
  return useMemo(() => !tasks || !viewer ? undefined : {
    tasks: [...tasks], currentUser: viewer,
    // No task route in the one line: a card is the request, its answer happens in the PM chat.
    onOpen: () => undefined,
    cardActions: (task: TaskRecord) => withdrawable(task) || refused.has(task.id) ? <WithdrawAction key={task.id} task={task} failed={refused.has(task.id)} text={text} onWithdraw={withdraw} /> : undefined,
    renderRequest: ({ entry, edit }) => {
      const made = createdTask(controller?.getSnapshot().view?.entries ?? [], entry);
      const task = made && tasks.find(each => each.id === made.id || (made.ref !== undefined && taskReference(each) === made.ref));
      if (!task) return undefined;
      return <TaskRequestCard task={task} variant="compact" locale={text.locale} viewerAction="confirmation" actions={task.waiting_on_you ? <>
        <Button variant="outline" data-testid="pm-request-modify" onClick={() => edit(task.title)}>{text.modify}</Button>
        <Button data-testid="pm-request-confirm" onClick={() => { void confirm(task); }}>{text.confirm}</Button>
      </> : undefined} />;
    },
  }, [tasks, viewer, text, confirm, withdraw, refused, controller]);
}
const noSubscribe = () => () => undefined;
