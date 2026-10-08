// @hachej/boring-agent/metering: the host's credit ledger fed from native Pi state. Pi has no hook that can hold or refuse a model request
// (`GenerationHooks.beforeRequest` only replaces messages, `afterResponse` observes), so the fence is submission admission: a run is
// reserved before its input reaches the native conversation, and refused input never reaches it. Usage is then read from the durable
// transcript (the assistant entries, and tool results carrying `usage`, of the run) under stable native ids, and every run ends in
// exactly one settle or release. The host owns the ledger (`MeteringSink`), the price and the policy; this module owns only when to call it.
// See packages/agent/README.md ("Metering") for the rules.
import type { Context } from '@earendil-works/chord';
import { AssistantEntry, UserEntry } from '@earendil-works/pi-durable';
import type { Conversation, ConversationWatch, EntryRecord, Harness, Submission, SubmissionDraft, SubmissionRecord } from '@earendil-works/pi-durable';
import type { Models, Usage } from '@earendil-works/pi-ai';
import { calculateCost } from '@earendil-works/pi-ai/models';
import { openNodeConnection, type SqliteConnection, type SqliteSettings } from '@hachej/boring-files/sqlite';

/** Small flat JSON-safe values the host passes through untouched (a plan, a tenant): at most 16 keys, strings of at most 256 characters. */
export type MeteringAttributes = Readonly<Record<string, string | number | boolean>>;
/** Who a run is for, as the host maps its own authentication: the person, optionally the workspace, and pass-through attributes. */
export interface MeteringScope {
  readonly userId: string;
  readonly workspaceId?: string;
  readonly attributes?: MeteringAttributes;
}
/** The host's scope plus which native submission a run is. `runId` is derived from the conversation and the submission's request ID. */
export interface MeteringRunScope extends MeteringScope {
  readonly conversationId: number;
  readonly requestId: string;
  readonly runId: string;
}
/** A model as pi-ai names it (`provider`, model `id`). */
export interface MeteringModel { readonly provider: string; readonly id: string }
/**
 * The native submission kind of the input: `input` starts a run (or queues as one); `followUp` and `steer` are the input's
 * `whenBusy` choice, joining a busy conversation after or into its current run (the kind the client asked for: on an idle
 * conversation Pi starts a run with it all the same).
 */
export type MeteringSubmissionKind = 'input' | 'followUp' | 'steer';
export interface MeteringReserveInput extends MeteringRunScope {
  /** The model the run will use: the conversation's selected model, resolved through Pi (`Conversation.agent`) at submit time. Absent when none is selected. */
  readonly model?: MeteringModel;
  readonly kind: MeteringSubmissionKind;
  /** The input's text, whitespace collapsed and cut to `MESSAGE_PREVIEW_LENGTH` characters (`[image]` for an image part), for logs and policy. */
  readonly message: string;
  /** The input as submitted, for a host that sizes holds by it. */
  readonly content: unknown;
}
export type MeteringReservation = { readonly reservationId?: string } | { readonly kind: 'refused'; readonly reason: string };
export interface MeteringUsageInput extends MeteringRunScope {
  readonly reservationId?: string;
  /** Stable idempotency key: the native entry that carries the usage (`entry:<conversation>:<entry>`). */
  readonly usageId: string;
  /** The model of this usage report (a run can switch models mid-run); absent for a tool's own usage. */
  readonly model?: MeteringModel;
  /** `model:<provider>/<id>` or `tool:<name>`, as Pi keys `pi.usage`. */
  readonly bucket: string;
  readonly usage: Usage;
  /** The host's price for this usage, markup included, in the ledger's unit (micros). */
  readonly amountMicros: number;
}
export interface MeteringSettleInput extends MeteringRunScope {
  readonly reservationId?: string;
  readonly status: 'done' | 'unanswered';
}
/**
 * `fallback-charge` and `usage-write-failed` charge the hold (the run did work it cannot account for); every other reason frees it.
 * `not-started`: the input never reached the native conversation. `cancelled`: the person stopped or withdrew it. `no-model-call`:
 * a later input took the run over before any model call of its own. `error-before-usage`: it ended in an error without usage.
 */
export type MeteringReleaseReason = 'not-started' | 'cancelled' | 'no-model-call' | 'error-before-usage' | 'fallback-charge' | 'usage-write-failed';
export interface MeteringReleaseInput extends MeteringRunScope {
  readonly reservationId?: string;
  readonly reason: MeteringReleaseReason;
}
/** A reservation the ledger holds without a settle or release, for `recover` after a restart. */
export interface OpenMeteringRun extends MeteringRunScope { readonly reservationId?: string }

/**
 * The host's ledger (v2's `AgentMeteringSink`, renamed). Every run ends with exactly one `settleRun` or `releaseRun` from the meter,
 * but restarts and client retries replay calls, so all four methods are idempotent on `runId` (and `usageId`).
 */
export interface MeteringSink {
  /** False: installed but switched off; nothing is reserved or refused. Absent: on. */
  readonly isEnabled?: () => boolean;
  /** Before the input is submitted. A refusal (or a throw: fail closed) keeps it from the conversation. */
  readonly reserveRun: (input: MeteringReserveInput) => Promise<MeteringReservation>;
  /** One native usage report; returns what it actually billed. */
  readonly recordUsage: (input: MeteringUsageInput) => Promise<{ readonly billedMicros: number }>;
  readonly settleRun: (input: MeteringSettleInput) => Promise<void>;
  readonly releaseRun: (input: MeteringReleaseInput) => Promise<void>;
  /** Runs reserved and not yet settled or released. Needed by `Meter.recover`. */
  readonly openRuns?: () => Promise<readonly OpenMeteringRun[]>;
}

/** The host's price of one usage report in micros (before markup). `model` is absent for a tool's own usage. */
export type MeteringPrice = (usage: Usage, model: MeteringModel | undefined) => number;

/**
 * Default price: Pi's own `calculateCost` with the model's rates from `models` (USD per million tokens), else the cost the
 * provider reported on the message, as micro-dollars.
 */
export function catalogPrice(models?: Pick<Models, 'getModel'>): MeteringPrice {
  return (usage, model) => {
    const known = model ? models?.getModel(model.provider, model.id) : undefined;
    const total = known ? calculateCost(known, structuredClone(usage)).total : usage.cost?.total ?? 0;
    return Number.isFinite(total) && total > 0 ? total * 1_000_000 : 0;
  };
}

/** A submission the meter's ledger refused. The chat transport answers it with 402 and this message, and nothing is submitted. */
export class MeteringRefused extends Error {
  readonly code = 'submission-refused';
  constructor(message: string) { super(message); this.name = 'MeteringRefused'; }
}

export interface MeterOptions {
  readonly sink: MeteringSink;
  readonly context: Context;
  /** Default `catalogPrice(models)`. */
  readonly price?: MeteringPrice;
  readonly models?: Pick<Models, 'getModel'>;
  /** Multiplier applied to every price (default 1). */
  readonly markup?: number;
  /** A sink call failed; the meter retries usage on the next change and charges the hold if it still fails at the end. */
  readonly onError?: (message: string, error: unknown) => void;
}

export interface Meter {
  /**
   * A view of `conversation` whose input `submit` reserves a run for `scope` (the host's mapping of its authentication) first: a
   * refusal throws `MeteringRefused` and nothing is submitted. Every other member is the native conversation. A request ID is
   * required: it is the run's identity.
   */
  readonly conversation: (conversation: Conversation, scope: MeteringScope) => Conversation;
  /** After a restart: finish every run the ledger still holds open, from the conversation's durable state, and watch the rest. */
  readonly recover: (harness: Harness) => Promise<void>;
  /** Resolves when every pending sink call has been made (tests, shutdown). */
  readonly flush: () => Promise<void>;
  /** Stop watching. Open runs stay open in the ledger; `recover` finishes them later. */
  readonly close: () => Promise<void>;
}

const runIdOf = (conversationId: number, requestId: string) => `run:${conversationId}:${requestId}`;
/** The longest `message` preview a reservation carries. */
export const MESSAGE_PREVIEW_LENGTH = 280;
function previewOf(content: unknown): string {
  const parts = typeof content === 'string' ? [content] : Array.isArray(content)
    ? content.map(part => part?.type === 'text' && typeof part.text === 'string' ? part.text : part?.type === 'image' ? '[image]' : '') : [];
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  return text.length > MESSAGE_PREVIEW_LENGTH ? `${text.slice(0, MESSAGE_PREVIEW_LENGTH - 1)}…` : text;
}
/** A copy of the host's scope with only its own fields, checked: a non-empty `userId`, an optional non-empty `workspaceId`, small flat attributes. */
function scopeOf(scope: MeteringScope): MeteringScope {
  if (typeof scope?.userId !== 'string' || scope.userId === '') throw new TypeError('A metering scope needs a userId');
  if (scope.workspaceId !== undefined && (typeof scope.workspaceId !== 'string' || scope.workspaceId === '')) throw new TypeError('workspaceId must be a non-empty string');
  const attributes: unknown = scope.attributes;
  if (attributes !== undefined) {
    const entries = attributes !== null && typeof attributes === 'object' && !Array.isArray(attributes) ? Object.entries(attributes) : undefined;
    if (!entries || entries.length > 16 || entries.some(([key, value]) => key.length === 0 || key.length > 64
      || !(typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 256)))) {
      throw new TypeError('attributes must be at most 16 keys of strings (256 characters), finite numbers or booleans');
    }
  }
  return Object.freeze({ userId: scope.userId, ...(scope.workspaceId === undefined ? {} : { workspaceId: scope.workspaceId }),
    ...(scope.attributes === undefined ? {} : { attributes: Object.freeze({ ...scope.attributes }) }) });
}
/** The run scope fields of `open` (a ledger row may carry more). */
const runScopeOf = (open: MeteringRunScope): MeteringRunScope => ({ ...scopeOf(open), conversationId: open.conversationId, requestId: open.requestId, runId: open.runId });
const isZero = (usage: Usage) => usage.input === 0 && usage.output === 0 && usage.cacheRead === 0 && usage.cacheWrite === 0
  && (usage.totalTokens ?? 0) === 0 && (usage.cost?.total ?? 0) === 0;

interface Run {
  readonly scope: MeteringRunScope;
  reservationId?: string;
  /** True between the reservation and the end of the native submit: no submission record yet is not "never started". */
  submitting: boolean;
  /** Entry id -> billed micros of every usage report the sink accepted. */
  readonly recorded: Map<number, number>;
}
interface Watched {
  readonly conversation: Conversation;
  readonly runs: Map<string, Run>;
  watch: ConversationWatch | undefined;
  chain: Promise<void>;
  again: boolean;
  syncing: boolean;
}
/** One usage report of the run's transcript, with how far it can be trusted. */
interface Report { readonly entry: EntryRecord; readonly usage: Usage; readonly model?: { provider: string; id: string }; readonly bucket: string; readonly aborted: boolean }

/** Usage-bearing entries of the run whose input placed `userEntry`: from it up to the next placed input (which owns what follows). */
async function reportsOf(conversation: Conversation, userEntry: number, context: Context): Promise<{ reports: Report[]; answered: boolean }> {
  const newestFirst: EntryRecord[] = [];
  let cursor: Parameters<Conversation['entries']>[2];
  do {
    const page = await conversation.entries({ minEntryId: userEntry as never }, 100, cursor, context);
    newestFirst.push(...page.items);
    cursor = page.next;
  } while (cursor !== undefined);
  const own: EntryRecord[] = [];
  for (const entry of newestFirst.reverse()) {
    if (Number(entry.id) <= userEntry) continue;
    if (UserEntry.is(entry)) break;
    own.push(entry);
  }
  const reports: Report[] = [];
  for (const entry of own) {
    const message = entry.model?.[0] as { role?: string; usage?: Usage; provider?: string; model?: string; stopReason?: string; toolName?: string } | undefined;
    if (!message?.usage) continue;
    if (message.role === 'assistant') {
      const model = { provider: String(message.provider), id: String(message.model) };
      reports.push({ entry, usage: message.usage, model, bucket: `model:${model.provider}/${model.id}`, aborted: message.stopReason === 'aborted' });
    } else if (message.role === 'toolResult') reports.push({ entry, usage: message.usage, bucket: `tool:${message.toolName}`, aborted: false });
  }
  return { reports, answered: own.some(entry => AssistantEntry.is(entry)) };
}

/** Meter submissions of native conversations into the host's `sink`. */
export function createMeter(options: MeterOptions): Meter {
  const { sink, context } = options;
  const price = options.price ?? catalogPrice(options.models);
  const markup = options.markup ?? 1;
  if (!(markup > 0)) throw new TypeError('markup must be a positive number');
  const report = options.onError ?? ((message: string, error: unknown) => { console.error(`metering: ${message}`, error); });
  const enabled = () => sink.isEnabled?.() !== false;
  const watched = new Map<number, Watched>();
  let closed = false;

  function watchedOf(conversation: Conversation): Watched {
    const id = Number(conversation.id);
    let found = watched.get(id);
    if (!found) { found = { conversation, runs: new Map(), watch: undefined, chain: Promise.resolve(), again: false, syncing: false }; watched.set(id, found); }
    return found;
  }
  /** Re-read the durable state of `state`'s open runs; coalesced and serialized per conversation. */
  function schedule(state: Watched): Promise<void> {
    if (state.syncing) { state.again = true; return state.chain; }
    state.syncing = true;
    state.chain = state.chain.then(async () => {
      do { state.again = false; await sync(state).catch(error => report('sync failed', error)); } while (state.again && !closed);
      state.syncing = false;
      if (state.runs.size === 0 && state.watch) { const watch = state.watch; state.watch = undefined; await watch.stop(); }
    });
    return state.chain;
  }
  async function observe(state: Watched): Promise<void> {
    if (state.watch || closed) return;
    const watch = await state.conversation.watch(context);
    if (state.watch || closed) { await watch.stop(); return; }
    state.watch = watch;
    // A streamed partial changes only `pi.live.generation`: re-reading the runs then would only add reads to the session line.
    let last: string | undefined;
    watch.start(async view => {
      const { generation: _partial, ...live } = (view.docs['pi.live'] ?? {}) as Record<string, unknown>;
      const key = JSON.stringify([view.entries.at(-1)?.id, view.entries.length, view.docs['pi.inbox'], live]);
      if (key === last) return;
      last = key;
      void schedule(state);
    });
  }

  async function sync(state: Watched): Promise<void> {
    for (const run of [...state.runs.values()]) {
      if (run.submitting) continue;
      const record = await state.conversation.commit(tx => tx.submissionByRequest(state.conversation.id, run.scope.requestId), context);
      if (!record) { await finish(state, run, { release: 'not-started' }); continue; }
      const { reports, answered } = record.entry === undefined ? { reports: [], answered: false } : await reportsOf(state.conversation, Number(record.entry), context);
      for (const item of reports) {
        if (run.recorded.has(Number(item.entry.id))) continue;
        try {
          const amountMicros = Math.ceil(Math.max(0, price(item.usage, item.model)) * markup);
          const { billedMicros } = await sink.recordUsage({ ...run.scope, ...(run.reservationId ? { reservationId: run.reservationId } : {}),
            usageId: `entry:${run.scope.conversationId}:${item.entry.id}`, ...(item.model ? { model: item.model } : {}), bucket: item.bucket, usage: item.usage, amountMicros });
          run.recorded.set(Number(item.entry.id), billedMicros);
        } catch (error) { report(`recordUsage failed (${run.scope.runId}); retried on the next change`, error); }
      }
      if (record.status === 'done' || record.status === 'unanswered') await finish(state, run, decide(run, record, reports, answered));
    }
  }

  /**
   * The termination rule (v2's, on native state). In order: a usage report the sink still has not accepted charges the hold; a
   * person's stop settles what was billed or frees the hold; an attempt interrupted with unknown usage (an aborted partial without
   * billed usage), or a model call whose usage priced to nothing without being an explicit zero report, charges the hold; billed
   * usage settles; explicit zero reports settle at zero; an answer without any usage report charges the hold; no model call at all
   * frees it.
   */
  function decide(run: Run, record: SubmissionRecord, reports: readonly Report[], answered: boolean): { settle: 'done' | 'unanswered' } | { release: MeteringReleaseReason } {
    const status = record.status === 'done' ? 'done' : 'unanswered';
    const billed = reports.some(item => (run.recorded.get(Number(item.entry.id)) ?? 0) > 0);
    if (reports.some(item => !run.recorded.has(Number(item.entry.id)))) return { release: 'usage-write-failed' };
    if (record.status === 'unanswered' && record.reason === 'aborted') return billed ? { settle: status } : { release: record.entry === undefined ? 'not-started' : 'cancelled' };
    if (record.status === 'unanswered' && record.entry === undefined) return { release: 'not-started' };
    const unknown = reports.some(item => (run.recorded.get(Number(item.entry.id)) ?? 0) === 0 && (item.aborted || !isZero(item.usage)));
    if (unknown) return { release: 'fallback-charge' };
    if (billed || reports.length > 0) return { settle: status };
    if (answered) return { release: 'fallback-charge' };
    return { release: record.status === 'done' ? 'no-model-call' : 'error-before-usage' };
  }

  async function finish(state: Watched, run: Run, decision: { settle: 'done' | 'unanswered' } | { release: MeteringReleaseReason }): Promise<void> {
    const base = { ...run.scope, ...(run.reservationId ? { reservationId: run.reservationId } : {}) };
    try {
      if ('settle' in decision) await sink.settleRun({ ...base, status: decision.settle });
      else await sink.releaseRun({ ...base, reason: decision.release });
      state.runs.delete(run.scope.runId);
    } catch (error) { report(`terminating ${run.scope.runId} failed; retried on the next change or recover()`, error); }
  }

  function track(state: Watched, scope: MeteringRunScope, reservationId: string | undefined, submitting: boolean): Run {
    const run: Run = { scope, ...(reservationId ? { reservationId } : {}), submitting, recorded: new Map() };
    state.runs.set(scope.runId, run);
    return run;
  }

  return Object.freeze({
    conversation: (conversation: Conversation, hostScope: MeteringScope): Conversation => { const owner = scopeOf(hostScope); return new Proxy(conversation, { get: (target, key) => {
      if (key === 'submit') {
        return async (draft: SubmissionDraft, submitContext: Context): Promise<Submission> => {
          if (draft.type !== 'input' || !enabled()) return target.submit(draft, submitContext);
          if (!draft.requestId) throw new TypeError('A metered submission needs a request ID');
          const conversationId = Number(target.id);
          const scope: MeteringRunScope = { ...owner, conversationId, requestId: draft.requestId, runId: runIdOf(conversationId, draft.requestId) };
          const state = watchedOf(target);
          // The model this run will use: the conversation's selected model as Pi resolves it now.
          const selected = (await target.agent(submitContext)).model;
          const reservation = await sink.reserveRun({ ...scope, ...(selected ? { model: { provider: selected.provider, id: selected.modelId } } : {}),
            kind: draft.whenBusy === 'steer' || draft.whenBusy === 'followUp' ? draft.whenBusy : 'input', message: previewOf(draft.content), content: draft.content });
          if ('kind' in reservation && reservation.kind === 'refused') throw new MeteringRefused(reservation.reason);
          const reservationId = 'reservationId' in reservation ? reservation.reservationId : undefined;
          const run = state.runs.get(scope.runId) ?? track(state, scope, reservationId, true);
          // Not admitted (busy with whenBusy "reject", storage refusal): no submission record, so the sync below frees the hold.
          try {
            await observe(state);
            return await target.submit(draft, submitContext);
          } finally {
            run.submitting = false;
            void schedule(state);
          }
        };
      }
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } }); },
    recover: async (harness: Harness) => {
      if (!sink.openRuns) throw new TypeError('recover needs a sink with openRuns()');
      for (const open of await sink.openRuns()) {
        const conversation = await harness.conversation(open.conversationId as never, context);
        const scope = runScopeOf(open);
        const base = { ...scope, ...(open.reservationId ? { reservationId: open.reservationId } : {}) };
        if (!conversation) { await sink.releaseRun({ ...base, reason: 'not-started' }); continue; }
        const state = watchedOf(conversation);
        if (!state.runs.has(open.runId)) track(state, scope, open.reservationId, false);
      }
      for (const state of watched.values()) { await observe(state); await schedule(state); }
    },
    flush: async () => {
      for (;;) {
        const pending = [...watched.values()].map(state => state.chain);
        await Promise.all(pending);
        if ([...watched.values()].every((state, at) => state.chain === pending[at] && !state.syncing)) return;
      }
    },
    close: async () => {
      closed = true;
      for (const state of watched.values()) { const watch = state.watch; state.watch = undefined; await watch?.stop(); }
      await Promise.all([...watched.values()].map(state => state.chain));
    },
  });
}

/**
 * A ledger: the sink plus the balance reads and grants a host needs around it. A balance is named by its key (`balanceKey(scope)`,
 * by default the run's `userId`). Amounts are integer micros.
 */
export interface MeteringLedger extends MeteringSink {
  readonly openRuns: () => Promise<readonly OpenMeteringRun[]>;
  /** `balanceMicros` is grants minus charges; `heldMicros` the unspent part of open holds; `availableMicros` what a new run can use. */
  readonly balance: (key: string) => Promise<{ readonly balanceMicros: number; readonly heldMicros: number; readonly availableMicros: number }>;
  /** Add credits (negative removes them); idempotent on `grantId`. */
  readonly grant: (key: string, amountMicros: number, grantId: string) => Promise<void>;
}
export interface LedgerOptions {
  /**
   * What a run holds while it runs, and what a fallback charge tops the run's charges up to. A function sizes it per reservation
   * (model-aware admission: a costly model holds more, so a low balance refuses it while a cheaper one is still admitted).
   */
  readonly holdMicros: number | ((input: MeteringReserveInput) => number);
  /** The balance a run draws on. Default its `userId`; `scope => scope.workspaceId ?? scope.userId` pools a workspace. */
  readonly balanceKey?: (scope: MeteringScope) => string;
  /** The refusal shown to the person. Default names the available and needed amounts in millionths. */
  readonly refusal?: (availableMicros: number, holdMicros: number, input: MeteringReserveInput) => string;
}
const CHARGES: ReadonlySet<MeteringReleaseReason> = new Set(['fallback-charge', 'usage-write-failed']);
const credits = (micros: number) => (micros / 1_000_000).toFixed(4);
const defaultRefusal = (available: number, hold: number) => `Not enough credits to send this message: ${credits(Math.max(0, available))} available, a message needs ${credits(hold)}.`;
const validHold = (hold: number) => { if (!Number.isSafeInteger(hold) || hold <= 0) throw new TypeError('holdMicros must be a positive integer'); return hold; };
/** The checked policy of `options`: the hold of a reservation, the balance key of a scope, the refusal. */
function policyOf(options: LedgerOptions) {
  const { holdMicros } = options;
  if (typeof holdMicros === 'number') validHold(holdMicros);
  return {
    hold: (input: MeteringReserveInput) => validHold(typeof holdMicros === 'number' ? holdMicros : holdMicros(input)),
    key: (scope: MeteringScope) => {
      const key = options.balanceKey ? options.balanceKey(scope) : scope.userId;
      if (typeof key !== 'string' || key === '') throw new TypeError('balanceKey must return a non-empty string');
      return key;
    },
    refuse: (available: number, hold: number, input: MeteringReserveInput) => ({ kind: 'refused' as const, reason: (options.refusal ?? defaultRefusal)(available, hold, input) }),
  };
}
const modelName = (model: MeteringModel | undefined) => model ? `${model.provider}/${model.id}` : null;

/** The ledger in memory, for tests and examples: one process, lost on exit. */
export function createMemoryLedger(options: LedgerOptions): MeteringLedger {
  const policy = policyOf(options);
  const grants = new Map<string, { key: string; amount: number }>();
  const runs = new Map<string, { scope: MeteringRunScope; key: string; hold: number; state: 'open' | 'settled' | 'released' | 'charged' }>();
  const charges = new Map<string, { runId: string; key: string; amount: number }>();
  const total = <T extends { amount: number }>(items: Iterable<T>, keep: (item: T) => boolean) => [...items].filter(keep).reduce((sum, item) => sum + item.amount, 0);
  const charged = (runId: string) => total(charges.values(), item => item.runId === runId);
  const balance = async (key: string) => {
    const granted = total(grants.values(), item => item.key === key), spent = total(charges.values(), item => item.key === key);
    const held = [...runs.values()].filter(run => run.key === key && run.state === 'open').reduce((sum, run) => sum + Math.max(0, run.hold - charged(run.scope.runId)), 0);
    return { balanceMicros: granted - spent, heldMicros: held, availableMicros: granted - spent - held };
  };
  return Object.freeze({
    balance,
    grant: async (key: string, amountMicros: number, grantId: string) => { if (!grants.has(grantId)) grants.set(grantId, { key, amount: Math.trunc(amountMicros) }); },
    reserveRun: async (input: MeteringReserveInput): Promise<MeteringReservation> => {
      if (runs.has(input.runId)) return { reservationId: input.runId };
      const key = policy.key(input), hold = policy.hold(input);
      const { availableMicros } = await balance(key);
      if (availableMicros < hold) return policy.refuse(availableMicros, hold, input);
      runs.set(input.runId, { scope: runScopeOf(input), key, hold, state: 'open' });
      return { reservationId: input.runId };
    },
    recordUsage: async (input: MeteringUsageInput) => {
      const id = JSON.stringify([input.runId, input.usageId]);
      const key = runs.get(input.runId)?.key ?? policy.key(input);
      if (!charges.has(id)) charges.set(id, { runId: input.runId, key, amount: Math.max(0, Math.ceil(input.amountMicros)) });
      return { billedMicros: charges.get(id)!.amount };
    },
    settleRun: async (input: MeteringSettleInput) => { const run = runs.get(input.runId); if (run?.state === 'open') run.state = 'settled'; },
    releaseRun: async (input: MeteringReleaseInput) => {
      const run = runs.get(input.runId);
      if (run?.state !== 'open') return;
      const charge = CHARGES.has(input.reason);
      if (charge) charges.set(JSON.stringify([input.runId, 'fallback']), { runId: input.runId, key: run.key, amount: Math.max(0, run.hold - charged(input.runId)) });
      run.state = charge ? 'charged' : 'released';
    },
    openRuns: async () => [...runs.values()].filter(run => run.state === 'open').map(run => ({ ...run.scope, reservationId: run.scope.runId })),
  });
}

/** Where a SQLite ledger lives: a borrowed connection, or a file the ledger opens (`openNodeConnection(filename, sqlite)`) and owns. */
export type SqliteLedgerStore =
  | { readonly connection: SqliteConnection; readonly filename?: never; readonly sqlite?: never }
  | { readonly filename: string; readonly sqlite?: SqliteSettings; readonly connection?: never };

/**
 * The ledger in SQLite: grants, runs with their scope, model, kind and hold, and charges keyed by (run, step) with the usage's model,
 * so a replayed usage report or fallback charge is never charged twice. Over a borrowed `SqliteConnection` (`openNodeConnection`,
 * `durableObjectSqliteConnection`, ...), or a `filename` it opens with `sqlite` settings (`@hachej/boring-files/sqlite`: local disk WAL by
 * default, `sqliteSettings.networkFilesystem` on EFS) and closes on `close()`. Every write is one write transaction (`BEGIN
 * IMMEDIATE` on `node:sqlite`): several processes or requests on one ledger file wait for each other up to the busy timeout instead
 * of failing, and a reservation's balance check and hold commit together, so concurrent reservations never spend the same credit twice.
 */
export function createSqliteLedger(options: LedgerOptions & SqliteLedgerStore): MeteringLedger & { readonly close: () => void } {
  const policy = policyOf(options);
  const owned = options.connection === undefined;
  if (owned && typeof options.filename !== 'string') throw new TypeError('A SQLite ledger needs a connection or a filename');
  const db = options.connection ?? openNodeConnection(options.filename!, options.sqlite);
  try {
  db.transaction('write', () => db.exec(`CREATE TABLE IF NOT EXISTS boring_metering_grants (grant_id TEXT PRIMARY KEY, balance_key TEXT NOT NULL, amount INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS boring_metering_runs (run_id TEXT PRIMARY KEY, balance_key TEXT NOT NULL, user_id TEXT NOT NULL, workspace_id TEXT, attributes TEXT,
  conversation_id INTEGER NOT NULL, request_id TEXT NOT NULL, model TEXT, kind TEXT NOT NULL, hold INTEGER NOT NULL, state TEXT NOT NULL, reason TEXT);
CREATE TABLE IF NOT EXISTS boring_metering_charges (run_id TEXT NOT NULL, step TEXT NOT NULL, balance_key TEXT NOT NULL, model TEXT, amount INTEGER NOT NULL, PRIMARY KEY (run_id, step));`));
  // Tables of the earlier account-keyed shape are not migrated: refuse them rather than misread balances.
  try { db.all('SELECT balance_key FROM boring_metering_grants LIMIT 0'); db.all('SELECT balance_key, user_id FROM boring_metering_runs LIMIT 0'); db.all('SELECT balance_key FROM boring_metering_charges LIMIT 0'); }
  catch { throw new Error('The metering tables have the earlier account-keyed shape; move the old ledger aside (its balances are not migrated)'); }
  } catch (error) { if (owned) db.close?.(); throw error; }
  const sum = (sql: string, ...params: (string | number)[]) => Number(db.get<{ total: number | null }>(sql, ...params)?.total ?? 0);
  const balanceNow = (key: string) => {
    const granted = sum('SELECT SUM(amount) AS total FROM boring_metering_grants WHERE balance_key = ?', key);
    const spent = sum('SELECT SUM(amount) AS total FROM boring_metering_charges WHERE balance_key = ?', key);
    const held = sum(`SELECT SUM(MAX(0, r.hold - COALESCE((SELECT SUM(c.amount) FROM boring_metering_charges c WHERE c.run_id = r.run_id), 0))) AS total
      FROM boring_metering_runs r WHERE r.balance_key = ? AND r.state = 'open'`, key);
    return { balanceMicros: granted - spent, heldMicros: held, availableMicros: granted - spent - held };
  };
  const insertCharge = 'INSERT OR IGNORE INTO boring_metering_charges (run_id, step, balance_key, model, amount) VALUES (?, ?, ?, ?, ?)';
  const keyOfRun = (runId: string) => db.get<{ balance_key: string }>('SELECT balance_key FROM boring_metering_runs WHERE run_id = ?', runId)?.balance_key;
  return Object.freeze({
    balance: async (key: string) => db.transaction('read', () => balanceNow(key)),
    grant: async (key: string, amountMicros: number, grantId: string) => db.transaction('write', () => {
      db.run('INSERT OR IGNORE INTO boring_metering_grants (grant_id, balance_key, amount) VALUES (?, ?, ?)', grantId, key, Math.trunc(amountMicros));
    }),
    reserveRun: async (input: MeteringReserveInput): Promise<MeteringReservation> => {
      const key = policy.key(input), hold = policy.hold(input);
      return db.transaction('write', () => {
        if (db.get('SELECT 1 AS found FROM boring_metering_runs WHERE run_id = ?', input.runId)) return { reservationId: input.runId };
        const { availableMicros } = balanceNow(key);
        if (availableMicros < hold) return policy.refuse(availableMicros, hold, input);
        db.run(`INSERT INTO boring_metering_runs (run_id, balance_key, user_id, workspace_id, attributes, conversation_id, request_id, model, kind, hold, state)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`, input.runId, key, input.userId, input.workspaceId ?? null, input.attributes ? JSON.stringify(input.attributes) : null,
        input.conversationId, input.requestId, modelName(input.model), input.kind, hold);
        return { reservationId: input.runId };
      });
    },
    recordUsage: async (input: MeteringUsageInput) => db.transaction('write', () => {
      db.run(insertCharge, input.runId, input.usageId, keyOfRun(input.runId) ?? policy.key(input), modelName(input.model), Math.max(0, Math.ceil(input.amountMicros)));
      return { billedMicros: Number(db.get<{ amount: number }>('SELECT amount FROM boring_metering_charges WHERE run_id = ? AND step = ?', input.runId, input.usageId)!.amount) };
    }),
    settleRun: async (input: MeteringSettleInput) => db.transaction('write', () => {
      db.run(`UPDATE boring_metering_runs SET state = 'settled', reason = ? WHERE run_id = ? AND state = 'open'`, input.status, input.runId);
    }),
    releaseRun: async (input: MeteringReleaseInput) => db.transaction('write', () => {
      const run = db.get<{ balance_key: string; hold: number }>(`SELECT balance_key, hold FROM boring_metering_runs WHERE run_id = ? AND state = 'open'`, input.runId);
      if (!run) return;
      const charge = CHARGES.has(input.reason);
      if (charge) db.run(insertCharge, input.runId, 'fallback', run.balance_key, null, Math.max(0, Number(run.hold) - sum('SELECT SUM(amount) AS total FROM boring_metering_charges WHERE run_id = ?', input.runId)));
      db.run('UPDATE boring_metering_runs SET state = ?, reason = ? WHERE run_id = ?', charge ? 'charged' : 'released', input.reason, input.runId);
    }),
    openRuns: async () => db.all<{ run_id: string; user_id: string; workspace_id: string | null; attributes: string | null; conversation_id: number; request_id: string }>(
      `SELECT run_id, user_id, workspace_id, attributes, conversation_id, request_id FROM boring_metering_runs WHERE state = 'open' ORDER BY rowid`)
      .map(row => ({ userId: row.user_id, ...(row.workspace_id === null ? {} : { workspaceId: row.workspace_id }),
        ...(row.attributes === null ? {} : { attributes: JSON.parse(row.attributes) as MeteringAttributes }),
        conversationId: Number(row.conversation_id), requestId: row.request_id, runId: row.run_id, reservationId: row.run_id })),
    /** Closes the file the ledger opened; a borrowed connection stays open (its owner closes it). */
    close: () => { if (owned) db.close?.(); },
  });
}
