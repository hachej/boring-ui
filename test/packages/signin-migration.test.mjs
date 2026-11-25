// The kit's sign-in migration (`@hachej/boring-ui-kit/signin/migration.sql`, `signInMigrationSql`, `applySignInMigration`): the shipped SQL is what Better Auth's
// own getMigrations would create for the kit's options (a drift fails here), applying it leaves nothing for getMigrations to add, and applying twice changes nothing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { getMigrations } from 'better-auth/db/migration';
import { signIn, signInMigrationSql, signInMigrationStatements } from '@hachej/boring-ui-kit/signin';
import { applySignInMigration, countingD1, resetSignInCaches } from '@hachej/boring-ui-kit/signin/testing';
import { FULL_OPTIONS, deriveSignInMigration } from '../../scripts/signin-migration.mjs';

const options = (database, extra = {}) => ({ database, secret: 'derive-'.repeat(8), origin: 'https://migration.fictional.test', appName: 'Migration', ...extra });

test('the shipped SQL is exactly what Better Auth creates for the kit, for every option set', async () => {
  for (const extra of [{}, FULL_OPTIONS, { provider: true }, { google: FULL_OPTIONS.google }, { studio: FULL_OPTIONS.studio }]) {
    assert.equal(await deriveSignInMigration(extra), signInMigrationSql, `drift for ${Object.keys(extra).join(', ') || 'no options'}: run node scripts/signin-migration.mjs --write`);
  }
  assert.ok(signInMigrationStatements().length > 30);
  assert.ok(signInMigrationStatements().every((s) => /^create (unique )?(table|index) if not exists /.test(s)), 'every statement is IF NOT EXISTS');
});

test('after the migration Better Auth has nothing to create or add, and applying it again changes nothing', async () => {
  const d1 = countingD1();
  await applySignInMigration(d1.database);
  await applySignInMigration(d1.database);
  resetSignInCaches();
  const { auth } = signIn(options(d1.database, FULL_OPTIONS));
  const plan = await getMigrations(auth.options);
  assert.deepEqual([plan.toBeCreated.map((t) => t.table), plan.toBeAdded.map((t) => t.table)], [[], []]);
});

test('the SQL file in the package is the same text as the string export', async () => {
  const file = readFileSync(new URL('../../packages/ui/dist/signin/migration.sql', import.meta.url), 'utf8');
  assert.equal(file, signInMigrationSql);
  assert.ok(file.includes('create table if not exists "oauthResource"'), 'the MCP tables are in it');
  assert.ok(file.includes('create table if not exists "invitation"'), 'the invitation list is in it');
  assert.ok(file.includes('create table if not exists "rateLimit"'), 'the rate limit table is in it');
});
