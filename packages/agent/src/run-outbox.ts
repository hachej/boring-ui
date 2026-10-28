/**
 * The outbox of runs an app operation asks for. The operation stages its starts in the SAME transaction as its writes and its
 * receipt, in the store it touches (the app database and the agent home are two stores: this table is the only glue). After the
 * commit the host launches each row with its key and removes it once the run is acknowledged; a row left behind (a crash, a
 * refused call) is launched again later, which the key makes harmless. Runtime-neutral: `SyncSql` is the store's synchronous SQL
 * (a Durable Object's `sql.exec`, `node:sqlite`); this file opens no transaction and no connection.
 */

/** The store's synchronous SQL: rows as plain objects (`SELECT`), or `[]` (a write). */
export type SyncSql = (sql: string, params: unknown[]) => Record<string, unknown>[];

export const EFFORTS = Object.freeze(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const);
export type Effort = typeof EFFORTS[number];
export const MODEL_ID = /^[A-Za-z0-9@:/._-]{1,120}$/;
export const START_KEY = /^[\w.:-]{1,100}$/;
export const AGENT_NAME = /^[a-z][a-z0-9-]{0,40}$/;
export const OPERATION_NAME = /^[a-z][\w-]*\.[a-z][\w.-]*$/;
export const MAX_START_INPUT = 100_000;
export const MAX_STARTS = 20;
const BACKOFF_FIRST_MS = 1000;
const BACKOFF_MAX_MS = 5 * 60_000;

export const OUTBOX_TABLE = 'CREATE TABLE IF NOT EXISTS _host_agent_outbox (actor TEXT NOT NULL, key TEXT NOT NULL, agent TEXT NOT NULL, input TEXT NOT NULL, deliver TEXT, person TEXT NOT NULL, at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(actor, key))';

/** A run an operation asks for: `input` is any JSON, `deliver` the operation that receives the run's end, `model` and `effort` this run's own. */
export interface Start { readonly key: string; readonly agent: string; readonly input?: unknown; readonly deliver?: string | null; readonly model?: string | null; readonly effort?: Effort | null }
/** A start as stored: `input` is JSON text. */
export interface CheckedStart { readonly key: string; readonly agent: string; readonly input: string; readonly deliver: string | null; readonly model: string | null; readonly effort: Effort | null }
export interface OutboxRow<P = unknown> {
  readonly actor: string; readonly key: string; readonly agent: string; readonly input: unknown; readonly deliver: string | null;
  readonly person: P; readonly at: string; readonly attempts: number; readonly next_at: number;
  readonly model?: string; readonly effort?: Effort;
}
type Awaitable<T> = T | Promise<T>;
/** The outbox of one store as its owner reads it. A remote store (a Durable Object other than the caller) offers the same calls over RPC. */
export interface Outbox<P = unknown> {
  /** The rows due at `now`, oldest first. */
  due(now: number, limit?: number): Awaitable<OutboxRow<P>[]>;
  pending(actor: string, key: string): Awaitable<OutboxRow<P> | null>;
  /** The earliest due time, or null when the outbox is empty. */
  next(): Awaitable<number | null>;
  /** The run exists: drop the row. */
  ack(actor: string, key: string): Awaitable<null>;
  /** A launch that may work later: back off (1 s doubling, 5 min at most). */
  retry(row: OutboxRow<P>, now: number): Awaitable<null>;
}
export type Launched = { readonly ok: true } | { readonly ok: false; readonly retry?: boolean; readonly status?: number; readonly error?: string };

/** `options` (JSON: { model?, effort? }) came later than the table: a store created before it gets the column here. */
function ready(run: SyncSql): void {
  run(OUTBOX_TABLE, []);
  try { run('ALTER TABLE _host_agent_outbox ADD COLUMN options TEXT', []); }
  catch (error) { if (!/duplicate column/i.test(String((error as Error)?.message ?? error))) throw error; }
}

/** The runs an operation asked for, checked once more by the host: bounded, well named, and a key never used twice for different runs. Throws a `{ status: 400 }` error. */
export function checkStarts(starts: unknown): CheckedStart[] {
  const refuse = (message: string): never => { throw Object.assign(new Error(message), { status: 400 }); };
  if (!Array.isArray(starts) || starts.length > MAX_STARTS) refuse(`an operation starts at most ${MAX_STARTS} agent runs`);
  const seen = new Map<string, CheckedStart>();
  return (starts as Partial<Start>[]).map((s) => {
    if (typeof s?.key !== 'string' || !START_KEY.test(s.key)) refuse("agents.start: key is 1 to 100 letters, digits, '.', ':', '_' or '-'");
    if (typeof s.agent !== 'string' || !AGENT_NAME.test(s.agent)) refuse('agents.start: agent is an agent name');
    if (s.deliver != null && (typeof s.deliver !== 'string' || !OPERATION_NAME.test(s.deliver))) refuse('agents.start: deliver is an operation name');
    const input = JSON.stringify(s.input ?? '') as string | undefined;
    if (typeof input !== 'string' || input.length > MAX_START_INPUT) refuse(`agents.start: input must be JSON, at most ${MAX_START_INPUT} characters`);
    if (s.model != null && (typeof s.model !== 'string' || !MODEL_ID.test(s.model))) refuse('agents.start: model is a model id from the approved catalog');
    if (s.effort != null && !EFFORTS.includes(s.effort)) refuse(`agents.start: effort is one of ${EFFORTS.join(', ')}`);
    const start: CheckedStart = { key: s.key as string, agent: s.agent as string, input: input as string, deliver: s.deliver ?? null, model: s.model ?? null, effort: s.effort ?? null };
    const before = seen.get(start.key);
    if (before && (before.agent !== start.agent || before.input !== start.input || before.deliver !== start.deliver || before.model !== start.model || before.effort !== start.effort)) refuse(`agents.start: key ${start.key} is used twice with different runs`);
    seen.set(start.key, start);
    return start;
  }).filter((s, i, all) => all.findIndex(o => o.key === s.key) === i);
}

/**
 * Stage rows inside the caller's transaction (its own BEGIN/COMMIT or `transactionSync`: this function never opens one). Keys are
 * scoped by actor, and the store is already one app's one scope: Alice and Bob may use the same key. A key staged before and not
 * yet launched keeps its first row.
 */
export function stageStarts(run: SyncSql, options: { actor: string; person: unknown; starts: unknown; at: string }): void {
  ready(run);
  const who = JSON.stringify(options.person);
  for (const s of checkStarts(options.starts)) {
    const own = s.model || s.effort ? JSON.stringify({ ...(s.model ? { model: s.model } : {}), ...(s.effort ? { effort: s.effort } : {}) }) : null;
    run('INSERT OR IGNORE INTO _host_agent_outbox (actor, key, agent, input, deliver, person, at, options) VALUES (?,?,?,?,?,?,?,?)', [options.actor, s.key, s.agent, s.input, s.deliver, who, options.at, own]);
  }
}

const rowOf = <P>({ options, ...r }: Record<string, unknown>): OutboxRow<P> =>
  ({ ...r, input: JSON.parse(r.input as string), person: JSON.parse(r.person as string), ...(options ? JSON.parse(options as string) : {}) }) as unknown as OutboxRow<P>;

/** The outbox of one store (`SyncSql` synchronous): see `Outbox`. */
export function outboxOver<P = unknown>(run: SyncSql): Outbox<P> {
  return {
    due(now, limit = 20) { ready(run); return run('SELECT * FROM _host_agent_outbox WHERE next_at <= ? ORDER BY at, rowid LIMIT ?', [now, limit]).map(r => rowOf<P>(r)); },
    pending(actor, key) { ready(run); const r = run('SELECT * FROM _host_agent_outbox WHERE actor = ? AND key = ?', [actor, key])[0]; return r ? rowOf<P>(r) : null; },
    next() { ready(run); return (run('SELECT MIN(next_at) AS at FROM _host_agent_outbox', [])[0]?.at as number | null | undefined) ?? null; },
    ack(actor, key) { ready(run); run('DELETE FROM _host_agent_outbox WHERE actor = ? AND key = ?', [actor, key]); return null; },
    retry(row, now) { ready(run); run('UPDATE _host_agent_outbox SET attempts = attempts + 1, next_at = ? WHERE actor = ? AND key = ?', [now + Math.min(BACKOFF_FIRST_MS * 2 ** Math.min(row.attempts, 20), BACKOFF_MAX_MS), row.actor, row.key]); return null; },
  };
}

/**
 * Launch the rows that are due (or only `only` = { actor, key }, due or not) through `outbox`. `launch(row)` starts the run and
 * answers `{ ok: true }` when it exists (a replay of the key counts), `{ ok: false, retry: true }` for a refusal that may pass
 * (service down, overloaded), `{ ok: false }` for one that never will (the key belongs to another agent): that row is dropped and
 * `onDrop(row, answer)` told. `cutoff` selects rows independently of `now`, the retry clock (a start-up can ignore old backoff).
 * One failing row never stops the others; a row is removed only after the run was acknowledged.
 */
export async function drainStarts<P = unknown>(outbox: Outbox<P>, options: {
  now: number; cutoff?: number; launch: (row: OutboxRow<P>) => Promise<Launched>;
  only?: { actor: string; key: string } | null; onDrop?: (row: OutboxRow<P>, answer: Launched) => void;
}): Promise<{ launched: string[]; retried: string[]; dropped: string[] }> {
  const { now, cutoff = now, launch, only = null, onDrop = () => {} } = options;
  const rows = only ? [await outbox.pending(only.actor, only.key)].filter((r): r is OutboxRow<P> => r !== null) : await outbox.due(cutoff);
  const out = { launched: [] as string[], retried: [] as string[], dropped: [] as string[] };
  for (const row of rows) {
    let r: Launched;
    try { r = await launch(row); } catch (error) { r = { ok: false, retry: true, error: String((error as Error)?.message ?? error) }; }
    if (r?.ok) { await outbox.ack(row.actor, row.key); out.launched.push(row.key); }
    else if (r?.retry) { await outbox.retry(row, now); out.retried.push(row.key); }
    else { await outbox.ack(row.actor, row.key); out.dropped.push(row.key); onDrop(row, r); }
  }
  return out;
}
