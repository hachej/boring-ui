import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

const require = createRequire(import.meta.url)

// DatabaseSync cannot yield while SQLite's busy handler waits. Keep each
// synchronous lock wait short; write callers retry asynchronously so the
// event loop can serve reads and unrelated work between attempts.
export const SQLITE_BUSY_TIMEOUT_MS = 25

export interface SqlResult {
  toArray(): Array<Record<string, unknown>>
}

export interface SqlStorage {
  exec(query: string, ...bindings: unknown[]): SqlResult
}

/**
 * `deferred` (SQLite's plain `BEGIN`) postpones acquiring any lock until the
 * first read or write inside the transaction. That is fine for read-only
 * transactions, but a transaction that reads THEN writes (e.g. a
 * check-then-insert) starts under a read lock and must upgrade to a write
 * lock mid-transaction — and SQLite refuses that upgrade with SQLITE_BUSY
 * immediately if another connection holds the write lock, WITHOUT honoring
 * `busy_timeout` (the busy handler only runs for the initial lock
 * acquisition, not a lock *upgrade*). `immediate` (`BEGIN IMMEDIATE`)
 * acquires the write lock up front, so `busy_timeout` applies normally and
 * a concurrent writer simply waits instead of erroring. Use `immediate` for
 * any transaction that writes — especially read-then-write — and reserve
 * `deferred` for genuinely read-only transactions.
 */
export type SqlTransactionMode = 'deferred' | 'immediate'

export type RunTransaction = <T>(fn: () => T, mode?: SqlTransactionMode) => T

export interface OpenDatabaseResult {
  db: DatabaseSync
  sql: SqlStorage
  runTransaction: RunTransaction
}

export function createNodeSqlStorage(db: DatabaseSync): SqlStorage {
  return {
    exec(query: string, ...bindings: unknown[]): SqlResult {
      const stmt = db.prepare(query)
      const expectsRows = queryExpectsRows(query)
      const rows = expectsRows
        ? stmt.all(...(bindings as never[])) as Array<Record<string, unknown>>
        : []
      if (!expectsRows) {
        stmt.run(...(bindings as never[]))
      }
      return {
        toArray() {
          return rows
        },
      }
    },
  }
}

export function createNodeTransactionSync(db: DatabaseSync): RunTransaction {
  return <T>(fn: () => T, mode: SqlTransactionMode = 'deferred'): T => runTransaction(db, fn, mode)
}

export function runTransaction<T>(db: DatabaseSync, fn: () => T, mode: SqlTransactionMode = 'deferred'): T {
  db.exec(mode === 'immediate' ? 'BEGIN IMMEDIATE' : 'BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function openDatabase(path: string): OpenDatabaseResult {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }

  const { DatabaseSync: SqliteDatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
  const db = new SqliteDatabaseSync(path)
  if (path !== ':memory:') {
    // WAL lets readers and the writer proceed concurrently. Keep the native
    // busy handler short because DatabaseSync occupies the event loop while
    // waiting; EventStreamStore retries transient writer contention
    // asynchronously instead of allowing one call to block for seconds.
    // Set the timeout before journal_mode so initialization is bounded too.
    db.exec(`PRAGMA busy_timeout=${SQLITE_BUSY_TIMEOUT_MS}; PRAGMA journal_mode=WAL;`)
  }

  return {
    db,
    sql: createNodeSqlStorage(db),
    runTransaction: createNodeTransactionSync(db),
  }
}

function queryExpectsRows(query: string): boolean {
  const trimmed = query.trimStart().toUpperCase()
  if (trimmed.startsWith('SELECT') || trimmed.startsWith('WITH') || trimmed.startsWith('PRAGMA')) return true
  return /\bRETURNING\b/i.test(query)
}
