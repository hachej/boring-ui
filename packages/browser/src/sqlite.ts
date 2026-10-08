// pi-durable's `SqliteDatabase` over SQLite Wasm in a dedicated worker, persisted in the origin private file system
// through the `opfs-sahpool` VFS. It follows the Node adapter's rules: one connection, calls run in call order, and a
// transaction holds every later call until it settles. Without OPFS (an old browser, a test) it falls back to memory.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { SqliteDatabase } from '@earendil-works/pi-durable/storage/sqlite';
import type { SqliteConnection } from '@hachej/boring-files/sqlite';
import { sqlitePragmas } from '@hachej/boring-files/sqlite-settings';

/** The OPFS SAH pool VFS has no shared memory, so no WAL: a rollback journal truncated after each transaction. */
const OPFS_PRAGMAS = sqlitePragmas({ journalMode: 'truncate' }).join('; ');

export interface BrowserSqliteOptions {
  /** Where the host serves `sqlite3.wasm`. Omit it where the module can find the file itself. */
  readonly wasmUrl?: string;
  /** OPFS directory and VFS name for this origin's database files. Default `boring-agent`. */
  readonly name?: string;
}
/** A `SqliteDatabase` plus whether its file survives a reload. */
export type BrowserSqliteDatabase = SqliteDatabase & { readonly persistent: boolean };

/**
 * Another tab (or worker) of this origin already holds the OPFS database: `opfs-sahpool` lets one holder have its files.
 * `openBrowserSqlite` throws this instead of quietly falling back to a memory database that would lose the data.
 */
export class BrowserSqliteLockedError extends Error {
  readonly code = 'sqlite-locked';
  constructor(readonly databaseName: string, options?: { cause?: unknown }) {
    super('This app is already open in another tab. Close the other tab and reload this one: the browser database can be used by one tab at a time.', options);
    this.name = 'BrowserSqliteLockedError';
  }
}
/** Whether `error` is the typed one-tab error, also across a message boundary (a worker's error serialized as `{ code }`). */
export const isBrowserSqliteLocked = (error: unknown): error is BrowserSqliteLockedError =>
  error instanceof BrowserSqliteLockedError || (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'sqlite-locked');

// A held pool fails with NoModificationAllowedError from `createSyncAccessHandle`, wrapped by the VFS installer.
const heldElsewhere = (error: unknown): boolean => {
  const text = `${(error as { name?: string } | null)?.name ?? ''} ${error instanceof Error ? error.message : String(error)}`;
  return /NoModificationAllowed|another open access handle|already.*(open|locked)/i.test(text);
};

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
type Pool = Awaited<ReturnType<Sqlite3['installOpfsSAHPoolVfs']>>;
type Row = Record<string, unknown>;

const loaded = new Map<string, Promise<{ sqlite3: Sqlite3; pool: Pool | null }>>();
function load({ wasmUrl, name = 'boring-agent' }: BrowserSqliteOptions) {
  const key = `${wasmUrl ?? ''}|${name}`;
  let ready = loaded.get(key);
  if (!ready) {
    ready = (sqlite3InitModule as (config?: object) => ReturnType<typeof sqlite3InitModule>)(wasmUrl ? { locateFile: (file: string) => file.endsWith('.wasm') ? wasmUrl : file } : {}).then(async sqlite3 => {
      let pool: Pool | null = null;
      try { pool = await sqlite3.installOpfsSAHPoolVfs({ name, directory: `/${name}` }); }
      catch (error) {
        if (heldElsewhere(error)) throw new BrowserSqliteLockedError(name, { cause: error });
        console.warn('OPFS unavailable, using memory:', error instanceof Error ? error.message : error);
      }
      return { sqlite3, pool };
    });
    // A failed load is not cached: closing the other tab and calling again can succeed.
    ready.catch(() => { if (loaded.get(key) === ready) loaded.delete(key); });
    loaded.set(key, ready);
  }
  return ready;
}

class Queue {
  #tail: Promise<unknown> = Promise.resolve();
  run<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.#tail.then(operation);
    this.#tail = result.then(() => {}, () => {});
    return result;
  }
}

type Bound = null | number | string | Uint8Array | bigint;
const bind = (params: readonly Bound[]): Bound[] => params.map(value => typeof value === 'bigint' && value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value);

/** Open (or create) one database file. Rejects with `BrowserSqliteLockedError` when another tab holds the OPFS database. Call `close()` before `wipeBrowserSqlite`. */
export async function openBrowserSqlite(filename: string, options: BrowserSqliteOptions = {}): Promise<BrowserSqliteDatabase> {
  const { sqlite3, pool } = await load(options);
  const db = pool ? new pool.OpfsSAHPoolDb(filename) : new sqlite3.oo1.DB(filename, 'c');
  db.exec(`${OPFS_PRAGMAS}; PRAGMA foreign_keys = ON;`);
  const queue = new Queue();
  const rows = (sql: string, params: readonly Bound[]): Row[] => db.exec({ sql, ...(params.length ? { bind: bind(params) as never } : {}), rowMode: 'object', returnValue: 'resultRows' }) as unknown as Row[];
  const direct = {
    exec: async (sql: string): Promise<void> => { db.exec(sql); },
    run: async (sql: string, ...params: Bound[]): Promise<void> => { rows(sql, params); },
    get: async (sql: string, ...params: Bound[]): Promise<Row | undefined> => rows(sql, params)[0],
    all: async (sql: string, ...params: Bound[]): Promise<Row[]> => rows(sql, params),
  };
  let closed = false;
  const queued = Object.fromEntries(Object.entries(direct).map(([name, operation]) => [name, (...args: never[]) => {
    if (closed) return Promise.reject(new Error('SQLite database is closed'));
    return queue.run(() => (operation as (...inner: never[]) => Promise<unknown>)(...args));
  }])) as typeof direct;
  return {
    persistent: Boolean(pool),
    ...queued,
    transaction: <T>(callback: (tx: typeof direct) => Promise<T>): Promise<T> => queue.run(async () => {
      db.exec('BEGIN IMMEDIATE');
      let active = true;
      const guard = (operation: (...inner: never[]) => Promise<unknown>) => (...args: never[]) => active ? operation(...args) : Promise.reject(new Error('SQLite transaction handle is no longer active'));
      const handle = Object.fromEntries(Object.entries(direct).map(([name, operation]) => [name, guard(operation as (...inner: never[]) => Promise<unknown>)])) as typeof direct;
      try {
        const result = await callback(handle);
        active = false;
        db.exec('COMMIT');
        return result;
      } catch (error) {
        active = false;
        try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
        throw error;
      }
    }),
    close: () => queue.run(async () => { if (!closed) { closed = true; db.close(); } }),
  } as unknown as BrowserSqliteDatabase;
}

/**
 * The same kind of database file as a synchronous `SqliteConnection` (`@hachej/boring-files/sqlite`), for what needs one SQLite transaction
 * without awaiting: the workspace files of `@hachej/boring-files/sqlite-filesystem`. Use its own file, never one `openBrowserSqlite` holds.
 */
export async function openBrowserSqliteConnection(filename: string, options: BrowserSqliteOptions = {}): Promise<SqliteConnection & { readonly persistent: boolean; readonly close: () => void }> {
  const { sqlite3, pool } = await load(options);
  const db = pool ? new pool.OpfsSAHPoolDb(filename) : new sqlite3.oo1.DB(filename, 'c');
  db.exec(`${OPFS_PRAGMAS}; PRAGMA foreign_keys = ON;`);
  const rows = (sql: string, params: readonly Bound[]): Row[] => db.exec({ sql, ...(params.length ? { bind: bind(params) as never } : {}), rowMode: 'object', returnValue: 'resultRows' }) as unknown as Row[];
  let depth = 0;
  return {
    persistent: Boolean(pool),
    exec: sql => { db.exec(sql); },
    run: (sql, ...params) => { rows(sql, params as Bound[]); },
    get: <Value extends object>(sql: string, ...params: Bound[]) => rows(sql, params)[0] as Value | undefined,
    all: <Value extends object>(sql: string, ...params: Bound[]) => rows(sql, params) as Value[],
    // A transaction opened inside another one joins it.
    transaction: (mode, work) => {
      if (depth > 0) return work();
      db.exec(mode === 'write' ? 'BEGIN IMMEDIATE' : 'BEGIN');
      depth++;
      try {
        const result = work();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
        throw error;
      } finally { depth--; }
    },
    close: () => { db.close(); },
  };
}

/** Delete every database file of this origin and name (a "reset everything" button). Close every database first. */
export async function wipeBrowserSqlite(options: BrowserSqliteOptions = {}): Promise<void> {
  const { pool } = await load(options);
  if (pool) await pool.wipeFiles();
}
