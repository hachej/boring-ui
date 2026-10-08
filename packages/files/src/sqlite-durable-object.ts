import type { SqliteValue } from '@earendil-works/pi-durable/storage/sqlite';
import type { SqliteConnection } from './sqlite.js';

type DurableValue = ArrayBuffer | string | number | null;

/**
 * The part of a Cloudflare Durable Object's `ctx.storage` this adapter uses, declared structurally so the package needs no
 * Cloudflare types: `sql.exec(query, ...bindings)` returns a cursor and `transactionSync(work)` runs `work` as one SQLite transaction.
 */
export interface DurableObjectSqlStorage {
  readonly sql: { readonly exec: (query: string, ...bindings: DurableValue[]) => { readonly toArray: () => Record<string, unknown>[] } };
  readonly transactionSync: <Value>(work: () => Value) => Value;
}

function binding(value: SqliteValue): DurableValue {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError('SQLite integer is outside the safe range');
    return Number(value);
  }
  return value instanceof Uint8Array ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer : value;
}

/** Blobs come back as ArrayBuffers; the provider reads Uint8Arrays. */
function row<Row extends object>(raw: Record<string, unknown>): Row {
  for (const key of Object.keys(raw)) {
    const value = raw[key];
    if (value instanceof ArrayBuffer) raw[key] = new Uint8Array(value);
  }
  return raw as Row;
}

/**
 * A `SqliteConnection` over a SQLite-backed Durable Object's storage, for `openSqliteFileSystem({ connection })` and `createWorkspaceJournal(connection)`. Statements run on
 * the object's own synchronous SQL API. A `write` transaction is `transactionSync`: SQLite commits every statement of the callback
 * together, or rolls all of them back when it throws, and nothing else in the object runs in between because the callback is
 * synchronous. A `read` runs the callback directly, which is consistent for the same reason. The object owns the database:
 * the connection has no `close`.
 */
export function durableObjectSqliteConnection(storage: DurableObjectSqlStorage): SqliteConnection {
  const exec = (sql: string, params: readonly SqliteValue[]) => storage.sql.exec(sql, ...params.map(binding));
  let depth = 0;
  return {
    exec: sql => { exec(sql, []).toArray(); },
    run: (sql, ...params) => { exec(sql, params).toArray(); },
    get: <Row extends object>(sql: string, ...params: SqliteValue[]) => {
      const [first] = exec(sql, params).toArray();
      return first === undefined ? undefined : row<Row>(first);
    },
    all: <Row extends object>(sql: string, ...params: SqliteValue[]) => exec(sql, params).toArray().map(item => row<Row>(item)),
    // A transaction opened inside another one joins it.
    transaction: (mode, work) => {
      if (mode === 'read' || depth > 0) return work();
      depth++;
      try { return storage.transactionSync(work); } finally { depth--; }
    },
  };
}
