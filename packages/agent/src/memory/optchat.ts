// OptChat memory as one native pi-durable extension, opt-in per conversation.
// The Pi transcript is the append-only log and is never rewritten. While the extension is selected, `beforeRequest` shows
// the model one view of everything before the current turn: a tiling of the log by summary-tree nodes, one `id+n|text`
// line each. The current turn (the latest user message and the steps after it) stays verbatim, and every positional
// system message is kept. Summaries are made by native pi-durable tasks (one background task per node, shipped in the
// extension's `tasks`, so Pi schedules, runs and recovers them) and stored in a conversation document family.
// Idea, algorithm and prompts: Victor Taelin's OptChat, https://gist.github.com/VictorTaelin/91837951a5ce5b38f341ec1ba1df6449
import { CompactionTask, GenerationTask, defineDoc, defineDocFamily, defineExtension, defineTask, defineTool, hook, section } from '@earendil-works/pi-durable';
import type { Conversation, ConversationId, Extension, Harness, ModelRef, TaskId, Tx } from '@earendil-works/pi-durable';
import type { Context } from '@earendil-works/chord';
import { withAbortSignal, withCancel } from '@earendil-works/chord/context';
import { Type } from '@earendil-works/pi-ai';
import type { Message, Models, Usage, UserMessage } from '@earendil-works/pi-ai';
import {
  DEFAULTS, OptChatLog, OptChatTree, advanceFold, bareLines, byteLength, compactPrompt, cutBytes, dateText, emptyFold, leavesOf,
  nodeKey, openParts, partStart, renderView, scaleLine, span, viewDoc, zoomText,
} from './optchat-core.js';
import type { Leaf, StoredNode, ViewFold } from './optchat-core.js';

export { DEFAULTS as OPTCHAT_DEFAULTS, PLACEHOLDER as OPTCHAT_PLACEHOLDER, compactPrompt, viewDoc } from './optchat-core.js';
export { OptChatLog, OptChatTree, advanceFold, emptyFold, leavesOf, renderView, zoomText, dateText } from './optchat-core.js';
export type { Leaf, LeafKind, Part, StoredNode, ViewFold } from './optchat-core.js';

type NodeShard = { nodes: Record<string, { text: string; of: string }> };
/** Summaries of one conversation, in shards of 64 nodes per level (`<level>.<shard>`). A fork starts with the current ones; fingerprints reject any that no longer match. */
export const OptChatNodes = defineDocFamily<NodeShard, number>({
  kind: 'boring.memory.optchat.nodes', version: 1, family: true, scope: 'conversation', history: 'latest', fork: 'current', initial: () => ({ nodes: {} }),
});

type Ledger = { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
type Failure = { at: number; of: string; error: string };
type StateDoc = { calls: number; usage: Ledger; failures: Record<string, Failure> };
/** Compactor bookkeeping of one conversation: the summarizer's calls and spend, and the last failure of each node (the retry spacing reads it; no timer does). */
export const OptChatState = defineDoc<StateDoc>({
  kind: 'boring.memory.optchat.state', version: 1, scope: 'conversation', history: 'latest', fork: 'initial',
  initial: () => ({ calls: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }, failures: {} }),
});
/** Input of one summary task. `key` is `level:index:fingerprint`; `upTo` is how much of the log the view context may use. */
type NodeInput = { key: string; level: number; index: number; of: string; upTo: number };
type NodeResult = { built: boolean };
const SHARD = 64;
const shardKey = (level: number, index: number): string => `${level}.${Math.floor(index / SHARD)}`;

/** One summary to write: a message to compress (`source` is its whole `kind: text`) or two adjacent lines to merge. */
export interface SummaryJob {
  /** The conversation whose memory this node belongs to. */
  readonly conversationId: ConversationId;
  readonly level: number;
  readonly index: number;
  /** The leaves the node covers: first and last id. */
  readonly range: readonly [number, number];
  readonly source: readonly string[];
  /** The view's lines before the node, bare and without ids. */
  readonly context: string;
  readonly nodeBytes: number;
}

export interface OptChatOptions {
  /** The harness the extension is installed in (read when needed, so it may open after this call). */
  readonly harness: () => Harness;
  /** Long-lived context for host work (creating summary tasks and waiting for them outlive any one request). */
  readonly context: Context;
  /**
   * Who writes the summaries (required: the reference never shows cut text, so there is no clipping fallback). Either a
   * model, called with the reference protocol (a cheap one is best; a function may follow the conversation's model), or
   * your own `summarize(job, signal)` returning one line, which is trimmed and cut to `nodeBytes`.
   * Summarizer spend is kept in this extension's own state document and reported by `stats().compactor.usage`. It is not in
   * Pi's `pi.usage`: Pi has no public way for a task to record model usage (BORING-PI-4), so that guarantee is unavailable.
   * `models` is optional: it defaults to the Harness's own models.
   */
  readonly summarizer:
    | { readonly models?: Models; readonly model: ModelRef | ((conversationId: ConversationId) => ModelRef | Promise<ModelRef>) }
    | { readonly summarize: (job: SummaryJob, signal: AbortSignal) => Promise<string> };
  /** Native extension name. Default `boring.memory.optchat`. */
  readonly name?: string;
  /** What the prompts call the agent. Default `OptChat`. */
  readonly agentName?: string;
  readonly nodeBytes?: number;
  readonly viewBytes?: number;
  /** At most this many summary tasks of one conversation are live at once: the host's admission cap, not a scheduler (Pi runs the tasks). */
  readonly jobs?: number;
  readonly tries?: number;
  readonly cap?: number;
  readonly retryMs?: number;
  /** How long a request waits for the summaries its view needs before it shows `(not summarized yet: zoom it)` for the rest. */
  readonly settleTimeoutMs?: number;
  /** A node failed (reported once per failure streak of a node; the next trigger after `retryMs` creates its task again). */
  readonly onError?: (error: unknown, node: { conversationId: ConversationId; level: number; index: number }) => void;
}

export interface OptChatStats {
  /** Messages in the log (Pi messages split into user, talk, tool and echo leaves). */
  readonly leaves: number;
  /** Stored summaries whose fingerprint matches the log. */
  readonly summaries: number;
  readonly view: {
    /** Bytes of the view's lines (what `budget` limits), without the `<chat>` wrapper. */
    readonly bytes: number;
    readonly budget: number;
    /** Lines the next request would show, oldest first. `id` and `n` as in `id+n`. */
    readonly parts: readonly { readonly id: number; readonly n: number; readonly level: number; readonly text: string; readonly open: boolean }[];
    /** Lines still waiting for a summary. */
    readonly open: number;
  };
  readonly compactor: {
    /** Live summary tasks (pending, running or waiting) in Pi's native state. */
    readonly busy: number;
    /** Failed nodes still inside their `retryMs` window. */
    readonly retrying: number;
    /** Failed nodes (last failure kept in the conversation's state document until the node is built). */
    readonly failed: number;
    readonly idle: boolean;
    readonly error?: string;
    /** Summarizer calls made for this conversation (from the state document, so it survives a restart). */
    readonly calls: number;
    /** Spend of those calls (kept by this extension; not in Pi's `pi.usage`). */
    readonly usage: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number; readonly cost: number };
  };
  /** The last request this extension rewrote. */
  readonly lastRequest?: {
    readonly at: string;
    /** Leaves before the current turn: what the view covers. */
    readonly covered: number;
    readonly requestMessages: number;
    readonly logMessages: number;
    readonly viewBytes: number;
    readonly waitedMs: number;
    /** False if the wait timed out and the view shows placeholders. */
    readonly settled: boolean;
  };
}

export interface OptChatMemory {
  /** Install in the harness registry, then select per conversation: `conversation.configure({ extensions: { add: [memory.extension] } }, context)`. */
  readonly extension: Extension;
  /** Create summary tasks for the whole log and wait for them until nothing is left to build (nodes waiting to be retried do not block). */
  nap(conversationId: ConversationId): Promise<void>;
  /** The view the next request would show, summary coverage and compactor state. Reads the log; changes nothing. */
  stats(conversationId: ConversationId): Promise<OptChatStats>;
  /** The same text as the `zoom` tool. */
  zoom(conversationId: ConversationId, id: number, n: number): Promise<string>;
  /** The same text as the `date` tool. */
  date(conversationId: ConversationId, id: number): Promise<string>;
  /** Drop in-memory state of a conversation (stored summaries stay). */
  forget(conversationId: ConversationId): void;
  /** Stop this process's waits. Summary tasks belong to Pi, which keeps or recovers them; harmless to skip, and safe to call before closing the harness. */
  dispose(): Promise<void>;
}

class Session {
  readonly log = new OptChatLog();
  readonly stored = new Map<string, StoredNode>();
  readonly tree: OptChatTree;
  fold: ViewFold = emptyFold();
  /** Summary tasks may be created for leaves below this; the current turn's steps are held back while a request runs. */
  upTo = 0;
  lastRequest: OptChatStats['lastRequest'];
  constructor(readonly id: ConversationId, nodeBytes: number) { this.tree = new OptChatTree(this.log, this.stored, nodeBytes); }

  /** Take the log of a request or a context read; a changed history drops the fold (summaries stay, checked by fingerprint). */
  sync(leaves: readonly Leaf[]): void {
    const before = this.log.leaves.length;
    if (this.log.set(leaves) < before) { this.tree.reset(); this.fold = emptyFold(); }
  }
}

const message = (text: string[]): UserMessage => ({ role: 'user', content: text.map(part => ({ type: 'text' as const, text: part })), timestamp: Date.now() });
const LIVE = ['pending', 'running', 'waiting'] as const;

const addUsage = (sum: Usage | undefined, usage: Usage): Usage => {
  if (!sum) return structuredClone(usage);
  sum.input += usage.input; sum.output += usage.output; sum.cacheRead += usage.cacheRead; sum.cacheWrite += usage.cacheWrite; sum.totalTokens += usage.totalTokens;
  if (usage.cacheWrite1h !== undefined) sum.cacheWrite1h = (sum.cacheWrite1h ?? 0) + usage.cacheWrite1h;
  if (usage.reasoning !== undefined) sum.reasoning = (sum.reasoning ?? 0) + usage.reasoning;
  sum.cost.input += usage.cost.input; sum.cost.output += usage.cost.output; sum.cost.cacheRead += usage.cost.cacheRead; sum.cost.cacheWrite += usage.cost.cacheWrite; sum.cost.total += usage.cost.total;
  return sum;
};

/** The model's side of one node: what it spent (also on a failed attempt) and the line, or why there is none. */
interface Summary { readonly text?: string; readonly error?: unknown; readonly usage?: Usage; readonly calls: number; readonly spender?: string }

export function createOptChatMemory(options: OptChatOptions): OptChatMemory {
  const nodeBytes = options.nodeBytes ?? DEFAULTS.nodeBytes, viewBytes = options.viewBytes ?? DEFAULTS.viewBytes, jobs = options.jobs ?? DEFAULTS.jobs;
  const tries = options.tries ?? DEFAULTS.tries, cap = options.cap ?? DEFAULTS.cap, retryMs = options.retryMs ?? DEFAULTS.retryMs, settleMs = options.settleTimeoutMs ?? DEFAULTS.settleTimeoutMs;
  const agentName = options.agentName ?? 'OptChat';
  const extensionName = options.name ?? 'boring.memory.optchat';
  const taskKind = `${extensionName}.node`;
  const system = compactPrompt(agentName);
  const scale = scaleLine(nodeBytes);
  const sessions = new Map<string, Session>();
  const aborter = new AbortController();
  const hostContext = withAbortSignal(aborter.signal, options.context);

  const session = (id: ConversationId): Session => {
    let found = sessions.get(String(id));
    if (!found) sessions.set(String(id), found = new Session(id, nodeBytes));
    return found;
  };

  /** Read the stored summaries. Tasks write them (in this process or another, before or after a restart), so every read goes to the documents. */
  async function loadStored(s: Session, reader: Pick<Harness, 'snapshot'>, context: Context): Promise<void> {
    const total = s.log.leaves.length;
    for (let level = 0; span(level) <= total; level++) {
      const nodes = Math.floor(total / span(level));
      for (let shard = 0; shard * SHARD < nodes; shard++) {
        const doc = await reader.snapshot(OptChatNodes, s.id, `${level}.${shard}`, context);
        for (const [index, node] of Object.entries(doc?.nodes ?? {})) s.stored.set(nodeKey(level, Number(index)), node);
      }
    }
  }

  async function conversationOf(id: ConversationId): Promise<Conversation> {
    const found = await options.harness().conversation(id, options.context);
    if (!found) throw new Error(`No conversation ${String(id)}`);
    return found;
  }

  /** Bring a session up to date with the committed context and its stored summaries. */
  async function refresh(id: ConversationId): Promise<Session> {
    const s = session(id);
    const view = await (await conversationOf(id)).context(options.context);
    s.sync(leavesOf(view.messages, cap).leaves);
    await loadStored(s, options.harness(), options.context);
    return s;
  }

  // ---- The summarizer (runs inside the native task) ----------------------------------------------------------------------

  /** One node by the reference protocol (§4.2, §4.3): context first, then the step; over-long lines are resubmitted cut at the limit; the shortest wins. */
  async function askModel(job: SummaryJob, runtimeModels: Models, signal: AbortSignal): Promise<Summary> {
    const summarizer = options.summarizer;
    if ('summarize' in summarizer) {
      try { return { text: cutBytes((await summarizer.summarize(job, signal)).trim(), nodeBytes), calls: 1 }; } catch (error) { if (signal.aborted) throw error; return { error, calls: 1 }; }
    }
    const models = summarizer.models ?? runtimeModels;
    const ref = typeof summarizer.model === 'function' ? await summarizer.model(job.conversationId) : summarizer.model;
    const model = models.getModel(ref.provider, ref.modelId);
    if (!model) throw new Error(`Summarizer model ${ref.provider}/${ref.modelId} is not available`);
    const lines = job.source.map(line => line.replace(/\r?\n/g, ' '));
    const step = `For scale, this line is exactly ${scale.bytes} bytes:\n${scale.text}\n\n` + (job.level === 0
      ? `Compress this message into one line, in at most ${nodeBytes} bytes:\n${job.source[0]}`
      : `Merge these two lines into one, in at most ${nodeBytes} bytes:\n${lines.join('\n')}`);
    const conversation: Message[] = [message([`<chat>\n${job.context}\n</chat>`, step])];
    const attempts: string[] = [];
    let usage: Usage | undefined, calls = 0, spender: string | undefined;
    try {
      for (;;) {
        const reply = await models.complete(model, { systemPrompt: system, messages: conversation }, { signal });
        calls++; spender = `${reply.provider}/${reply.model}`; usage = addUsage(usage, reply.usage);
        if (reply.stopReason === 'error' || reply.stopReason === 'aborted') throw new Error(reply.errorMessage ?? `Summarizer stopped: ${reply.stopReason}`);
        const line = reply.content.filter(part => part.type === 'text').map(part => part.text).join('\n').trim();
        if (!line) throw new Error('The summarizer returned nothing');
        attempts.push(line);
        if (byteLength(line) <= nodeBytes || attempts.length >= tries) break;
        conversation.push(reply, message([`That line is ${byteLength(line)} bytes; the limit is ${nodeBytes}. It must end where it is cut here:\n${cutBytes(line, nodeBytes)}| ← LIMIT`]));
      }
    } catch (error) {
      if (signal.aborted) throw error;
      return { error, ...(usage ? { usage } : {}), calls, ...(spender ? { spender } : {}) };
    }
    return { text: attempts.reduce((best, line) => byteLength(line) < byteLength(best) ? line : best), ...(usage ? { usage } : {}), calls, ...(spender ? { spender } : {}) };
  }

  /** What one node task adds to the conversation's documents in its single commit: calls, spend and the node or its failure. */
  async function bookkeeping(tx: Tx, id: ConversationId, summary: Summary): Promise<StateDoc> {
    const state = await tx.doc(OptChatState, id);
    state.calls += summary.calls;
    if (summary.usage && summary.spender) {
      const u = summary.usage;
      state.usage.input += u.input; state.usage.output += u.output; state.usage.cacheRead += u.cacheRead; state.usage.cacheWrite += u.cacheWrite; state.usage.cost += u.cost.total;
    }
    return state as StateDoc;
  }

  const NodeTask = defineTask<NodeInput, { phase: 'summarize' }, NodeResult>({
    name: taskKind, version: 1, initial: () => ({ phase: 'summarize' }),
    phases: {
      summarize: async (running, runtime, context) => {
        const { level, index, of, upTo } = running.input, id = runtime.conversationId;
        // Nothing to write; a model call that already ran still books its spend.
        const stale = (summary?: Summary) => runtime.commit(async tx => {
          if (summary) await bookkeeping(tx, id, summary);
          return { status: 'terminal', outcome: { status: 'completed', result: { built: false } } };
        }, context);
        // A private view of this conversation: a request may be folding and rendering the shared session right now.
        const s = new Session(id, nodeBytes);
        const load = async () => {
          s.sync(leavesOf((await runtime.context(id, context)).messages, cap).leaves);
          await loadStored(s, runtime, context);
        };
        await load();
        const ready = () => s.log.fp(level, index) === of && (level === 0 || (s.tree.text(level - 1, 2 * index) !== undefined && s.tree.text(level - 1, 2 * index + 1) !== undefined));
        if (!ready() || s.tree.text(level, index) !== undefined) return stale(); // the history changed, a child is missing, or the node needs no summary
        const to = Math.min(upTo, s.log.leaves.length);
        if (s.fold.T > to) s.fold = emptyFold();
        advanceFold(s.fold, s.tree, to, viewBytes);
        const source = level === 0 ? [s.log.leaves[index]!.line] : [s.tree.text(level - 1, 2 * index)!, s.tree.text(level - 1, 2 * index + 1)!];
        const job: SummaryJob = { conversationId: id, level, index, range: [index * span(level), (index + 1) * span(level) - 1], source, context: bareLines(s.fold, s.tree, level === 0 ? index : (index + 1) * span(level)), nodeBytes };
        const summary = await askModel(job, runtime.models, runtime.signal);
        await load();
        if (!ready()) return stale(summary); // the history changed while the model ran: its line is dropped, its spend is kept
        let firstFailure = false;
        await runtime.commit(async tx => {
          const state = await bookkeeping(tx, id, summary);
          if (summary.text === undefined) {
            firstFailure = state.failures[`${level}:${index}`]?.of !== of;
            state.failures[`${level}:${index}`] = { at: Date.now(), of, error: String((summary.error as Error)?.message ?? summary.error) };
            return { status: 'terminal', outcome: { status: 'failed', error: { message: state.failures[`${level}:${index}`]!.error } } };
          }
          const doc = await tx.doc(OptChatNodes, id, shardKey(level, index), 0);
          doc.nodes[String(index)] = { text: summary.text, of };
          delete state.failures[`${level}:${index}`];
          return { status: 'terminal', outcome: { status: 'completed', result: { built: true } } };
        }, context);
        if (firstFailure) try { options.onError?.(summary.error, { conversationId: id, level, index }); } catch { /* a reporter must not stop a task */ }
      },
    },
    abort: async (_running, runtime, context) => { await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), context); },
  });

  // ---- Admission and waiting ---------------------------------------------------------------------------------------------

  /** Nodes that could be built now: sources exist and the whole preceding view is summarized (§4.1), oldest first. */
  function candidates(s: Session): { level: number; index: number }[] {
    const upTo = Math.min(s.upTo, s.log.leaves.length);
    advanceFold(s.fold, s.tree, upTo, viewBytes);
    const open = openParts(s.fold)[0];
    const first = open ? partStart(open) : s.fold.T;
    const found: { level: number; index: number }[] = [];
    for (let level = 0; span(level) <= upTo; level++) {
      for (let index = 0; (index + 1) * span(level) <= upTo; index++) {
        const end = level === 0 ? index : (index + 1) * span(level);
        if (end > first) break;
        if (s.tree.text(level, index) !== undefined) continue;
        if (level > 0 && (s.tree.text(level - 1, 2 * index) === undefined || s.tree.text(level - 1, 2 * index + 1) === undefined)) continue;
        found.push({ level, index });
      }
    }
    return found;
  }

  interface Admission { readonly live: ReadonlyMap<string, TaskId<NodeResult>>; readonly created: number; readonly waiting: number }

  /**
   * Make sure every node that can be built has one live background task, up to `jobs` live tasks of the conversation. Host
   * admission only: Pi schedules and runs the tasks. One live task per node key (found by scanning native tasks in the same
   * commit that creates them); a node whose last failure is inside `retryMs` is left for the next trigger.
   */
  async function admit(s: Session, skip: ReadonlySet<string>): Promise<Admission> {
    const wanted = candidates(s).map(({ level, index }) => ({ level, index, of: s.log.fp(level, index)! }));
    const failures = (await options.harness().snapshot(OptChatState, s.id, options.context))?.failures ?? {};
    const now = Date.now(), upTo = Math.min(s.upTo, s.log.leaves.length);
    const conversation = await conversationOf(s.id);
    let waiting = 0, created = 0;
    const live = await conversation.commit(async tx => {
      const found = new Map<string, TaskId<NodeResult>>();
      for (const status of LIVE) {
        let cursor;
        do {
          const page = await tx.scanTasks({ conversationId: s.id, kind: taskKind, status }, 200, cursor);
          for (const task of page.items) found.set((task.input as NodeInput).key, task.id as TaskId<NodeResult>);
          cursor = page.next;
        } while (cursor);
      }
      for (const node of wanted) {
        if (found.size >= jobs) break;
        const key = `${nodeKey(node.level, node.index)}:${node.of}`;
        if (found.has(key) || skip.has(key)) continue;
        const failure = failures[nodeKey(node.level, node.index)];
        if (failure && failure.of === node.of && now - failure.at < retryMs) { waiting++; continue; }
        found.set(key, await tx.createTask(NodeTask, { key, level: node.level, index: node.index, of: node.of, upTo }, { ownership: { kind: 'conversation' }, background: true }));
        created++;
      }
      return found;
    }, options.context);
    return { live, created, waiting };
  }

  /** Wait (natively, `waitForTask`) until one of the tasks settles, or `ms` pass or the context ends. Returns what settled, if anything. */
  async function settleAny(ids: readonly TaskId<NodeResult>[], ms: number | undefined, context: Context): Promise<{ key: string; built: boolean } | undefined> {
    const { context: waiter, cancel } = withCancel(withAbortSignal(aborter.signal, context));
    const timer = ms === undefined ? undefined : setTimeout(cancel, Math.max(0, ms));
    try {
      const done = await Promise.race(ids.map(id => options.harness().waitForTask(id, waiter).then(task => ({ key: (task.input as NodeInput).key, built: task.state.outcome.status === 'completed' && (task.state.outcome.result as NodeResult | undefined)?.built === true }), () => undefined)));
      return done;
    } finally { if (timer) clearTimeout(timer); cancel(); }
  }

  async function nap(id: ConversationId): Promise<void> {
    const s = await refresh(id);
    s.upTo = s.log.leaves.length;
    const skip = new Set<string>();
    for (;;) {
      const { live } = await admit(s, skip);
      if (live.size === 0) return;
      const done = await settleAny([...live.values()], undefined, hostContext);
      if (!done) return; // disposed
      if (!done.built) skip.add(done.key);
      await loadStored(s, options.harness(), options.context);
    }
  }

  /** Wait until every line of the view is a summary (§6). Never shows cut text: on timeout the rest shows the placeholder. */
  async function settle(s: Session, covered: number, context: Context): Promise<boolean> {
    const deadline = Date.now() + settleMs, skip = new Set<string>();
    for (;;) {
      await loadStored(s, options.harness(), options.context);
      advanceFold(s.fold, s.tree, covered, viewBytes);
      const open = openParts(s.fold).length;
      if (open === 0 && s.fold.size <= viewBytes) return true;
      const { live } = await admit(s, skip);
      if (open === 0 && live.size === 0) return true;
      if (live.size === 0) return false; // nothing to wait for: every missing node is inside its retry window
      const left = deadline - Date.now();
      if (left <= 0 || context.abortSignal?.aborted) return false;
      const done = await settleAny([...live.values()], left, context);
      if (done && !done.built) skip.add(done.key);
    }
  }

  // ---- The extension -----------------------------------------------------------------------------------------------------

  const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });
  const zoomTool = defineTool({
    name: 'zoom',
    description: 'Open the line id+n of the view into the two lines of n/2 under it; n = 1 gives the message whole.',
    parameters: Type.Object({ id: Type.Integer({ minimum: 0 }), n: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }),
    replay: 'safe',
    execute: async ({ id, n }, api) => text(zoomText((await refresh(api.conversationId)).tree, id, n)),
  });
  const dateTool = defineTool({
    name: 'date',
    description: 'The date and time of message id.',
    parameters: Type.Object({ id: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }),
    replay: 'safe',
    execute: async ({ id }, api) => text(dateText((await refresh(api.conversationId)).log, id)),
  });

  const extension = defineExtension({
    name: extensionName,
    tools: [zoomTool, dateTool],
    sections: [section('optchat-view', () => viewDoc(agentName), { tag: false })],
    tasks: [NodeTask],
    hooks: [
      hook(GenerationTask, {
        beforeRequest: async (request, api, context) => {
          const { leaves, before } = leavesOf(request.messages, cap);
          const last = request.messages.findLastIndex(item => item.role === 'user');
          const covered = last < 0 ? 0 : before[last]!;
          if (covered === 0) return undefined; // nothing came before this turn
          const s = session(api.conversationId);
          s.sync(leaves);
          s.upTo = covered;
          if (s.fold.T > covered) s.fold = emptyFold();
          const started = Date.now();
          const settled = await settle(s, covered, context);
          const view = renderView(s.fold, s.tree);
          const messages = request.messages.flatMap((item, index): Message[] => {
            if (index < last) return item.role === 'system' ? [item] : [];
            if (index > last) return [item];
            const user = item as UserMessage;
            const body = typeof user.content === 'string' ? [{ type: 'text' as const, text: user.content }] : user.content;
            return [{ ...user, content: [{ type: 'text', text: view }, ...body] }];
          });
          s.lastRequest = { at: new Date().toISOString(), covered, requestMessages: messages.length, logMessages: request.messages.length, viewBytes: byteLength(view), waitedMs: Date.now() - started, settled };
          return { messages };
        },
        // A finished answer: once the run has committed it, create its summary tasks (background, so they never hold the run) so the next request finds its view ready.
        onYield: (_answer, api) => {
          void (async () => { await (await conversationOf(api.conversationId)).waitForIdle(hostContext); await nap(api.conversationId); })().catch(() => { /* a failed node is in the state document; the next trigger retries it */ });
          return undefined;
        },
      }),
      // A native compaction summary would cut the transcript this view is built from; the view replaces it while this extension is selected.
      hook(CompactionTask, { beforeCompact: () => ({ decline: true }) }),
    ],
  });

  return {
    extension,
    nap: id => nap(id),
    async stats(id) {
      const s = await refresh(id);
      const fold: ViewFold = { T: s.fold.T, size: s.fold.size, parts: s.fold.parts.map(part => ({ ...part })) };
      advanceFold(fold, s.tree, s.log.leaves.length, viewBytes);
      let summaries = 0;
      for (const [key, node] of s.stored) { const [level, index] = key.split(':').map(Number); if (node.of === s.log.fp(level!, index!)) summaries++; }
      const state = await options.harness().snapshot(OptChatState, id, options.context);
      const failures = Object.entries(state?.failures ?? {}).filter(([key, failure]) => { const [level, index] = key.split(':').map(Number); return failure.of === s.log.fp(level!, index!); }).map(([, failure]) => failure);
      const busy = (await options.harness().inspect(options.context)).tasks.filter(task => task.record.kind === taskKind && task.record.conversationId === id).length;
      const retrying = failures.filter(failure => Date.now() - failure.at < retryMs).length;
      const latest = failures.reduce<Failure | undefined>((best, failure) => !best || failure.at > best.at ? failure : best, undefined);
      return {
        leaves: s.log.leaves.length, summaries,
        view: { bytes: fold.size, budget: viewBytes, open: openParts(fold).length,
          parts: fold.parts.map(part => ({ id: partStart(part), n: span(part.level), level: part.level, text: s.tree.text(part.level, part.index) ?? '', open: part.open })) },
        compactor: { busy, retrying, failed: failures.length, idle: busy === 0 && retrying === 0, ...(latest ? { error: latest.error } : {}), calls: state?.calls ?? 0, usage: { ...(state?.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }) } },
        ...(s.lastRequest ? { lastRequest: s.lastRequest } : {}),
      };
    },
    async zoom(id, nth, n) { return zoomText((await refresh(id)).tree, nth, n); },
    async date(id, nth) { return dateText((await refresh(id)).log, nth); },
    forget(id) { sessions.delete(String(id)); },
    async dispose() { aborter.abort(); },
  };
}
