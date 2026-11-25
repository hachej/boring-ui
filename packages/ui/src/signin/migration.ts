// The tables Better Auth needs for the kit's sign-in (user, session, account, jwks, invitation, the OAuth provider's, the rate limit), as plain SQL
// the app applies at DEPLOY, never at a request: on Cloudflare nearly every request is a new isolate, so a check at request time ran 110 queries a call.
//
//   wrangler:  copy `node_modules/@hachej/boring-ui-kit/dist/signin/migration.sql` to `migrations/NNNN_signin.sql`, then `wrangler d1 migrations apply`
//   scripts and tests:  `await applySignInMigration(env.DB)`
//
// Every statement is `IF NOT EXISTS`, so applying it to a database that already has the tables (an app that migrated at runtime until now) changes nothing.
// The SQL is derived from Better Auth's own `getMigrations` output for the kit's options by `scripts/signin-migration.mjs`, and a test fails when it drifts.
import { signInMigrationSql } from './migration-sql.js';

export { signInMigrationSql };

/** The migration as one statement each (the form D1 runs one at a time). */
export const signInMigrationStatements = (): string[] => signInMigrationSql.split(/;[ \t]*\r?\n/).map((statement) => statement.trim()).filter(Boolean);

/** Applies the sign-in tables to a D1 binding (or anything with `prepare(sql).run()`): for deploy scripts and tests. Safe to run again. */
export async function applySignInMigration(database: { prepare(sql: string): { run(): Promise<unknown> } }): Promise<void> {
  for (const statement of signInMigrationStatements()) await database.prepare(statement).run();
}

/** What a request says when the database has no sign-in tables. */
export const SIGNIN_TABLES_MISSING = 'Sign-in tables are missing from the database. Apply the kit\'s migration at deploy: copy @hachej/boring-ui-kit/signin/migration.sql (dist/signin/migration.sql) into the app\'s D1 migrations and run `wrangler d1 migrations apply`, or call applySignInMigration(env.DB) from the deploy script.';

/** Whether a failure (or what caused it) is a missing table or column of the sign-in schema. */
export function missingTables(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if (/no such (table|column)|has no column named|SQLITE_ERROR.*(table|column)/i.test(String((e as { message?: unknown }).message ?? e))) return true;
  }
  return false;
}
