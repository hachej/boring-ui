import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

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

  const db = new DatabaseSync(path)
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode=WAL')
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
