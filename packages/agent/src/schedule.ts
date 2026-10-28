import { defineDoc, defineExtension, defineTask, defineTool } from '@earendil-works/pi-durable';
import type { ConversationId, DocumentReader, Extension, TaskId, TaskInspection, TaskRuntime, Tx } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { withAbortSignal } from '@earendil-works/chord/context';
import type { Context } from '@earendil-works/chord';
import { waitUntil } from './wait-until.js';

export const SCHEDULE_TOOL = 'schedule';
export const LIST_SCHEDULES_TOOL = 'list_schedules';
export const CANCEL_SCHEDULE_TOOL = 'cancel_schedule';
/** Entry kind of a delivered instruction: typed provenance, so a viewer can tell it from a person's message. */
export const SCHEDULED_INPUT_KIND = 'boring.schedule.delivery';
const MAX_DELAY_SECONDS = 366 * 24 * 60 * 60;
const MAX_INSTRUCTION = 4000;
const TIMEZONE_SUFFIX = /(?:Z|[+-]\d{2}:\d{2})$/i;

export type ScheduleRecord = {
  /** Stable id the model lists and cancels by. */
  readonly id: string;
  /** Idempotency key: scheduling again with it returns this schedule instead of creating another. */
  readonly operationId: string;
  readonly instruction: string;
  /** Unix milliseconds. */
  readonly runAt: number;
  readonly taskId: TaskId;
  readonly cancelled?: boolean;
};

type DeliveryInput = { id: string; conversationId: ConversationId; instruction: string; runAt: number };
type DeliveryState = { phase: 'wait' } | { phase: 'deliver' };

/** Pending schedules of one conversation. Forks start empty: a schedule belongs to the conversation that made it. */
export const ConversationSchedules = defineDoc<{ items: ScheduleRecord[]; next: number }>({
  kind: 'boring.schedules', checkpointWhen: () => false, version: 1, scope: 'conversation', history: 'latest', fork: 'initial', initial: () => ({ items: [], next: 1 }),
});

const remove = (items: ScheduleRecord[], id: string): void => { const index = items.findIndex(item => item.id === id); if (index !== -1) items.splice(index, 1); };

/** Sleep on the Harness clock until `runAt`; true when the schedule was cancelled first. */
async function sleepUnlessCancelled(runtime: TaskRuntime<DeliveryInput, DeliveryState, { delivered: boolean }, object>, input: DeliveryInput, context: Context): Promise<boolean> {
  const cancelledIn = (value: Readonly<{ items: readonly ScheduleRecord[] }> | null) => value?.items.find(item => item.id === input.id)?.cancelled === true;
  const watch = await runtime.watchDoc(ConversationSchedules, input.conversationId, context);
  if (watch === undefined) return false;
  const cancel = new AbortController();
  try {
    if (cancelledIn(watch.value)) return true;
    watch.start(async value => { if (cancelledIn(value)) cancel.abort(); });
    const wait = waitUntil(runtime, input.runAt, withAbortSignal(cancel.signal, context));
    try { await wait.done; } finally { wait.disarm(); }
    return false;
  } catch (error) {
    if (cancel.signal.aborted) return true;
    throw error;
  } finally { await watch.stop(); }
}

/**
 * The native durable task behind one schedule: it waits on the Harness clock (`runtime.setTimer`), then delivers the instruction to
 * its conversation as a follow-up input whose request id is the schedule id, so a replayed delivery never submits twice. Owned by
 * the conversation as background work: a person stopping the current turn does not cancel it. No second scheduler: Pi's own
 * scheduler runs it, and a restart resumes it.
 */
export const ScheduledDelivery = defineTask<DeliveryInput, DeliveryState, { delivered: boolean }>({
  name: 'boring.schedule.deliver',
  version: 1,
  initial: () => ({ phase: 'wait' }),
  phases: {
    wait: async (task, runtime, context) => {
      if (await sleepUnlessCancelled(runtime, task.input, context)) {
        await runtime.commit(async tx => {
          remove((await tx.doc(ConversationSchedules, task.input.conversationId)).items, task.input.id);
          return { status: 'terminal', outcome: { status: 'completed', result: { delivered: false } } };
        }, context);
        return;
      }
      await runtime.commit(() => ({ status: 'running', checkpoint: { phase: 'deliver' } }), context);
    },
    deliver: async (task, runtime, context) => {
      const conversation = await runtime.conversation(task.input.conversationId, context);
      if (conversation === undefined) runtime.report(new Error(`Schedule ${task.input.id}: conversation ${task.input.conversationId} is missing`));
      else {
        await conversation.submit({
          type: 'input', requestId: task.input.id, whenBusy: 'followUp', content: `Scheduled instruction ${task.input.id} is due now: ${task.input.instruction}`,
          entry: { kind: SCHEDULED_INPUT_KIND, data: { scheduleId: task.input.id, instruction: task.input.instruction, runAt: task.input.runAt } },
        }, context);
      }
      await runtime.commit(async tx => {
        remove((await tx.doc(ConversationSchedules, task.input.conversationId)).items, task.input.id);
        return { status: 'terminal', outcome: { status: 'completed', result: { delivered: conversation !== undefined } } };
      }, context);
    },
  },
  abort: async (task, runtime, context) => {
    await runtime.commit(async tx => {
      remove((await tx.doc(ConversationSchedules, task.input.conversationId)).items, task.input.id);
      return { status: 'terminal', outcome: { status: 'aborted' } };
    }, context);
  },
});

/**
 * Create a schedule in a commit, or return the one `operationId` already made in this conversation. For hosts that schedule
 * outside a tool (an API route); the `schedule` tool calls it too.
 */
export async function addSchedule(tx: Tx, conversationId: ConversationId, request: { readonly operationId: string; readonly instruction: string; readonly runAt: number }): Promise<ScheduleRecord> {
  const schedules = await tx.doc(ConversationSchedules, conversationId);
  const existing = schedules.items.find(item => item.operationId === request.operationId);
  if (existing !== undefined) return { ...existing };
  const id = `schedule-${schedules.next++}`;
  const taskId = await tx.createTask(ScheduledDelivery, { id, conversationId, instruction: request.instruction, runAt: request.runAt }, { ownership: { kind: 'conversation' }, conversationId, background: true });
  const record: ScheduleRecord = { id, operationId: request.operationId, instruction: request.instruction, runAt: request.runAt, taskId };
  schedules.items.push(record);
  return { ...record };
}

/** Mark a pending schedule of this conversation cancelled; its task wakes and ends without delivering. False when there is none. */
export async function cancelSchedule(tx: Tx, conversationId: ConversationId, id: string): Promise<boolean> {
  const item = (await tx.doc(ConversationSchedules, conversationId)).items.find(candidate => candidate.id === id);
  if (item === undefined || item.cancelled) return false;
  item.cancelled = true;
  return true;
}

/** Pending, uncancelled schedules of one conversation, soonest first. */
export async function listSchedules(reader: DocumentReader, conversationId: ConversationId, context: Context): Promise<ScheduleRecord[]> {
  const value = await reader.snapshot(ConversationSchedules, conversationId, context);
  return (value?.items ?? []).filter(item => !item.cancelled).map(item => ({ ...item })).sort((a, b) => a.runAt - b.runAt);
}

/**
 * The deadline of a schedule task that is still sleeping, from `harness.inspect()`; `undefined` for every other task. A host with
 * one wake-up timer (a Durable Object alarm) sets it to the earliest deadline, and wakes Pi then; the deadlines stay Pi's tasks.
 */
export function scheduledDeadline(task: TaskInspection): number | undefined {
  const { record } = task;
  if (record.kind !== ScheduledDelivery.definition.name || record.abortRequested) return undefined;
  if (record.state.status === 'completing' || record.state.status === 'terminal') return undefined;
  const checkpoint = record.state.checkpoint as { phase?: unknown } | null;
  const runAt = (record.input as { runAt?: unknown } | null)?.runAt;
  return checkpoint?.phase === 'wait' && typeof runAt === 'number' ? runAt : undefined;
}

export interface ScheduleExtensionOptions {
  /** The clock deadlines are computed on; give the Harness's own `now`. Default `Date.now`. */
  readonly now?: () => number;
  /** Called with each new (or returned) deadline, so a host with one wake-up timer can move it earlier. */
  readonly onDeadline?: (runAt: number, context: Context) => void | Promise<void>;
  /** Longest delay accepted; default 366 days. */
  readonly maxDelaySeconds?: number;
}

/**
 * `schedule`, `list_schedules` and `cancel_schedule` plus the delivery task, as one native extension. A conversation lists and
 * cancels only its own schedules. `schedule` is idempotent on `operationId` (default: the tool task, so a replayed call returns
 * the schedule it made).
 */
export function createScheduleExtension(options: ScheduleExtensionOptions = {}): Extension {
  const now = options.now ?? Date.now;
  const maxDelay = options.maxDelaySeconds ?? MAX_DELAY_SECONDS;
  const describe = (record: ScheduleRecord) => ({ id: record.id, instruction: record.instruction, runAt: new Date(record.runAt).toISOString() });
  const schedule = defineTool({
    name: SCHEDULE_TOOL,
    description: 'Schedule an instruction for this conversation at a later time. When it is due, the conversation receives the instruction and carries it out. Give exactly one of delaySeconds or at.',
    parameters: Type.Object({
      instruction: Type.String({ minLength: 1, maxLength: MAX_INSTRUCTION, description: 'What to do when it is due, as a self-contained request without timing words.' }),
      delaySeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: maxDelay })),
      at: Type.Optional(Type.String({ description: 'ISO 8601 date-time with a timezone offset, for example 2026-11-01T09:00:00+01:00.' })),
      operationId: Type.Optional(Type.String({ minLength: 1, maxLength: 200, description: 'Idempotency key: the same key returns the existing schedule.' })),
    }, { additionalProperties: false }),
    replay: 'safe',
    execute: async (args, api, context) => {
      const time = now();
      if ((args.delaySeconds === undefined) === (args.at === undefined)) return refused('give exactly one of delaySeconds or at');
      let runAt: number;
      if (args.delaySeconds !== undefined) runAt = time + args.delaySeconds * 1000;
      else {
        runAt = TIMEZONE_SUFFIX.test(args.at!) ? Date.parse(args.at!) : Number.NaN;
        if (!Number.isFinite(runAt)) return refused('at must be an ISO 8601 date-time with a timezone offset');
        if (runAt <= time) return refused('at must be in the future');
        if (runAt > time + maxDelay * 1000) return refused('at is too far in the future');
      }
      const operationId = args.operationId ?? `tool:${api.taskId}`;
      const record = await api.commit(tx => addSchedule(tx, api.conversationId, { operationId, instruction: args.instruction, runAt }), context);
      await options.onDeadline?.(record.runAt, context);
      return { output: [{ type: 'text', text: `Scheduled ${record.id} for ${describe(record).runAt}: ${JSON.stringify(record.instruction)}. Nothing more is needed now.` }], details: describe(record) };
    },
  });
  const list = defineTool({
    name: LIST_SCHEDULES_TOOL,
    description: 'List the pending schedules of this conversation.',
    parameters: Type.Object({}, { additionalProperties: false }),
    replay: 'safe',
    execute: async (_args, api, context) => {
      const items = (await listSchedules(api, api.conversationId, context)).map(describe);
      return { output: [{ type: 'text', text: JSON.stringify(items) }], details: { items } };
    },
  });
  const cancel = defineTool({
    name: CANCEL_SCHEDULE_TOOL,
    description: 'Cancel a pending schedule of this conversation by its id.',
    parameters: Type.Object({ id: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
    replay: 'safe',
    execute: async (args, api, context) => {
      const cancelled = await api.commit(tx => cancelSchedule(tx, api.conversationId, args.id), context);
      return cancelled ? { output: [{ type: 'text', text: `Cancelled ${args.id}.` }] } : { isError: true, output: [{ type: 'text' as const, text: `No pending schedule ${args.id} in this conversation.` }] };
    },
  });
  return defineExtension({ name: 'boring.schedule', tools: [schedule, list, cancel], tasks: [ScheduledDelivery] });
}

const refused = (reason: string) => ({ isError: true, output: [{ type: 'text' as const, text: `Not scheduled: ${reason}.` }] });
