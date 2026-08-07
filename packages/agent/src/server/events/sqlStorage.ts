import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

const require = createRequire(import.meta.url)

export interface SqlResult {
  toArray(): Array<Record<string, unknown>>
}

export interface SqlStorage {
  exec(query: string, ...bindings: unknown[]): SqlResult
}

export type RunTransaction = <T>(fn: () => T) => T

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
  return <T>(fn: () => T): T => runTransaction(db, fn)
}

export function runTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN')
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
    // Matches SqliteAgentRequestLedger's pragmas (the sibling durable sqlite
    // store): WAL lets readers and the writer proceed concurrently, and
    // busy_timeout makes a writer wait out another connection's write lock
    // instead of throwing SQLITE_BUSY immediately. This matters here because
    // multiple runtime bindings for the SAME workspace scope (different
    // agentTypeId/identity/fingerprint keys — see createAgentHost.ts's
    // composition cache) can concurrently open the same on-disk event-stream
    // file; each is a distinct DatabaseSync connection but they are all
    // single in-process writers serialized by SQLite's file lock, not a
    // multi-replica/multi-process writer setup. busy_timeout absorbs that
    // in-process lock contention window instead of poisoning a live channel
    // on a transient SQLITE_BUSY.
    db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;')
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
