import type { SqliteConnection } from './sqlite.js';

/**
 * Internal (not a package export): what the workspace provider needs from the SQLite file system to commit a multi-file batch in
 * one transaction. Registered by `openSqliteFileSystem` against the file system object it returns, so the provider keeps taking a
 * plain Pi `FileSystem`. Both functions are synchronous and run inside `connection.transaction`.
 */
export interface SqliteBatch {
  readonly connection: SqliteConnection;
  /** The bytes of the regular file at an absolute path, `null` when nothing is there, `undefined` when it is not a file. */
  readonly bytes: (path: string) => Uint8Array | null | undefined;
  /** Write a regular file at an absolute path, creating its missing parent directories. Throws a Pi `FileError` on failure. */
  readonly write: (path: string, bytes: Uint8Array) => void;
}

const batches = new WeakMap<object, SqliteBatch>();
const journals = new WeakMap<object, SqliteConnection>();

export const registerSqliteBatch = (fs: object, batch: SqliteBatch): void => { batches.set(fs, batch); };
export const sqliteBatchOf = (fs: object): SqliteBatch | undefined => batches.get(fs);
/** The journal's connection, so the provider can commit the bytes and the receipt in one transaction when they share a database. */
export const registerJournalConnection = (journal: object, connection: SqliteConnection): void => { journals.set(journal, connection); };
export const journalConnectionOf = (journal: object): SqliteConnection | undefined => journals.get(journal);
