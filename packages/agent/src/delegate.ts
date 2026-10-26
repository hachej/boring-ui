import { AgentDoc, AssistantEntry, LiveDoc, UsageDoc, configure, defineTool } from '@earendil-works/pi-durable';
import type { AgentChange, ConversationId, Cursor, EntryId, Extension, LiveState, TaskId, ToolExecutionApi, ToolRegistration, Tx } from '@earendil-works/pi-durable';
import type { Context } from '@earendil-works/chord';
import { Type } from '@earendil-works/pi-ai';
import type { Usage } from '@earendil-works/pi-ai';

const GUARDS: WeakSet<object> = ((globalThis as Record<symbol, WeakSet<object>>)[Symbol.for('boring.agent.guards')] ??= new WeakSet()); // approval + sandbox extensions: a delegated child inherits them
const isGuard = (extension: object): boolean => GUARDS.has(extension);

export const DELEGATE_TOOL = 'delegate';

/** `DelegateDetails.kind`: how a UI recognises a sub-agent call's details, whatever the tool is named. */
export const DELEGATE_DETAILS_KIND = 'boring.delegate';
export type DelegateStatus = 'running' | 'done' | 'failed' | 'cancelled';
/**
 * What a delegate call publishes for a UI (a sub-agent card), version 1. While the child runs, the call's running details
 * (Pi's `ToolExecutionApi.details`, `pi.live` tool slot) carry it with `status: 'running'`, replaced each time the child's tool
 * calls or tokens change; the tool result's details carry the finished value (`done`, `failed` with `error`, or `cancelled`).
 * Fields are only added under version 1; a change of meaning bumps `version`.
 */
export type DelegateDetails = {
  readonly kind: typeof DELEGATE_DETAILS_KIND;
  readonly version: 1;
  /** The child agent's id (`DelegateOptions.agent.id`). */
  readonly agent: string;
  /** The child conversation, owned by the delegate call's tool task. */
  readonly conversationId: ConversationId;
  readonly status: DelegateStatus;
  /** Epoch milliseconds the call first started (kept across a replay). */
  readonly startedAt: number;
  /** Milliseconds from `startedAt` to this update (to the end, once finished). */
  readonly durationMs: number;
  /** Tool calls the child's model has made so far (from its committed assistant entries). */
  readonly toolCalls: number;
  /** The child's spend so far, from its `pi.usage`: prompt tokens (cache reads and writes included) and output tokens. */
  readonly tokens: { readonly input: number; readonly output: number };
  /** Why the child failed (`failed` only). */
  readonly error?: string;
};

/**
 * Host policy for delegate calls (host-owned, BORING-PI-4: Pi has no extension point for running-child limits, start rates, task
 * size or a child deadline, so the tool enforces them). Every field is optional; an unset field is no limit. A call that hits a
 * limit creates no child and returns an error result whose text says why (never a throw), for example
 * `2 delegates already running for this conversation (limit 2).`. Only a call that would create a child is checked: a rerun that
 * reattaches to its existing child (after a crash or eviction) is never refused and is counted once.
 *
 * The counts live in this process and belong to this object: every delegate tool given the same `limits` object shares them
 * (pass one object to several `delegates` entries for one host-wide cap). A process restart starts them empty; reruns that
 * reattach to their children count those again, and the hourly window forgets the starts before the restart.
 */
export interface DelegateLimits {
  /** Children running at once for one parent conversation. */
  readonly maxRunningPerConversation?: number;
  /** Children started for one parent conversation in the last 60 minutes (a rolling window), whether or not they ended. */
  readonly maxStartsPerHour?: number;
  /** Children running at once across every parent conversation, for the tools sharing this object in this process. */
  readonly maxRunning?: number;
  /** Characters of `task`. */
  readonly maxTaskChars?: number;
  /**
   * Wall-clock milliseconds a child may run, from the call's first start (kept across a rerun). On expiry the tool aborts the
   * child conversation (Pi's `ConversationHandle.abort`) and the call fails with `The <agent> agent timed out after <ms> ms.`
   */
  readonly timeoutMs?: number;
}

/** How a metered child ended: `timeout` is a child `DelegateLimits.timeoutMs` cancelled. */
export type DelegateEnd = 'done' | 'failed' | 'cancelled' | 'timeout';

/** One response of the child's model, from its committed assistant entry. */
export type DelegateModelEvent = {
  /** The child's entry; a rerun after a crash sends the entries again, so a host dedupes by `entryId`. */
  readonly entryId: EntryId;
  readonly provider: string;
  readonly model: string;
  /** Pi's per-response `Usage` (tokens and cost), as recorded on the assistant message. */
  readonly usage: Usage;
};

/** The host's handle for one child's spend (its own flight log); the kit only feeds and closes it. */
export interface DelegateMeter {
  /** One child model response, in entry order. A throw is ignored: the host's log owns its failures, not the child. */
  readonly record: (event: DelegateModelEvent) => void | Promise<void>;
  /** Called once, after the last `record`, when the call ends. A throw is ignored. */
  readonly close: (end: DelegateEnd) => void | Promise<void>;
}

export interface DelegateOptions {
  /**
   * The child agent, usually a `defineAgent` result (its `id` and native `agent` change). The child conversation selects exactly its
   * extensions, model and instructions: its tools are the whole toolset. Its extensions must be installed in the registry.
   */
  readonly agent: { readonly id: string; readonly agent: AgentChange };
  /** Tool name; default `delegate`. Give each delegate of one agent its own name. */
  readonly name?: string;
  readonly description?: string;
  /**
   * Runs inside the native commit (`ToolExecutionApi.commit`, Pi's `Tx`) that creates the child, after the child agent is
   * configured: the host copies what the child must carry from the parent (user, workspace binding, permissions) with `tx`.
   * It runs once per child (never on a replay that finds the existing child); a throw aborts the commit, so no child exists.
   */
  readonly onChild?: (parent: ConversationId, child: ConversationId, tx: Tx) => void | Promise<void>;
  /** Concurrency, rate, task size and timeout limits (`DelegateLimits`). */
  readonly limits?: DelegateLimits;
  /**
   * Host metering (host-owned, BORING-PI-4: Pi records spend in `pi.usage` but has no hook to a host's log). Called after the
   * commit that creates the child, and again by a rerun in a new process that reattaches to it (the earlier handle is gone).
   * The tool sends the handle each child model response (`DelegateModelEvent`) and closes it when the call ends. A throw fails
   * the call. The kit keeps no log.
   */
  readonly meter?: (parent: ConversationId, child: ConversationId) => DelegateMeter | Promise<DelegateMeter>;
  /**
   * Names of the tools a child may have: its enabled tools become the intersection of this list with what it would otherwise
   * get, written as Pi's own tool filter (`pi.agent` `tools`) in the commit that creates it. Unset: no restriction.
   */
  readonly childTools?: readonly string[];
}

/**
 * Pi's subagent pattern (pi-durable README "Abort and Subagents") as a tool factory: the child is a conversation owned by the
 * calling tool task (`ownership: { kind: 'task', taskId }`), so aborting the call aborts the child and the parent is idle only
 * once the child is. Replay-safe: a rerun of the same tool task (after a crash or eviction) finds its child through the native
 * ownership index and its submission through the request id, so it never starts a second child or a second turn. Returns only the
 * child's final text. The child inherits the parent's approval and sandbox extensions (appended after its own, in the parent's order, so a
 * sandbox stays last), so a delegate cannot escape the parent's gate; `details` is a `DelegateDetails` (live while the child runs) for a UI that shows it.
 * `onChild` lets the host write the parent's identity onto the child in the same commit that creates it.
 * Host policy, all optional (Pi has no extension point for these): `limits` (running children per conversation and per host,
 * starts per hour, task size, a child deadline; a refusal is an error result, never a throw, and creates no child), `meter`
 * (the host's flight-log handle, fed each child model response and closed when the call ends) and `childTools` (an allow list
 * applied through Pi's own tool filter). With none of them set the tool behaves as before.
 */
export function createDelegateTool(options: DelegateOptions): ToolRegistration {
  const name = options.name ?? DELEGATE_TOOL;
  // A task-owned conversation starts as a copy of its owner's agent; reset the inherited filters so the child's own extensions are
  // its whole toolset, then apply the child agent. `cwd` stays inherited unless the child agent sets one.
  const child: AgentChange = { tools: null, modelTools: null, instructions: null, thinkingLevel: null, ...options.agent.agent };
  const { limits } = options;
  return defineTool({
    name,
    description: options.description ?? `Delegate a self-contained task to the ${options.agent.id} agent and get its final answer back.`,
    parameters: Type.Object({ task: Type.String({ minLength: 1, description: 'The complete task; the agent sees nothing else of this conversation.' }) }, { additionalProperties: false }),
    replay: 'safe',
    execute: async (args, api, context) => {
      const inherited = (await api.agent(context)).extensions.filter(isGuard);
      const agent = withGuards(child, inherited);
      const parent = api.conversationId, ledger = limits === undefined ? undefined : ledgerOf(limits);
      let opened: { readonly id: ConversationId } | { readonly refused: string };
      try {
        opened = await api.commit(async tx => {
          const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
          if (existing !== undefined) { ledger?.running.set(api.taskId, parent); return { id: existing.id }; }
          const refused = ledger === undefined ? undefined : admit(limits!, ledger, api.taskId, parent, args.task);
          if (refused !== undefined) return { refused };
          const created = await tx.createConversation({ ownership: { kind: 'task', taskId: api.taskId } });
          await configure(tx, created.id, agent);
          if (options.childTools !== undefined) await allowTools(tx, created.id, options.childTools, api);
          await options.onChild?.(parent, created.id, tx);
          return { id: created.id };
        }, context);
      } catch (error) { ledger?.running.delete(api.taskId); ledger?.starts.delete(api.taskId); throw error; }
      if ('refused' in opened) return { output: [{ type: 'text', text: opened.refused }], isError: true };
      const childId = opened.id;
      let meter: DelegateMeter | undefined, end: DelegateEnd = 'cancelled', timer: ReturnType<typeof setTimeout> | undefined;
      try {
        meter = await options.meter?.(parent, childId);
        const startedAt = await api.memo('delegate.startedAt', Date.now(), context);
        const progress = childProgress(api, childId, meter);
        const details = (status: DelegateStatus, counts: Counts, error?: string): DelegateDetails => ({
          kind: DELEGATE_DETAILS_KIND, version: 1, agent: options.agent.id, conversationId: childId, status, startedAt,
          durationMs: Math.max(1, Date.now() - startedAt), ...counts, ...(error === undefined ? {} : { error }) });
        const initial = await progress.read(context);
        await api.details(details('running', initial), context);
        const conversation = await api.conversation(childId, context);
        if (conversation === undefined) throw new Error(`Delegate conversation ${childId} is missing`);
        const submission = await conversation.submit({ type: 'input', content: args.task, requestId: `${name}:${api.taskId}` }, context);
        // The timeout reuses the cancel path: aborting the child settles its submission `aborted`, reported below as a timeout.
        let timedOut = false;
        if (limits?.timeoutMs !== undefined) timer = setTimeout(() => { timedOut = true; conversation.abort(context).catch(() => undefined); }, Math.max(0, startedAt + limits.timeoutMs - Date.now()));
        const live = await publishLive(api, childId, progress, initial, counts => api.details(details('running', counts), context), context);
        // A stopped call ends here: Pi writes its aborted result from the slot, so its details stay the last `running` value.
        const settled = await submission.wait(context).finally(() => live.stop());
        clearTimeout(timer);
        const counts = await progress.read(context);
        if (settled.status !== 'done' || settled.type !== 'input') {
          if (timedOut) {
            end = 'timeout';
            const error = `The ${options.agent.id} agent timed out after ${limits!.timeoutMs} ms.`;
            return { output: [{ type: 'text', text: error }], isError: true, details: details('failed', counts, error) };
          }
          const reason = settled.status === 'unanswered' ? settled.reason : settled.status;
          const detail = settled.status === 'unanswered' && typeof settled.detail === 'string' && settled.detail ? settled.detail : undefined;
          const error = `The ${options.agent.id} agent did not answer: ${reason}${detail ? ` (${detail})` : ''}`;
          end = reason === 'aborted' ? 'cancelled' : 'failed';
          return { output: [{ type: 'text', text: error }], isError: true, details: reason === 'aborted' ? details('cancelled', counts) : details('failed', counts, error) };
        }
        end = 'done';
        const answer = await api.commit(tx => tx.entry(AssistantEntry, settled.answer), context);
        const message = answer?.model?.find(part => part.role === 'assistant');
        const text = message?.role === 'assistant' ? message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n') : '';
        return { output: [{ type: 'text', text }], details: details('done', counts) };
      } finally {
        clearTimeout(timer);
        ledger?.running.delete(api.taskId);
        if (meter !== undefined) await quietly(() => meter!.close(end));
      }
    },
  });
}

type Counts = Pick<DelegateDetails, 'toolCalls' | 'tokens'>;

/**
 * The child's counts from its native records: tool calls from its committed assistant entries (scanned once, incrementally,
 * through the invocation's commit), tokens from its `pi.usage` (Pi's `UsageDoc`, both buckets).
 */
function childProgress(api: ToolExecutionApi, childId: ConversationId, meter: DelegateMeter | undefined) {
  let toolCalls = 0, after: EntryId | undefined;
  return {
    async read(context: Context): Promise<Counts> {
      const scanned = await api.commit(async tx => {
        let found = 0, last = after, cursor: Cursor | undefined;
        const events: DelegateModelEvent[] = [];
        do {
          const page = await tx.scanEntries({ conversationId: childId, order: 'ascending', ...(last === undefined ? {} : { minEntryId: (last + 1) as EntryId }) }, 100, cursor);
          for (const entry of page.items) {
            last = entry.id;
            for (const message of entry.model ?? []) if (message.role === 'assistant') {
              found += message.content.filter(part => part.type === 'toolCall').length;
              events.push({ entryId: entry.id, provider: message.provider, model: message.model, usage: message.usage });
            }
          }
          cursor = page.next;
        } while (cursor !== undefined);
        return { found, last, events };
      }, context);
      toolCalls += scanned.found; after = scanned.last;
      // Outside the commit, which may run more than once; reads are sequential, so events arrive once each, in entry order.
      if (meter !== undefined) for (const event of scanned.events) await quietly(() => meter.record(event));
      const usage = await api.snapshot(UsageDoc, childId, context);
      const tokens = { input: 0, output: 0 };
      for (const bucket of [usage?.models, usage?.tools]) for (const spend of Object.values(bucket ?? {})) {
        tokens.input += (spend.input ?? 0) + (spend.cacheRead ?? 0) + (spend.cacheWrite ?? 0);
        tokens.output += spend.output ?? 0;
      }
      return { toolCalls, tokens };
    },
  };
}

/**
 * Publish the child's counts while it runs. Pi's `watchDoc(LiveDoc)` on the child is the trigger: a frame whose run shape changed
 * (a response committed, a tool round started or ended; never a streamed partial) schedules one read of the counts, outside the
 * listener so the watch never waits on it, coalescing the frames that arrive meanwhile. The details are replaced only when the
 * counts changed. `stop()` ends the watch and waits for a publish in flight.
 */
async function publishLive(api: ToolExecutionApi, childId: ConversationId, progress: ReturnType<typeof childProgress>, initial: Counts, publish: (counts: Counts) => Promise<void>, context: Context): Promise<{ stop(): Promise<void> }> {
  const watch = await api.watchDoc(LiveDoc, childId, context);
  if (watch === undefined) return { stop: async () => undefined };
  let shape = '', published = JSON.stringify(initial), stopped = false, dirty = false;
  let reading: Promise<void> | undefined, committing: Promise<void> = Promise.resolve();
  const drain = async (): Promise<void> => {
    while (dirty && !stopped) {
      dirty = false;
      const counts = await progress.read(context);
      const key = JSON.stringify(counts);
      if (stopped || key === published) continue;
      published = key;
      // Not awaited: Pi paces running-details commits (`progress.outputIntervalMs`) and a newer value replaces a pending one.
      committing = publish(counts).catch(() => undefined);
    }
  };
  watch.start(async value => {
    const next = runShape(value);
    if (stopped || next === shape) return;
    shape = next;
    dirty = true;
    reading ??= drain().catch(() => undefined).finally(() => { reading = undefined; });
  });
  return { async stop() { stopped = true; await watch.stop(); await reading; await committing; } };
}

const quietly = async (run: () => void | Promise<void>): Promise<void> => { try { await run(); } catch { /* the host's meter owns its failures */ } };

/** Per `DelegateLimits` object: the calls holding a running child (by tool task, so a rerun of the same task counts once) and recent starts. */
type Ledger = { readonly running: Map<TaskId, ConversationId>; readonly starts: Map<TaskId, { readonly parent: ConversationId; readonly at: number }> };
const LEDGERS = new WeakMap<DelegateLimits, Ledger>();
const ledgerOf = (limits: DelegateLimits): Ledger => {
  let ledger = LEDGERS.get(limits);
  if (ledger === undefined) LEDGERS.set(limits, ledger = { running: new Map(), starts: new Map() });
  return ledger;
};
const HOUR_MS = 60 * 60 * 1000;
const delegates = (count: number): string => `${count} delegate${count === 1 ? '' : 's'}`;

/**
 * Why a new child may not start, or `undefined` after reserving its running slot and its start. Synchronous, so two calls in
 * this process cannot both pass the same last slot; idempotent for one task, since a commit may run its change again.
 */
function admit(limits: DelegateLimits, ledger: Ledger, taskId: TaskId, parent: ConversationId, task: string): string | undefined {
  if (limits.maxTaskChars !== undefined && task.length > limits.maxTaskChars) return `The task is ${task.length} characters; the limit is ${limits.maxTaskChars}.`;
  const now = Date.now();
  for (const [id, start] of ledger.starts) if (now - start.at >= HOUR_MS) ledger.starts.delete(id);
  const others = [...ledger.running].filter(([id]) => id !== taskId);
  const here = others.filter(([, owner]) => owner === parent).length;
  if (limits.maxRunningPerConversation !== undefined && here >= limits.maxRunningPerConversation) return `${delegates(here)} already running for this conversation (limit ${limits.maxRunningPerConversation}).`;
  if (limits.maxRunning !== undefined && others.length >= limits.maxRunning) return `${delegates(others.length)} already running on this host (limit ${limits.maxRunning}).`;
  const started = [...ledger.starts].filter(([id, start]) => id !== taskId && start.parent === parent).length;
  if (limits.maxStartsPerHour !== undefined && started >= limits.maxStartsPerHour) return `${delegates(started)} already started for this conversation in the last hour (limit ${limits.maxStartsPerHour}).`;
  ledger.running.set(taskId, parent);
  ledger.starts.set(taskId, { parent, at: now });
  return undefined;
}

/** Narrow the new child's tool filter (Pi's `pi.agent` `tools`, by name) to `allowed`: the intersection with what it would enable. */
async function allowTools(tx: Tx, childId: ConversationId, allowed: readonly string[], api: ToolExecutionApi): Promise<void> {
  const state = await tx.doc(AgentDoc, childId);
  const allow = new Set(allowed), current = state.tools;
  if (Array.isArray(current)) { state.tools = current.filter(tool => allow.has(tool)); return; }
  // Unset or `{ remove }`: every enabled tool (minus the removed), in registry order, kept to the allowed names.
  const removed = new Set(current?.remove ?? []);
  state.tools = [...new Set(api.registry.tools().map(({ tool }) => tool.name))].filter(tool => allow.has(tool) && !removed.has(tool));
}

const runShape = (live: Readonly<LiveState> | null): string => JSON.stringify([live?.run?.taskId ?? null, live?.generation?.attempt ?? null, live?.generation?.message === undefined,
  (live?.tools ?? []).map(slot => `${slot.callId}:${slot.status}`)]);

/** `change` with the parent's guard extensions appended to its extension selection (an array or `add`; an unset selection already inherits the parent's). */
function withGuards(change: AgentChange, guards: readonly Extension[]): AgentChange {
  const { extensions } = change;
  if (!guards.length || extensions === undefined || extensions === null) return change;
  if (Array.isArray(extensions)) return { ...change, extensions: [...extensions, ...guards.filter(guard => !extensions.some(own => own.name === guard.name))] };
  const selection = extensions as { readonly add?: readonly Extension[]; readonly remove?: readonly Extension[] };
  const present = selection.add ?? [];
  return { ...change, extensions: { ...selection, add: [...present, ...guards.filter(guard => !present.some(own => own.name === guard.name))] } };
}
