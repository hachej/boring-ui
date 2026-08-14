import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  openDatabase,
  SQLITE_BUSY_TIMEOUT_MS,
  type SqlTransactionMode,
} from '../sqlStorage'
import {
  SQLITE_BUSY_RETRY_WINDOW_MS,
  SqliteEventStreamStore,
} from '../eventStreamStore'

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

async function startHoldingWriteLock(dbPath: string, holdMs: number): Promise<{ done: Promise<void> }> {
  let resolveLocked!: () => void
  let rejectLocked!: (error: Error) => void
  let resolveDone!: () => void
  let rejectDone!: (error: Error) => void
  const locked = new Promise<void>((resolve, reject) => {
    resolveLocked = resolve
    rejectLocked = reject
  })
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads')
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(workerData.dbPath)
    db.exec('PRAGMA busy_timeout=1000; BEGIN IMMEDIATE')
    parentPort.postMessage('locked')
    Atomics.wait(new Int32Array(workerData.sleep), 0, 0, workerData.holdMs)
    db.exec('COMMIT')
    db.close()
    parentPort.postMessage('done')
  `, {
    eval: true,
    workerData: { dbPath, holdMs, sleep: new SharedArrayBuffer(4) },
  })
  worker.on('message', (message: string) => {
    if (message === 'locked') resolveLocked()
    if (message === 'done') {
      resolveDone()
      void worker.terminate()
    }
  })
  worker.once('error', (error) => {
    rejectLocked(error)
    rejectDone(error)
  })
  await locked
  return { done }
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

describe('SqliteEventStreamStore event-loop contention bound', () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('does not let a concurrent writer stall reads or the event loop beyond the configured bounds', async () => {
    dir = mkdtempSync(join(tmpdir(), 'boring-event-stream-write-bound-'))
    const { dbPath, path } = await setupStreamFile(dir)
    const opened = openDatabase(dbPath)
    const store = new SqliteEventStreamStore(opened.sql, opened.runTransaction)

    try {
      const lock = await startHoldingWriteLock(dbPath, 1_000)
      const startedAt = performance.now()
      let timerElapsed = Number.POSITIVE_INFINITY
      const timer = new Promise<void>((resolve) => setTimeout(() => {
        timerElapsed = performance.now() - startedAt
        resolve()
      }, 50))
      const appendResult = store.appendEvent(path, { waitsForLock: true }).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      )
      const readStartedAt = performance.now()
      await expect(store.readEvents(path, { offset: '-1' })).resolves.toMatchObject({ events: [] })
      expect(performance.now() - readStartedAt).toBeLessThan(SQLITE_BUSY_TIMEOUT_MS + 150)

      await timer
      const result = await appendResult
      const operationElapsed = performance.now() - startedAt

      // busy_timeout=5000 held this timer until the worker released its lock.
      // The short native wait lets it run near schedule; timer-based retries
      // then give up inside a bounded window under sustained contention.
      expect(timerElapsed).toBeLessThan(SQLITE_BUSY_TIMEOUT_MS + 150)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(String(result.error)).toMatch(/lock|busy/i)
      expect(operationElapsed).toBeLessThan(
        SQLITE_BUSY_RETRY_WINDOW_MS + SQLITE_BUSY_TIMEOUT_MS + 250,
      )

      await lock.done
    } finally {
      opened.db.close()
    }
  }, 5_000)
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
