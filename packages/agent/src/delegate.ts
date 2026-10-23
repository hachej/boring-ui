import { AssistantEntry, LiveDoc, UsageDoc, configure, defineTool } from '@earendil-works/pi-durable';
import type { AgentChange, ConversationId, Cursor, EntryId, Extension, LiveState, ToolExecutionApi, ToolRegistration, Tx } from '@earendil-works/pi-durable';
import type { Context } from '@earendil-works/chord';
import { Type } from '@earendil-works/pi-ai';

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
}

/**
 * Pi's subagent pattern (pi-durable README "Abort and Subagents") as a tool factory: the child is a conversation owned by the
 * calling tool task (`ownership: { kind: 'task', taskId }`), so aborting the call aborts the child and the parent is idle only
 * once the child is. Replay-safe: a rerun of the same tool task (after a crash or eviction) finds its child through the native
 * ownership index and its submission through the request id, so it never starts a second child or a second turn. Returns only the
 * child's final text. The child inherits the parent's approval and sandbox extensions (appended after its own, in the parent's order, so a
 * sandbox stays last), so a delegate cannot escape the parent's gate; `details` is a `DelegateDetails` (live while the child runs) for a UI that shows it.
 * `onChild` lets the host write the parent's identity onto the child in the same commit that creates it.
 */
export function createDelegateTool(options: DelegateOptions): ToolRegistration {
  const name = options.name ?? DELEGATE_TOOL;
  // A task-owned conversation starts as a copy of its owner's agent; reset the inherited filters so the child's own extensions are
  // its whole toolset, then apply the child agent. `cwd` stays inherited unless the child agent sets one.
  const child: AgentChange = { tools: null, modelTools: null, instructions: null, thinkingLevel: null, ...options.agent.agent };
  return defineTool({
    name,
    description: options.description ?? `Delegate a self-contained task to the ${options.agent.id} agent and get its final answer back.`,
    parameters: Type.Object({ task: Type.String({ minLength: 1, description: 'The complete task; the agent sees nothing else of this conversation.' }) }, { additionalProperties: false }),
    replay: 'safe',
    execute: async (args, api, context) => {
      const inherited = (await api.agent(context)).extensions.filter(isGuard);
      const agent = withGuards(child, inherited);
      const childId: ConversationId = await api.commit(async tx => {
        const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
        if (existing !== undefined) return existing.id;
        const created = await tx.createConversation({ ownership: { kind: 'task', taskId: api.taskId } });
        await configure(tx, created.id, agent);
        await options.onChild?.(api.conversationId, created.id, tx);
        return created.id;
      }, context);
      const startedAt = await api.memo('delegate.startedAt', Date.now(), context);
      const progress = childProgress(api, childId);
      const details = (status: DelegateStatus, counts: Counts, error?: string): DelegateDetails => ({
        kind: DELEGATE_DETAILS_KIND, version: 1, agent: options.agent.id, conversationId: childId, status, startedAt,
        durationMs: Math.max(1, Date.now() - startedAt), ...counts, ...(error === undefined ? {} : { error }) });
      const initial = await progress.read(context);
      await api.details(details('running', initial), context);
      const conversation = await api.conversation(childId, context);
      if (conversation === undefined) throw new Error(`Delegate conversation ${childId} is missing`);
      const submission = await conversation.submit({ type: 'input', content: args.task, requestId: `${name}:${api.taskId}` }, context);
      const live = await publishLive(api, childId, progress, initial, counts => api.details(details('running', counts), context), context);
      // A stopped call ends here: Pi writes its aborted result from the slot, so its details stay the last `running` value.
      const settled = await submission.wait(context).finally(() => live.stop());
      const counts = await progress.read(context);
      if (settled.status !== 'done' || settled.type !== 'input') {
        const reason = settled.status === 'unanswered' ? settled.reason : settled.status;
        const detail = settled.status === 'unanswered' && typeof settled.detail === 'string' && settled.detail ? settled.detail : undefined;
        const error = `The ${options.agent.id} agent did not answer: ${reason}${detail ? ` (${detail})` : ''}`;
        return { output: [{ type: 'text', text: error }], isError: true, details: reason === 'aborted' ? details('cancelled', counts) : details('failed', counts, error) };
      }
      const answer = await api.commit(tx => tx.entry(AssistantEntry, settled.answer), context);
      const message = answer?.model?.find(part => part.role === 'assistant');
      const text = message?.role === 'assistant' ? message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n') : '';
      return { output: [{ type: 'text', text }], details: details('done', counts) };
    },
  });
}

type Counts = Pick<DelegateDetails, 'toolCalls' | 'tokens'>;

/**
 * The child's counts from its native records: tool calls from its committed assistant entries (scanned once, incrementally,
 * through the invocation's commit), tokens from its `pi.usage` (Pi's `UsageDoc`, both buckets).
 */
function childProgress(api: ToolExecutionApi, childId: ConversationId) {
  let toolCalls = 0, after: EntryId | undefined;
  return {
    async read(context: Context): Promise<Counts> {
      const scanned = await api.commit(async tx => {
        let found = 0, last = after, cursor: Cursor | undefined;
        do {
          const page = await tx.scanEntries({ conversationId: childId, order: 'ascending', ...(last === undefined ? {} : { minEntryId: (last + 1) as EntryId }) }, 100, cursor);
          for (const entry of page.items) {
            last = entry.id;
            for (const message of entry.model ?? []) if (message.role === 'assistant') found += message.content.filter(part => part.type === 'toolCall').length;
          }
          cursor = page.next;
        } while (cursor !== undefined);
        return { found, last };
      }, context);
      toolCalls += scanned.found; after = scanned.last;
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
