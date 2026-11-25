// The sign-in's query budget (24 Nov outage: ~97 D1 queries per request, from a migration and a schema check at every request). Driven through the
// public entry points `@hachej/boring-ui-kit/signin` and `@hachej/boring-ui-kit/signin/testing`, on a counting fake D1. Fictional people only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { signIn } from '@hachej/boring-ui-kit/signin';
import { REQUEST_ENDED, assertSignInQueryBudget, countingD1 } from '@hachej/boring-ui-kit/signin/testing';

const fresh = () => randomBytes(32).toString('hex');

test('a hundred signed-in requests, each building the sign-in as a Worker does, stay within 10 D1 statements each', async () => {
  const report = await assertSignInQueryBudget({ requests: 100, budget: 10 });
  assert.equal(report.requests, 100);
  assert.equal(report.perRequest.length, 100);
  assert.ok(report.setup > 10, 'the first request migrated the schema');
  assert.ok(report.max <= 10, `at most 10 statements a request, saw ${report.max}`);
});

test('the budget helper fails an app whose sign-in costs more: a build that counts too much is refused', async () => {
  // An app that, say, looks the person up three extra times at each request.
  const secret = fresh();
  const greedy = (database, firstOwnerHash) => {
    const inner = signIn({ database, secret, origin: 'https://budget.fictional.test', appName: 'Greedy', firstOwnerHash });
    return { handle: async (request) => { for (let i = 0; i < 3; i++) await database.prepare('select 1').all(); return inner.handle(request); } };
  };
  await assert.rejects(assertSignInQueryBudget({ build: greedy, requests: 5, budget: 3 }), /Sign-in ran up to \d+ D1 statements/);
});

test('a database with no sign-in tables is a clear 503 and error, never a silent signed-out page or a bare 500', async () => {
  const secret = fresh(), origin = 'https://missing.fictional.test';
  const app = () => signIn({ database: countingD1().database, secret, origin, appName: 'Missing' });
  const asked = await app().handle(new Request(`${origin}/api/signin/me`, { headers: { cookie: 'better-auth.session_token=fictional.value' } }));
  assert.equal(asked.status, 503);
  const body = await asked.json();
  assert.equal(body.code, 'SIGNIN_TABLES_MISSING');
  assert.match(body.message, /signin\/migration\.sql/);
  assert.match(body.message, /wrangler d1 migrations apply/);
  await assert.rejects(app().personOf(new Request(origin, { headers: { cookie: 'better-auth.session_token=fictional.value' } })), /Sign-in tables are missing/);
});

test('nothing is kept between requests: signIn on the same binding and options is a new Better Auth every time, and a build that keeps one is refused', async () => {
  const database = countingD1().database;
  const options = { database, secret: fresh(), origin: 'https://one.fictional.test', appName: 'One' };
  assert.notEqual(signIn(options).auth, signIn({ ...options }).auth, 'a new Better Auth for each request');
  // An app (or a kit) that keeps the sign-in of request 1 for request 2: it holds request 1's binding, which ended with it.
  const secret = fresh(); let kept;
  const keeper = (db, firstOwnerHash) => (kept ??= signIn({ database: db, secret, origin: 'https://budget.fictional.test', appName: 'Keeper', firstOwnerHash }));
  await assert.rejects(assertSignInQueryBudget({ build: keeper, requests: 5 }), /kept between requests|since ended/);
  // And a fresh one at each request, as the kit does, passes under the same rule.
  const report = await assertSignInQueryBudget({ build: (db, firstOwnerHash) => signIn({ database: db, secret, origin: 'https://budget.fictional.test', appName: 'Fresh', firstOwnerHash }), requests: 10 });
  assert.ok(report.max <= 10);
});

test('endsWithRequest: a statement or a promise of an ended request fails as Cloudflare says', async () => {
  const d1 = countingD1(), epochs = d1.epochs();
  const statement = epochs.database.prepare('select 1 as one');
  assert.equal(JSON.stringify((await statement.all()).results), '[{"one":1}]');
  const pending = statement.all();
  epochs.nextRequest();
  await assert.rejects(pending, new RegExp(REQUEST_ENDED));
  await assert.rejects(statement.all(), new RegExp(REQUEST_ENDED));
  assert.equal(JSON.stringify((await epochs.database.prepare('select 2 as two').all()).results), '[{"two":2}]', 'the one binding works for the next request');
});
