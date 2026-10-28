import type { Context } from '@earendil-works/chord';
import type { SyncSql } from './run-outbox.js';
import { settleResult, validateResult, validationError } from './run-result.js';
import type { ResultCard, ResultConversation, ResultInvoke, ResultSubmission, ResultValidationRecord, RunAnswer } from './run-result.js';
import { OVER_BUDGET, deliverRunEnd, endsWithError, isOverBudget } from './runs.js';
import type { RunEnd, RunUsage, RunView } from './runs.js';

/**
 * The runs a home keeps in a person's own store, and the runner over them: start a run by its key (the same key is the same run),
 * end it exactly once, deliver its end to the operation that started it, cancel it, and find again what a stopped process left.
 * The store is the host's data (a table in its SQLite file); the model turns stay Pi's (the run is a native conversation).
 */

export const RUNS_TABLE = 'CREATE TABLE IF NOT EXISTS _host_agent_runs (key TEXT PRIMARY KEY, agent TEXT NOT NULL, status TEXT NOT NULL, output TEXT, error TEXT, deliver TEXT, validation TEXT, delivered INTEGER NOT NULL DEFAULT 0, person TEXT NOT NULL, usage TEXT, started_at TEXT)';
/** Columns added after the table first shipped: a store created before them gets them here. */
const LATE_COLUMNS = ['validation TEXT', 'usage TEXT', 'started_at TEXT'] as const;

export interface RunRow { readonly key: string; readonly agent: string; readonly status: string; readonly output: string | null; readonly error: string | null; readonly deliver: string | null; readonly validation: string | null; readonly delivered: number; readonly person: string; readonly usage: string | null; readonly started_at: string | null }

/** A refusal with an HTTP-like `status` (404: no such agent; 409: the key belongs to another agent). */
export class RunRefused extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'RunRefused'; }
}

export interface EndOptions {
  readonly output?: unknown;
  readonly error?: string | null;
  readonly validation?: ResultValidationRecord;
  readonly usage?: RunUsage | null;
}

/** The ledger over a store's synchronous SQL (`SyncSql`: `UPDATE ... RETURNING` is what makes an end happen once). */
export function createRunLedger(sql: SyncSql) {
  const rowsOf = (text: string, params: unknown[] = []) => sql(text, params) as unknown as RunRow[];
  let ready = false;
  const ensure = () => {
    if (ready) return;
    sql(RUNS_TABLE, []);
    const have = new Set(sql('PRAGMA table_info(_host_agent_runs)', []).map(c => String(c.name)));
    for (const column of LATE_COLUMNS) if (!have.has(column.split(' ')[0]!)) sql(`ALTER TABLE _host_agent_runs ADD COLUMN ${column}`, []);
    ready = true;
  };
  const get = (key: string): RunRow | undefined => { ensure(); return rowsOf('SELECT * FROM _host_agent_runs WHERE key = ?', [key])[0]; };
  return {
    ensure, get,
    /** Record a new running run. The caller has checked `get(key)` first. */
    begin(run: { key: string; agent: string; deliver: string | null; person: unknown; startedAt: string }): void {
      ensure();
      sql("INSERT INTO _host_agent_runs (key, agent, status, deliver, person, started_at) VALUES (?, ?, 'running', ?, ?, ?)", [run.key, run.agent, run.deliver, JSON.stringify(run.person), run.startedAt]);
    },
    /** End a run still running, once (a cancel and the run's own end race): false when something else ended it first. */
    end(key: string, status: RunEnd, options: EndOptions = {}): boolean {
      ensure();
      const changed = rowsOf("UPDATE _host_agent_runs SET status = ?, output = ?, error = ?, validation = ?, usage = ? WHERE key = ? AND status = 'running' RETURNING key",
        [status, options.output === undefined ? null : JSON.stringify(options.output), options.error ?? null, options.validation ? JSON.stringify(options.validation) : null, options.usage ? JSON.stringify(options.usage) : null, key]);
      return changed.length > 0;
    },
    /** A completed run whose delivery-time check failed: its end becomes the failure (never after it was delivered). */
    fail(key: string, status: RunEnd, error: string): void {
      ensure();
      sql('UPDATE _host_agent_runs SET status = ?, output = NULL, error = ?, validation = NULL WHERE key = ? AND delivered = 0', [status, error, key]);
    },
    markDelivered(key: string): void { ensure(); sql('UPDATE _host_agent_runs SET delivered = 1 WHERE key = ?', [key]); },
    /** Runs a stopped process left: still running (they end `interrupted`), or ended and not delivered. */
    left(): RunRow[] { ensure(); return rowsOf("SELECT * FROM _host_agent_runs WHERE status = 'running' OR (deliver IS NOT NULL AND delivered = 0)"); },
    view(row: RunRow): RunView {
      return {
        run: row.key, status: row.status as RunView['status'], ...(row.started_at ? { startedAt: row.started_at } : {}),
        ...(row.status === 'completed' && row.output !== null ? { output: JSON.parse(row.output) } : {}),
        usage: row.usage ? JSON.parse(row.usage) : null,
        ...(endsWithError(row.status) ? { error: row.error ?? row.status } : {}),
      };
    },
  };
}
export type RunLedger = ReturnType<typeof createRunLedger>;

/** A started run's live handle: its conversation and first submission, and the card it answers. */
export interface RunExecution {
  readonly conversation: ResultConversation & { abort(context: Context): Promise<unknown> };
  readonly submission: ResultSubmission;
  readonly card: ResultCard;
}

export interface RunnerOptions {
  readonly ledger: RunLedger;
  /** The person whose store this is: written on each row so another process can deliver it as them. */
  readonly person: unknown;
  readonly context: Context;
  /** Whether the home has this agent (a start of an unknown agent is refused 404 before any row is written). */
  readonly has: (agent: string) => boolean | Promise<boolean>;
  /** Open the run's conversation and submit its input: null when the agent is gone. */
  readonly prepare: (agent: string, input: unknown) => Promise<RunExecution | null>;
  /** Call an operation as the person: the result validators and the delivery (which may reach an `internal` operation). */
  readonly invoke: ResultInvoke;
  /** The run's model answers summed, from its conversation; null when none answered. */
  readonly usage?: (conversation: RunExecution['conversation']) => Promise<RunUsage | null>;
  /** The host's spend meter: throws `over_budget` when the app may not spend now. A refused run is never started and ends `error: over_budget`. */
  readonly admit?: () => void;
  readonly now?: () => string;
  readonly deliverAttempts?: number;
  readonly deliverBackoffMs?: number;
}

/**
 * The runner of one person's store. A run lives in this process: one a restart cut short is found by `recover` and ends
 * `interrupted`; one that ended and was not delivered is delivered then. Delivery is once (the host's receipt `deliver:<key>`).
 */
export function createRunner(options: RunnerOptions) {
  const { ledger, person, context, has, prepare, invoke, admit, now = () => new Date().toISOString() } = options;
  const live = new Map<string, Promise<RunExecution | null>>();
  const delivering = new Map<string, Promise<void>>();
  const overBudget = () => { if (!admit) return false; try { admit(); return false; } catch (error) { return isOverBudget(error); } };

  const deliver = async (row: { key: string }): Promise<void> => {
    const active = delivering.get(row.key);
    if (active) return active;
    const pending = deliverPending(ledger.get(row.key)!);
    delivering.set(row.key, pending);
    try { await pending; } finally { delivering.delete(row.key); }
  };
  const deliverPending = async (row: RunRow): Promise<void> => {
    if (!row.deliver || row.delivered) return;
    const view = ledger.view(row);
    const checked: ResultValidationRecord | undefined = row.status === 'completed' && row.validation ? JSON.parse(row.validation) : undefined;
    const sent = await deliverRunEnd({
      operation: row.deliver, key: row.key, invoke,
      end: { status: row.status as RunEnd, ...(view.output !== undefined ? { output: view.output } : {}), usage: view.usage, ...(view.error ? { error: view.error } : {}) },
      ...(checked ? { recheck: async () => {
        const result = await validateResult(checked.card, view.output, checked.evidence, invoke, 'delivery', `result-delivery:${row.key}:${crypto.randomUUID()}`);
        return result.valid ? undefined : { end: 'invalid_output', error: result.hint ?? 'Return a supported result.' };
      }, onFailure: (failure) => ledger.fail(row.key, failure.end as RunEnd, failure.error) } : {}),
      ...(options.deliverAttempts !== undefined ? { attempts: options.deliverAttempts } : {}), ...(options.deliverBackoffMs !== undefined ? { backoffMs: options.deliverBackoffMs } : {}),
    });
    if (sent.delivered) ledger.markDelivered(row.key);
  };
  /** Ends a run still running, once, then delivers it; false when something else ended it first. */
  const end = async (key: string, status: RunEnd, endOptions: EndOptions = {}, beforeDeliver?: () => Promise<void>): Promise<boolean> => {
    if (!ledger.end(key, status, endOptions)) return false;
    await beforeDeliver?.();
    await deliver({ key });
    return true;
  };
  const answerOf = async (execution: RunExecution) => settleResult({ card: execution.card, conversation: execution.conversation, submission: execution.submission, invoke, context });

  /**
   * Runs left over by an earlier process. A run whose delivery is in flight is skipped, never awaited: a status read made from
   * inside that delivery (its operation reading the run) would otherwise wait on itself.
   */
  const recover = async (): Promise<void> => {
    for (const row of ledger.left()) {
      if (delivering.has(row.key)) continue;
      if (row.status === 'running' && !live.has(row.key)) await end(row.key, 'interrupted', { error: 'the process stopped before the run ended' });
      else if (row.status !== 'running') await deliver(row);
    }
  };

  return {
    /** Starts the run of this key (a key already started is the same run, whatever else is asked): launched and returned at once. */
    async start(agent: string, input: unknown, key: string, deliverTo: string | null): Promise<RunView> {
      if (!(await has(agent))) throw new RunRefused(404, `no agent ${agent}`);
      const before = ledger.get(key);
      if (before) { if (before.agent !== agent) throw new RunRefused(409, `key ${key} is a run of ${before.agent}`); return ledger.view(before); }
      ledger.begin({ key, agent, deliver: deliverTo, person, startedAt: now() });
      // Over the host's spend cap: the run is never started, and ends (and is delivered) as `error: over_budget`.
      const refused = overBudget();
      const execution = refused ? Promise.resolve(null) : Promise.resolve().then(() => prepare(agent, input));
      live.set(key, execution);
      void (async () => {
        try {
          const ready = await execution;
          if (refused) { await end(key, 'error', { error: OVER_BUDGET }); return; }
          const answer = ready ? await answerOf(ready) : null;
          const usage = ready ? await Promise.resolve(options.usage?.(ready.conversation) ?? null).catch(() => null) : null;
          // A run cut short by the cap (a later turn refused) ends with the cap's code, not the model's error text.
          if (!answer || answer.error !== undefined) await end(key, (answer?.end ?? 'error') as RunEnd, { error: overBudget() ? OVER_BUDGET : answer?.error ?? `${agent} did not answer`, usage });
          else {
            const result = answer.result as RunAnswer | undefined;
            await end(key, 'completed', { output: result === undefined ? undefined : 'output' in result ? result.output : result.text, ...(answer.validation ? { validation: answer.validation } : {}), usage });
          }
        } catch (error) {
          const failure = validationError(error);
          await end(key, failure.end as RunEnd, { error: overBudget() ? OVER_BUDGET : failure.error }).catch(() => {});
        } finally { live.delete(key); }
      })();
      return ledger.view(ledger.get(key)!);
    },
    /** The run of this key as recorded, or null. Never waits on a delivery in flight: safe to call from inside one. */
    async status(key: string): Promise<RunView | null> {
      await recover();
      const row = ledger.get(key);
      return row ? ledger.view(row) : null;
    },
    /** Cancels it (its delivery gets `cancelled`); a run that has ended stays as it is; null: no such run. */
    async cancel(key: string): Promise<RunView | null> {
      if (!ledger.get(key)) return null;
      // A run whose preparation failed has nothing to abort; the cancelled end is delivered either way.
      await end(key, 'cancelled', {}, async () => { await (await live.get(key)?.catch(() => null))?.conversation.abort(context).catch(() => {}); });
      return ledger.view(ledger.get(key)!);
    },
    recover,
  };
}
export type Runner = ReturnType<typeof createRunner>;
