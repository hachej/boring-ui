// Exercises the REAL `runTransaction` primitive from `sqlStorage.ts` (the
// exact function `SqliteEventStreamStore`'s append paths call) with the same
// read-then-write critical-section shape as `allocateSeq`/`readIdempotencyKey`
// (SELECT the current offset, then UPDATE it) — from a SEPARATE OS thread
// with its own `node:sqlite` connection to the SAME file. Real thread
// concurrency is required: a single-threaded, fully synchronous test can
// never produce genuine overlap between two `node:sqlite` `DatabaseSync`
// critical sections.
//
// Excluded from the package tsconfig (see tsconfig.json's "exclude"): this
// file is spawned directly by Node as a `worker_threads.Worker` entry point
// under `--import tsx` (see eventStreamStore.concurrentAppend.test.ts), and
// Node's ESM resolver in that context only resolves the sibling
// `sqlStorage` import with an explicit `.ts` extension — which the
// package's `moduleResolution: "Bundler"` typecheck config rejects
// (TS5097) unless `allowImportingTsExtensions` is enabled project-wide.
// Excluding this one standalone worker script avoids a project-wide
// compiler flag change for a single non-published test fixture.
import { parentPort, workerData } from 'node:worker_threads'
import { openDatabase, runTransaction, type SqlTransactionMode } from '../../sqlStorage.ts'

interface WorkerInput {
  dbPath: string
  path: string
  mode: SqlTransactionMode
  iterations: number
  sharedBuf: SharedArrayBuffer
  sleepMs: number
}

interface WorkerResult {
  successes: number
  errors: Array<{ message: string; code?: string }>
  iterations: number
}

const { dbPath, path, mode, iterations, sharedBuf, sleepMs } = workerData as WorkerInput
const sync = new Int32Array(sharedBuf)

const { db, sql } = openDatabase(dbPath)

// Start barrier: block until the main thread flips sync[0] to 1, so both
// workers begin their hammering loop at effectively the same instant.
Atomics.wait(sync, 0, 0)

let successes = 0
const errors: WorkerResult['errors'] = []

for (let i = 0; i < iterations; i += 1) {
  try {
    runTransaction(db, () => {
      const row = sql.exec('SELECT next_offset FROM boring_event_streams WHERE path = ?', path).toArray()[0]
      // Widen the read-then-write window (the gap
      // readIdempotencyKey/allocateSeq's write leaves open) so the other
      // thread's commit is very likely to land inside it. sync[1] never
      // changes, so this is just a timed synchronous sleep.
      Atomics.wait(sync, 1, 0, sleepMs)
      const next = ((row?.next_offset as number | undefined) ?? 0) + 1
      sql.exec('UPDATE boring_event_streams SET next_offset = ? WHERE path = ?', next, path)
    }, mode)
    successes += 1
  } catch (error) {
    errors.push({ message: String((error as Error)?.message ?? error), code: (error as { code?: string })?.code })
  }
}

db.close()
parentPort?.postMessage({ successes, errors, iterations } satisfies WorkerResult)
