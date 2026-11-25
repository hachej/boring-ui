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
  /** The same binding under Cloudflare's rule (see `endsWithRequest`). */
  epochs(): RequestEpochs;
}

/** What Cloudflare says to a promise made by a request that has ended and awaited later. */
export const REQUEST_ENDED = 'This promise was created by a request that has since ended, so it can never settle';

export interface RequestEpochs {
  /** The ONE binding of the isolate (as `env.DB` is), the same object at every request. */
  readonly database: object;
  /** The request is over, the next begins: a statement made by an earlier request and used now, or a query of an earlier request that settles now, fails with `REQUEST_ENDED`. */
  nextRequest(): void;
}

/**
 * Cloudflare's rule, as far as a fake can model it: what a request creates (a prepared statement, the promise of a query) belongs to that request, and using it
 * or waiting on it after the request ended fails (« This promise was created by a request that has since ended »). The binding itself is the one object of the
 * isolate, as `env.DB` is. It catches an app or kit that keeps a statement or a query of request 1 for request 2. It CANNOT see inside Better Auth: the
 * promise that failed on Cloudflare (kit 0.6.2, 0.7.0) was Better Auth's own context, made by awaiting I/O, so the budget test also checks structurally that
 * `build` returns a sign-in with a Better Auth of its own at each request. Only workerd (`scripts/test-signin-workerd.mjs`) or a draft deploy proves the rest.
 */
export function endsWithRequest(database: object): RequestEpochs {
  const inner = database as { prepare: (sql: string) => Record<string, unknown>; batch: (list: unknown[]) => Promise<unknown>; exec: (sql: string) => Promise<unknown> };
  let epoch = 0;
  const originals = new WeakMap<object, unknown>();
  const guard = <T>(born: number, run: () => Promise<T>): Promise<T> => {
    if (born !== epoch) return Promise.reject(new Error(REQUEST_ENDED));
    return new Promise<T>((resolve, reject) => { run().then((value) => (born !== epoch ? reject(new Error(REQUEST_ENDED)) : resolve(value)), reject); });
  };
  const wrap = (statement: Record<string, unknown>, born: number): object => {
    const wrapped = {
      get reads() { return statement['reads']; },
      bind: (...values: unknown[]) => { if (born !== epoch) throw new Error(REQUEST_ENDED); return wrap((statement['bind'] as (...v: unknown[]) => Record<string, unknown>)(...values), born); },
      all: () => guard(born, () => (statement['all'] as () => Promise<unknown>)()),
      run: () => guard(born, () => (statement['run'] as () => Promise<unknown>)()),
      first: (column?: string) => guard(born, () => (statement['first'] as (c?: string) => Promise<unknown>)(column)),
      raw: () => guard(born, () => (statement['raw'] as () => Promise<unknown>)()),
    };
    originals.set(wrapped, statement);
    return wrapped;
  };
  return {
    database: {
      prepare: (sql: string) => wrap(inner.prepare(sql), epoch),
      batch: (list: object[]) => guard(epoch, () => inner.batch(list.map((statement) => originals.get(statement) ?? statement))),
      exec: (sql: string) => guard(epoch, () => inner.exec(sql)),
    },
    nextRequest: () => { epoch++; },
  };
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
  return { database, ran, count: () => ran.length, failNext: (n, error) => { failures = n; if (error) failure = error; }, epochs: () => endsWithRequest(database) };
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

/** Applies the kit's migration, signs a fictional person up through the first-owner link, then drives `requests` signed-in requests, each on its own view of the binding that ends with it (`endsWithRequest`), and counts the statements of each. */
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

  // The binding is the isolate's one object; a request's statements and queries end with it (`endsWithRequest`). Nothing a request makes may live on in the next:
  // each request's sign-in must also have a Better Auth of its own (Better Auth's promises are what Cloudflare refused in kit 0.6.2 and 0.7.0).
  const epochs = d1.epochs();
  let previous: unknown;
  const betterAuthOf = (app: Servable) => (app as { auth?: unknown }).auth ?? app;
  const fresh = (what: string) => {
    const app = build(epochs.database, hash), id = betterAuthOf(app);
    if (previous !== undefined && id === previous) throw new Error(`The sign-in of ${what} is the sign-in object of the request before: something is kept between requests (Cloudflare refuses a promise made by a request that has ended: ${REQUEST_ENDED}).`);
    previous = id;
    return app;
  };
  const up = await fresh('the sign-up').handle(new Request(`${origin}/api/auth/sign-up/email`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json', 'x-boring-first-owner': token },
    body: JSON.stringify({ email: 'ada@budget.fictional.test', password: 'correct horse battery', name: 'Ada' }),
  }));
  if (up?.status !== 200) throw new Error(`The query budget could not sign its fictional person up: ${up?.status} ${await up?.text()}`);
  await up.arrayBuffer(); epochs.nextRequest();
  const cookie = up.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const setup = d1.count() - setupStart;

  const perRequest: number[] = [];
  let worst: string[] = [], max = -1;
  for (let i = 0; i < requests; i++) {
    // Each request builds its own sign-in on its own view of the binding and ends it: as on Cloudflare, where nearly every request is a new isolate
    // and nothing made by an earlier request may be used by the next.
    const before = d1.count();
    const r = await fresh(`request ${i + 1}`).handle(new Request(`${origin}${path}`, { headers: { ...headers, cookie } }));
    if (r?.status !== 200) throw new Error(`Request ${i + 1} of the query budget was not signed in: ${r?.status} ${(await r?.text())?.slice(0, 200) ?? ''}`);
    await r.arrayBuffer();
    epochs.nextRequest();
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
