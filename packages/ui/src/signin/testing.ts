// A query budget for an app's sign-in, for the app's own tests (`@hachej/boring-ui-kit/signin/testing`, never loaded by a Worker).
//
// Why: on 24 Nov a sign-in that built Better Auth per request and checked the schema each time made about 97 D1 queries per request; one
// open browser tab was enough to use up a whole account's D1 allowance. A fake D1 that counts every statement, and a driver that makes a hundred
// signed-in requests through the real sign-in, fails such a build in the app's test run instead of on Cloudflare's bill.
//
//   import { assertSignInQueryBudget } from '@hachej/boring-ui-kit/signin/testing';
//   await assertSignInQueryBudget({ build: (database, firstOwnerHash) => signIn({ database, firstOwnerHash, ...the app's own options }) });
//
// `build` is called for every request, as the app's Worker does (its sign-in object is made inside `fetch`), so a per-request build that is
// expensive shows up; with no `build` the kit's own sign-in is driven with fictional options.
import { signIn } from './index.js';
import { applySignInMigration } from './migration.js';
import { resetSignInCaches } from './auth.js';

/** A new isolate: the sign-in objects and migrations the kit kept are forgotten, so the next `signIn(...)` builds and migrates again. */
export { resetSignInCaches, applySignInMigration };

/** The D1 methods Better Auth's dialect uses, on `node:sqlite`, counting every statement that runs. */
export interface CountingD1 {
  /** The database binding to give the sign-in as `database`. */
  readonly database: object;
  /** Every statement that ran (`prepare().run/all/first/raw`, each statement of a `batch`, and `exec`), in order. */
  readonly ran: string[];
  /** How many statements ran so far. */
  count(): number;
  /** The next `n` statements to run fail with this error (to test that a failure is not kept). */
  failNext(n: number, error?: Error): void;
}

interface Sqlite {
  prepare(sql: string): { all(...params: never[]): unknown[]; get(...params: never[]): unknown; run(...params: never[]): { changes: number | bigint; lastInsertRowid: number | bigint }; columns(): unknown[] };
  exec(sql: string): void;
}
/** `node:sqlite` (Node 22.3+), taken from the process rather than imported: the kit's source imports no `node:` module. */
function memoryDatabase(): Sqlite {
  const load = (globalThis as { process?: { getBuiltinModule?: (name: string) => unknown } }).process?.getBuiltinModule;
  const module = load?.('node:sqlite') as { DatabaseSync: new (path: string) => Sqlite } | undefined;
  if (!module) throw new Error('The query budget needs node:sqlite (Node 22.3 or later).');
  return new module.DatabaseSync(':memory:');
}
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (text: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
const random = (size: number) => hex(crypto.getRandomValues(new Uint8Array(size)));

export function countingD1(): CountingD1 {
  const sqlite = memoryDatabase();
  const ran: string[] = [];
  let failures = 0, failure = new Error('D1 busy (fictional)');
  const note = (sql: string) => { ran.push(sql); if (failures > 0) { failures--; throw failure; } };
  const statement = (sql: string, params: unknown[] = []) => {
    const rows = () => sqlite.prepare(sql).all(...(params as never[])) as Record<string, unknown>[];
    const self = {
      get reads() { return sqlite.prepare(sql).columns().length > 0; },
      bind: (...values: unknown[]) => statement(sql, values),
      all: async () => { note(sql); return { results: rows(), success: true, meta: { changes: 0 } }; },
      run: async () => {
        note(sql);
        const r = sqlite.prepare(sql).run(...(params as never[]));
        return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      },
      first: async (column?: string) => {
        note(sql);
        const row = sqlite.prepare(sql).get(...(params as never[])) as Record<string, unknown> | undefined;
        return row ? (column ? row[column] : row) : null;
      },
      raw: async () => { note(sql); return rows().map((r) => Object.values(r)); },
    };
    return self;
  };
  const database = {
    prepare: (sql: string) => statement(sql),
    // D1's batch answers each statement as `all()` does (Better Auth reads a table's columns this way), or as `run()` for a write.
    batch: async (list: { all: () => Promise<unknown>; run: () => Promise<unknown>; reads: boolean }[]) => { const out: unknown[] = []; for (const s of list) out.push(await (s.reads ? s.all() : s.run())); return out; },
    exec: async (sql: string) => { note(sql); sqlite.exec(sql); return { count: 1 }; },
  };
  return { database, ran, count: () => ran.length, failNext: (n, error) => { failures = n; if (error) failure = error; } };
}

/** What `build` makes: anything that answers the sign-in routes, as the kit's `signIn(...)` does. */
export interface Servable { handle(request: Request): Promise<Response | undefined> }

export interface QueryBudgetOptions {
  /** Makes the app's sign-in over `database`, as the app's Worker does at each request. `firstOwnerHash` is the first-owner link the driver signs up with. */
  readonly build?: (database: object, firstOwnerHash: string) => Servable;
  /** Signed-in requests to drive after the sign-up; 100 by default. */
  readonly requests?: number;
  /** The most statements one signed-in request may run; 10 by default. */
  readonly budget?: number;
  /** The path of the signed-in request; `/api/signin/me` by default. */
  readonly path?: string;
  /** The app's origin (fictional by default). */
  readonly origin?: string;
}

export interface QueryBudgetReport {
  readonly requests: number;
  /** Statements run by each driven request, in order. */
  readonly perRequest: readonly number[];
  readonly max: number;
  readonly mean: number;
  /** Statements run by the sign-up, before the first driven request (the migration is applied before and not counted). */
  readonly setup: number;
  /** The statements of the busiest request. */
  readonly worst: readonly string[];
}

/** Applies the kit's migration, signs a fictional person up through the first-owner link, then drives `requests` signed-in requests, each on a fresh isolate, and counts the statements of each. */
export async function measureSignInQueries(options: QueryBudgetOptions = {}): Promise<QueryBudgetReport> {
  const origin = options.origin ?? 'https://budget.fictional.test', requests = options.requests ?? 100, path = options.path ?? '/api/signin/me';
  const token = random(24), hash = await sha256(token);
  const d1 = countingD1();
  const secret = random(32);
  const build = options.build ?? ((database: object, firstOwnerHash: string) => signIn({ database, secret, origin, appName: 'Budget', firstOwnerHash }));
  const headers = { origin, 'cf-connecting-ip': '203.0.113.7' };

  // The deploy applied the sign-in tables (the kit's migration), once; a request never migrates nor checks the schema.
  await applySignInMigration(d1.database as never);
  const setupStart = d1.count();

  resetSignInCaches();
  const up = await build(d1.database, hash).handle(new Request(`${origin}/api/auth/sign-up/email`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json', 'x-boring-first-owner': token },
    body: JSON.stringify({ email: 'ada@budget.fictional.test', password: 'correct horse battery', name: 'Ada' }),
  }));
  if (up?.status !== 200) throw new Error(`The query budget could not sign its fictional person up: ${up?.status} ${await up?.text()}`);
  const cookie = up.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const setup = d1.count() - setupStart;

  const perRequest: number[] = [];
  let worst: string[] = [], max = -1;
  for (let i = 0; i < requests; i++) {
    // Each request on a NEW isolate, as on Cloudflare, where nearly every request is: nothing kept by an earlier request may save the next.
    resetSignInCaches();
    const before = d1.count();
    const r = await build(d1.database, hash).handle(new Request(`${origin}${path}`, { headers: { ...headers, cookie } }));
    if (r?.status !== 200) throw new Error(`Request ${i + 1} of the query budget was not signed in: ${r?.status}`);
    await r.arrayBuffer();
    const used = d1.count() - before;
    perRequest.push(used);
    if (used > max) { max = used; worst = d1.ran.slice(before); }
  }
  return { requests, perRequest, max, mean: perRequest.reduce((a, b) => a + b, 0) / Math.max(1, requests), setup, worst };
}

/** Throws when any signed-in request runs more than `budget` (10) statements; answers the report otherwise. */
export async function assertSignInQueryBudget(options: QueryBudgetOptions = {}): Promise<QueryBudgetReport> {
  const budget = options.budget ?? 10;
  const report = await measureSignInQueries(options);
  if (report.max > budget) {
    const shown = report.worst.slice(0, 12).map((sql) => `  ${sql.replace(/\s+/g, ' ').slice(0, 100)}`).join('\n');
    throw new Error(`Sign-in ran up to ${report.max} D1 statements for one signed-in request (mean ${report.mean.toFixed(1)}, budget ${budget}), over ${report.requests} requests.\n${shown}`);
  }
  return report;
}
