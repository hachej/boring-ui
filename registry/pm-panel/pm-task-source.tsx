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

/** One task of `GET {tasks}?mine=1` (`{ tasks, cursor }`): the viewer's own requests for this app, as requester or waiting on them. */
export interface HostTask {
  readonly id: string;
  readonly ref?: string;
  readonly title: string;
  readonly state: string;
  readonly created?: string | number;
  readonly updated?: string | number;
  readonly waiting_on_you?: boolean;
  /** The question, when the task waits on the viewer. */
  readonly question?: string;
}

const STATES: readonly TaskState[] = ['waiting', 'working', 'open', 'done', 'closed'];
const stamp = (value: string | number | undefined) => value === undefined ? undefined : new Date(value).toISOString();

/** Every listed task is the viewer's (the host filtered them), so the viewer is their requester for « Mes demandes ». */
export function toTaskRecord(task: HostTask, viewer: string): TaskRecord {
  const waiting = task.waiting_on_you === true;
  const created = stamp(task.created), updated = stamp(task.updated);
  return {
    id: task.id, ...(task.ref ? { number: task.ref } : {}), title: task.title, requesterId: viewer, waiting_on_you: waiting,
    state: waiting ? 'waiting' : STATES.includes(task.state as TaskState) ? task.state as TaskState : 'open',
    ...(waiting ? { waiting_on: { who: viewer, type: 'person' as const, ...(task.question ? { question: task.question } : {}) } } : {}),
    ...(created ? { created_at: created } : {}), ...(updated ? { updated_at: updated } : {}),
  };
}

/** `null`: the host has no task source for this viewer (404 or 403), so « Mes demandes » stays disabled. */
export async function readTasks(url: string, viewer: string, signal?: AbortSignal): Promise<readonly TaskRecord[] | null> {
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
 * The task a PM reply created: a tool whose name contains `task`, run in the same turn before that reply, whose result carries a D-ref or
 * an id. Tolerant on purpose (the PM's task tool is the host's); adjust here when its result changes.
 */
export function createdTask(entries: readonly EntryRecord[], reply: EntryRecord): { readonly ref?: string; readonly id?: string } | undefined {
  const at = entries.findIndex(entry => entry.id === reply.id);
  for (let index = (at < 0 ? entries.length : at) - 1; index >= 0; index--) {
    for (const message of [...(entries[index]!.model ?? [])].reverse()) {
      if (message.role === 'user') return undefined;
      if (message.role !== 'toolResult' || message.isError || !/task/i.test(message.toolName)) continue;
      const found = referenceIn(message.details) ?? referenceIn(message.content.map(part => part.type === 'text' ? part.text : '').join('\n'));
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * `spec.tasks` for the one line: read when `active`, again when the conversation grows (a PM reply may have created a task) and after an
 * answer. `undefined` until the host answers, and for good when it has no task source.
 */
export function useHostTasks(url: string | undefined, viewer: string | undefined, controller: ImproveSpec['controller'] | undefined, text: PmText): StudioTaskBoardSeam | undefined {
  const [tasks, setTasks] = useState<readonly TaskRecord[] | null>();
  const entries = useSyncExternalStore(controller?.subscribe ?? noSubscribe, () => controller?.getSnapshot().view?.entries.length ?? 0, () => 0);
  const [answered, setAnswered] = useState(0);
  const absent = tasks === null;
  useEffect(() => {
    if (!url || !viewer || absent) return;
    const abort = new AbortController();
    const timer = setTimeout(() => { readTasks(url, viewer, abort.signal).then(setTasks, () => undefined); }, 300);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [url, viewer, absent, entries, answered]);
  const confirm = useCallback(async (task: TaskRecord) => {
    if (!url) return;
    setTasks(current => current?.map(each => each.id === task.id ? { ...each, state: 'working', waiting_on_you: false } : each));
    await answerTask(url, task.id, text.confirm).catch(() => undefined);
    setAnswered(count => count + 1);
  }, [url, text.confirm]);
  return useMemo(() => !tasks || !viewer ? undefined : {
    tasks: [...tasks], currentUser: viewer,
    // No task route in the one line: a card is the request, its answer happens in the PM chat.
    onOpen: () => undefined,
    renderRequest: ({ entry, edit }) => {
      const made = createdTask(controller?.getSnapshot().view?.entries ?? [], entry);
      const task = made && tasks.find(each => each.id === made.id || (made.ref !== undefined && taskReference(each) === made.ref));
      if (!task) return undefined;
      return <TaskRequestCard task={task} variant="compact" locale={text.locale} viewerAction="confirmation" actions={task.waiting_on_you ? <>
        <Button variant="outline" data-testid="pm-request-modify" onClick={() => edit(task.title)}>{text.modify}</Button>
        <Button data-testid="pm-request-confirm" onClick={() => { void confirm(task); }}>{text.confirm}</Button>
      </> : undefined} />;
    },
  }, [tasks, viewer, text, confirm, controller]);
}
const noSubscribe = () => () => undefined;
