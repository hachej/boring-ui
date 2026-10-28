import type { ResultFailure } from './run-result.js';

/**
 * What a run is, in every home: the ways it ends, the view an operation reads, the usage it reports, and the delivery of its end
 * to the operation that started it. The home keeps the run (a durable task on a Durable Object, a row in a person's SQLite file);
 * these are the parts that must not differ between homes.
 */

/** How a run ends. `revoked`: the host's authority was withdrawn (a delivery or validation refused with 401/403). */
export const RUN_ENDS = Object.freeze(['completed', 'invalid_output', 'cancelled', 'interrupted', 'revoked', 'error'] as const);
export type RunEnd = typeof RUN_ENDS[number];
export type RunStatus = 'queued' | 'running' | RunEnd;
/** The end code of a run that the host's spend cap refused (`error: "over_budget"`), and of a request it refused. */
export const OVER_BUDGET = 'over_budget';

/** What a run used, summed over its model answers: tokens, cost in USD as pi-ai prices it, and the models that answered. */
export interface RunUsage { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number; readonly cost: number; readonly models: readonly string[] }

/** A run by its key, as the operation that started it reads it. `usage` is null for a run that never answered. */
export interface RunView { readonly run: string; readonly status: RunStatus; readonly startedAt?: string; readonly output?: unknown; readonly usage: RunUsage | null; readonly error?: string }
/** What the delivery operation is called with: the run's end. */
export interface RunPayload { readonly run: string; readonly status: RunEnd; readonly output?: unknown; readonly usage: RunUsage | null; readonly error?: string }

/** Statuses a run can still be in, and ends the view carries an `error` text for. */
export const isEnd = (status: string): status is RunEnd => (RUN_ENDS as readonly string[]).includes(status);
const WITH_ERROR: ReadonlySet<string> = new Set<RunEnd>(['error', 'interrupted', 'invalid_output', 'revoked']);
export const endsWithError = (status: string): boolean => WITH_ERROR.has(status);

/** True when `error` is the spend meter's refusal (`over_budget`, 429), by its `code` or its `extra.code`. */
export function isOverBudget(error: unknown): boolean {
  const e = error as { code?: unknown; extra?: { code?: unknown } } | null | undefined;
  return (e?.code ?? e?.extra?.code) === OVER_BUDGET;
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
/**
 * A run's model answers summed from its transcript messages (pi-ai's `usage` on each assistant message); null when none answered.
 * `modelRef` names the model of a message (default: its `model`), for hosts that report `provider:model`; return undefined to skip one.
 */
export function sumUsage(messages: readonly unknown[], modelRef: (message: { provider?: string; model?: string }) => string | undefined = (m) => m.model): RunUsage | null {
  let answered = false, input = 0, output = 0, cacheRead = 0, cacheWrite = 0, cost = 0;
  const models: string[] = [];
  for (const raw of messages) {
    const message = raw as { role?: string; usage?: { input?: unknown; output?: unknown; cacheRead?: unknown; cacheWrite?: unknown; cost?: { total?: unknown } }; provider?: string; model?: string } | null;
    if (message?.role !== 'assistant' || !message.usage) continue;
    const u = message.usage;
    answered = true;
    input += count(u.input); output += count(u.output); cacheRead += count(u.cacheRead); cacheWrite += count(u.cacheWrite); cost += count(u.cost?.total);
    const ref = typeof message.model === 'string' ? modelRef(message) : undefined;
    if (ref && !models.includes(ref)) models.push(ref);
  }
  return answered ? { input, output, cacheRead, cacheWrite, cost, models } : null;
}

export interface DeliveryOptions {
  /** The operation that receives the end (`deliver:` of the start). */
  readonly operation: string;
  /** The run's key: the delivery's receipt key is `deliver:<key>`, so the host's receipt makes the delivery once. */
  readonly key: string;
  readonly end: Omit<RunPayload, 'run'>;
  /** Calls the operation as the person whose run it is. Resolve = delivered; throw = refused (the next attempt may pass). */
  readonly invoke: (operation: string, input: unknown, key: string) => Promise<unknown>;
  /** A completed run is checked again just before it is delivered (a `phase: "delivery"` check): its failure becomes the end delivered instead. */
  readonly recheck?: () => Promise<ResultFailure | undefined>;
  /** Told once when the re-check fails, before the delivery, so the home can record the failed end. */
  readonly onFailure?: (failure: ResultFailure) => Promise<void> | void;
  /** Attempts (default 3) and the first wait between two (default 20 ms, doubling). */
  readonly attempts?: number;
  readonly backoffMs?: number;
}
export interface DeliveryResult {
  /** False when no attempt was accepted: the run's end stays undelivered and is delivered again later. */
  readonly delivered: boolean;
  /** The end as delivered or last tried: the re-check's failure replaces a completed end. */
  readonly end: Omit<RunPayload, 'run'>;
  readonly failure?: ResultFailure;
  /** The last refusal, when not delivered. */
  readonly error?: string;
}

/**
 * Hand a run's end to the operation that started it, once however often it is tried: attempts are bounded, every one carries the same
 * `deliver:<key>` receipt key, and a completed run is first checked again so a result that stopped being valid is delivered as
 * `invalid_output` (or `revoked`), never as a success. A failed delivery is reported, not dropped: the home retries it later.
 */
export async function deliverRunEnd(options: DeliveryOptions): Promise<DeliveryResult> {
  const { operation, key, invoke, recheck, onFailure, attempts = 3, backoffMs = 20 } = options;
  let end = options.end, failure: ResultFailure | undefined, last: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, backoffMs * 2 ** (attempt - 1)));
    if (end.status === 'completed' && recheck) {
      let found: ResultFailure | undefined;
      try { found = await recheck(); } catch (error) {
        // Only a refusal by authority changes the end; any other throw (an outage) leaves it completed, tried again.
        const status = (error as { status?: unknown })?.status;
        last = (error as Error)?.message ?? error;
        if (status !== 401 && status !== 403) continue;
        found = { error: String(last).slice(0, 500), end: 'revoked' };
      }
      if (found) {
        failure = found;
        end = { status: found.end as RunEnd, usage: end.usage, error: found.error };
        await onFailure?.(found);
      }
    }
    try {
      await invoke(operation, { run: key, ...end }, `deliver:${key}`);
      return { delivered: true, end, ...(failure ? { failure } : {}) };
    } catch (error) { last = (error as Error)?.message ?? error; }
  }
  return { delivered: false, end, ...(failure ? { failure } : {}), error: `deliver ${operation}: ${String(last).slice(0, 200)}` };
}
