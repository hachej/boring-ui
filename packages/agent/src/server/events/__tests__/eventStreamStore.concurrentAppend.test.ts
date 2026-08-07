import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase, type SqlTransactionMode } from '../sqlStorage'
import { SqliteEventStreamStore } from '../eventStreamStore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WORKER_PATH = join(__dirname, 'fixtures', 'concurrentAppendWorker.ts')

interface WorkerResult {
  successes: number
  errors: Array<{ message: string; code?: string }>
  iterations: number
}

function runWorker(input: {
  dbPath: string
  path: string
  mode: SqlTransactionMode
  iterations: number
  sharedBuf: SharedArrayBuffer
  sleepMs: number
}): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    // `--import tsx` gives this worker thread the same TS/ESM loading the
    // rest of the repo gets from tsx, so it can import the real
    // `runTransaction`/`openDatabase` from sqlStorage.ts directly — this
    // test exercises actual production code, not a re-implementation of it.
    const worker = new Worker(WORKER_PATH, { workerData: input, execArgv: ['--import', 'tsx'] })
    worker.once('message', (message: WorkerResult) => {
      resolve(message)
      void worker.terminate()
    })
    worker.once('error', reject)
  })
}

async function setupStreamFile(dir: string): Promise<{ dbPath: string; path: string }> {
  const dbPath = join(dir, 'events.sqlite')
  const path = 'stream/concurrent-proof'
  const setup = openDatabase(dbPath)
  const setupStore = new SqliteEventStreamStore(setup.sql, setup.runTransaction)
  await setupStore.createStream(path)
  setup.db.close()
  return { dbPath, path }
}

async function runConcurrentPair(
  dbPath: string,
  path: string,
  mode: SqlTransactionMode,
): Promise<[WorkerResult, WorkerResult]> {
  const sharedBuf = new SharedArrayBuffer(8)
  const sync = new Int32Array(sharedBuf)
  const iterationsPerWorker = 60
  const workerInput = { dbPath, path, mode, iterations: iterationsPerWorker, sharedBuf, sleepMs: 5 }

  const [resultA, resultB] = await Promise.all([
    runWorker(workerInput),
    runWorker(workerInput),
    // Release the start barrier once both workers are spawned and past their
    // own Atomics.wait registration (worker startup + module eval dominates
    // that window, so a short delay is enough for both to be waiting).
    new Promise<void>((resolve) => setTimeout(() => {
      Atomics.store(sync, 0, 1)
      Atomics.notify(sync, 0)
      resolve()
    }, 50)),
  ]).then(([a, b]) => [a, b] as [WorkerResult, WorkerResult])

  return [resultA, resultB]
}

/**
 * Reproduces the exact contention shape flagged in PR #1128 review: two
 * SEPARATE `node:sqlite` connections to ONE on-disk file, each running the
 * REAL `runTransaction` primitive from sqlStorage.ts (the same function
 * `SqliteEventStreamStore.appendEvent`/`appendEventOnce`/`appendAgentEvent`
 * call) with the same read-then-write critical section shape as
 * `allocateSeq`/`readIdempotencyKey` (SELECT the current offset, then UPDATE
 * it). Real OS-thread concurrency (via `worker_threads`) is required — a
 * single-threaded, fully synchronous test can never produce genuine overlap
 * between two `node:sqlite` `DatabaseSync` critical sections.
 */
describe('runTransaction concurrent-write contention (real sqlStorage.ts primitive)', () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('BEGIN IMMEDIATE: concurrent appends from two connections over one file complete with no SQLITE_BUSY surfacing to either caller', async () => {
    dir = mkdtempSync(join(tmpdir(), 'boring-event-stream-concurrency-'))
    const { dbPath, path } = await setupStreamFile(dir)
    const [resultA, resultB] = await runConcurrentPair(dbPath, path, 'immediate')

    // PROOF: neither connection's caller ever saw a busy/lock error, and
    // every one of the 120 total read-then-write critical sections
    // committed successfully — this is the "no poisoned channel" bar from
    // the review. Without BEGIN IMMEDIATE (mode: 'deferred'), this reliably
    // fails — see the companion test below, which proves this test is
    // non-vacuous.
    expect(resultA.errors).toEqual([])
    expect(resultB.errors).toEqual([])
    expect(resultA.successes).toBe(60)
    expect(resultB.successes).toBe(60)
  }, 20_000)

  it('BEGIN (deferred): the same concurrent shape reliably surfaces SQLITE_BUSY — proves the immediate-mode test above is non-vacuous', async () => {
    dir = mkdtempSync(join(tmpdir(), 'boring-event-stream-concurrency-deferred-'))
    const { dbPath, path } = await setupStreamFile(dir)
    const [resultA, resultB] = await runConcurrentPair(dbPath, path, 'deferred')

    const allErrors = [...resultA.errors, ...resultB.errors]
    // This is the bug this whole change fixes: a deferred BEGIN's
    // read-then-write upgrade throws SQLITE_BUSY immediately (without
    // honoring busy_timeout) whenever the other connection committed in
    // between the read and the write. With real concurrent hammering and a
    // widened read-then-write window, this reproduces reliably.
    expect(allErrors.length).toBeGreaterThan(0)
    // node:sqlite's SQLITE_BUSY surfaces as ERR_SQLITE_ERROR with message
    // "database is locked" — assert on the stable error code plus either
    // wording SQLite uses for this condition.
    expect(allErrors.some((error) => error.code === 'ERR_SQLITE_ERROR' && /lock|busy/i.test(error.message))).toBe(true)
  }, 20_000)
})

describe('SqliteEventStreamStore write-path transaction mode wiring', () => {
  it('uses immediate-mode transactions for every write path (appendEvent, appendEventOnce, appendAgentEvent)', async () => {
    const { sql, runTransaction, db } = openDatabase(':memory:')
    const modes: Array<SqlTransactionMode | undefined> = []
    const spyingRunTransaction = (<T>(fn: () => T, mode?: SqlTransactionMode): T => {
      modes.push(mode)
      return runTransaction(fn, mode)
    }) as typeof runTransaction

    try {
      const store = new SqliteEventStreamStore(sql, spyingRunTransaction)
      await store.createStream('p')
      await store.appendEvent('p', { a: 1 })
      await store.appendEventOnce('p', 'key-1', { a: 2 })
      await store.appendAgentEvent('s1', { type: 'agent-start', seq: 0, turnId: 't' }, { streamPath: 'p' })

      // Each of the three write paths must request 'immediate' — a
      // read-then-write transaction under the default 'deferred' mode is
      // exactly the bug this fix closes (see the concurrent-write tests
      // above for the real-contention proof).
      expect(modes).toEqual(['immediate', 'immediate', 'immediate'])
    } finally {
      db.close()
    }
  })
})
