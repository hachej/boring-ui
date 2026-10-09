/**
 * The one place v4 chooses SQLite connection settings (journal mode, locking mode, busy timeout, synchronous, temp store).
 * Every opener (`openNodeConnection`, `openNodeDatabase` for Pi's own storage, the browser's SQLite Wasm) takes a
 * `SqliteSettings` and turns it into statements here; `npm run check` refuses `PRAGMA journal_mode` and `PRAGMA locking_mode`
 * anywhere else. Values are allow-listed: there is no free-form pragma name or value, so a setting cannot inject SQL.
 * Pure: no `node:*` import, safe in a browser bundle.
 */

/** `wal` needs shared memory between the connections of one host: never on a network file system. */
export type SqliteJournalMode = 'wal' | 'delete' | 'truncate' | 'persist';
/** `exclusive`: the connection takes the file's lock when it opens and keeps it until it closes (one owner per file). */
export type SqliteLockingMode = 'normal' | 'exclusive';
export type SqliteSynchronous = 'off' | 'normal' | 'full' | 'extra';
export type SqliteTempStore = 'default' | 'file' | 'memory';

export interface SqliteSettings {
  readonly journalMode?: SqliteJournalMode;
  readonly lockingMode?: SqliteLockingMode;
  /** How long a statement waits for another connection's lock before failing with `database is locked`. 0 to 600 000 ms. */
  readonly busyTimeoutMs?: number;
  readonly synchronous?: SqliteSynchronous;
  readonly tempStore?: SqliteTempStore;
}

/** Complete settings: what an opener applies after filling the caller's partial settings from `sqliteSettings.localDisk`. */
export type ResolvedSqliteSettings = Required<SqliteSettings>;

/**
 * Presets. `localDisk` is the default of every v4 opener (and what `openNodeConnection` always did). `networkFilesystem` is for a
 * file on NFS such as Amazon EFS, owned by one process (one writer per SQLite file, docs/architecture/HOST-RECIPE-AWS.md):
 * rollback journal instead of WAL (WAL's shared-memory index is unsafe across hosts), the lock taken once at open and held
 * (no per-transaction lock round trips; a second opener fails with `SqliteLockedError` instead of writing beside the owner),
 * full sync, temporary tables in memory.
 */
export const sqliteSettings: { readonly localDisk: ResolvedSqliteSettings; readonly networkFilesystem: ResolvedSqliteSettings } = Object.freeze({
  localDisk: Object.freeze({ journalMode: 'wal', lockingMode: 'normal', busyTimeoutMs: 5000, synchronous: 'full', tempStore: 'default' } as const),
  networkFilesystem: Object.freeze({ journalMode: 'delete', lockingMode: 'exclusive', busyTimeoutMs: 10000, synchronous: 'full', tempStore: 'memory' } as const),
});

const allowed = {
  journalMode: ['wal', 'delete', 'truncate', 'persist'],
  lockingMode: ['normal', 'exclusive'],
  synchronous: ['off', 'normal', 'full', 'extra'],
  tempStore: ['default', 'file', 'memory'],
} as const;
const KEYS = new Set(['journalMode', 'lockingMode', 'busyTimeoutMs', 'synchronous', 'tempStore']);

/** Checks `settings` and returns a frozen copy of the given fields only. Throws a `TypeError` naming the first invalid field. */
export function validateSqliteSettings(settings: SqliteSettings): SqliteSettings {
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) throw new TypeError('SQLite settings must be an object');
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!KEYS.has(key)) throw new TypeError(`Unknown SQLite setting ${JSON.stringify(key)}`);
    if (value === undefined) continue;
    if (key === 'busyTimeoutMs') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 600_000) throw new TypeError('busyTimeoutMs must be an integer from 0 to 600000');
    } else if (!(allowed[key as keyof typeof allowed] as readonly unknown[]).includes(value)) {
      throw new TypeError(`${key} must be one of ${allowed[key as keyof typeof allowed].join(', ')}`);
    }
    copy[key] = value;
  }
  return Object.freeze(copy) as SqliteSettings;
}

/** `settings` over `base` (the local-disk preset unless given), validated. */
export function resolveSqliteSettings(settings: SqliteSettings = {}, base: ResolvedSqliteSettings = sqliteSettings.localDisk): ResolvedSqliteSettings {
  return Object.freeze({ ...base, ...validateSqliteSettings(settings) }) as ResolvedSqliteSettings;
}

/**
 * The statements for the given fields, in the order they must run: the busy timeout first (so the others wait for a lock),
 * the locking mode before the journal mode (exclusive WAL then needs no shared memory).
 */
export function sqlitePragmas(settings: SqliteSettings): string[] {
  const valid = validateSqliteSettings(settings), statements: string[] = [];
  if (valid.busyTimeoutMs !== undefined) statements.push(`PRAGMA busy_timeout = ${valid.busyTimeoutMs}`);
  if (valid.lockingMode !== undefined) statements.push(`PRAGMA locking_mode = ${valid.lockingMode.toUpperCase()}`);
  if (valid.journalMode !== undefined) statements.push(`PRAGMA journal_mode = ${valid.journalMode.toUpperCase()}`);
  if (valid.synchronous !== undefined) statements.push(`PRAGMA synchronous = ${valid.synchronous.toUpperCase()}`);
  if (valid.tempStore !== undefined) statements.push(`PRAGMA temp_store = ${valid.tempStore.toUpperCase()}`);
  return statements;
}

/** The file is held by another connection (`lockingMode: 'exclusive'` elsewhere, or a writer that outlasted the busy timeout). */
export class SqliteLockedError extends Error {
  readonly code = 'sqlite-locked';
  constructor(readonly filename: string, options?: { cause?: unknown }) {
    super(`The SQLite file ${filename} is locked by another connection (one writer per file); it was not opened`, options);
    this.name = 'SqliteLockedError';
  }
}

const isLocked = (error: unknown) => /database is locked|SQLITE_BUSY|database table is locked/i.test(String((error as { message?: unknown })?.message ?? ''));

/**
 * Applies resolved settings to an open database through its `exec`/`get`, checks the journal mode took effect (`memory` is what an
 * in-memory database reports for any of them), and under `exclusive` takes the lock now with an empty exclusive transaction,
 * so the owner is decided at open. A lock held elsewhere becomes `SqliteLockedError`.
 */
export function applySqliteSettings(db: { readonly exec: (sql: string) => void; readonly get: (sql: string) => Record<string, unknown> | undefined },
  settings: ResolvedSqliteSettings, filename: string): void {
  try {
    for (const statement of sqlitePragmas(settings)) {
      if (!statement.startsWith('PRAGMA journal_mode')) { db.exec(statement); continue; }
      const mode = String(db.get(statement)?.journal_mode ?? '').toLowerCase();
      if (mode !== settings.journalMode && mode !== 'memory') throw new Error(`SQLite kept journal_mode ${mode || '(none)'} instead of ${settings.journalMode} for ${filename}`);
    }
    if (settings.lockingMode === 'exclusive') db.exec('BEGIN EXCLUSIVE; COMMIT');
  } catch (error) {
    if (isLocked(error)) throw new SqliteLockedError(filename, { cause: error });
    throw error;
  }
}
