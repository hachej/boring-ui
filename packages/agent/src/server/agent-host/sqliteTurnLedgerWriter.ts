import type { DatabaseSync } from 'node:sqlite'

const MAX_PENDING_LEDGER_WRITES = 256
const LEDGER_BUSY_TIMEOUT_MS = 0
const LEDGER_BUSY_RETRY_DELAY_MS = 25
const LEDGER_BUSY_RETRY_ATTEMPTS = 20

interface PendingLedgerWrite {
  readonly execute: () => unknown
  readonly observation: boolean
  readonly resolve: (value: unknown) => void
  readonly reject: (error: unknown) => void
}

function isBusy(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /database is locked|SQLITE_BUSY/iu.test(message)
}

function waitForRetry(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, LEDGER_BUSY_RETRY_DELAY_MS))
}

/** FIFO that bounds best-effort observations and keeps SQLite lock waits off the live event path. */
export class AsyncSqliteLedgerWriter {
  private readonly pending: PendingLedgerWrite[] = []
  private running = false
  private scheduled = false
  private closePromise: Promise<void> | undefined
  private resolveClose: (() => void) | undefined
  private closed = false

  constructor(private readonly database: DatabaseSync) {}

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closed = true
    if (!this.running && this.pending.length === 0) return Promise.resolve()
    this.closePromise = new Promise<void>((resolve) => { this.resolveClose = resolve })
    return this.closePromise
  }

  execute<T>(execute: () => T): Promise<T> {
    return this.enqueue(execute, false)
  }

  observe(execute: () => void): Promise<void> {
    return this.enqueue(execute, true)
  }

  private enqueue<T>(execute: () => T, observation: boolean): Promise<T> {
    if (this.closed) return Promise.reject(new Error('ledger writer is closed'))
    if (observation && this.pending.filter((write) => write.observation).length >= MAX_PENDING_LEDGER_WRITES) {
      return Promise.reject(new Error('ledger write buffer is full'))
    }
    const promise = new Promise<T>((resolve, reject) => {
      const write: PendingLedgerWrite = {
        execute,
        observation,
        resolve: (value) => resolve(value as T),
        reject,
      }
      if (observation) {
        this.pending.push(write)
      } else {
        const firstObservation = this.pending.findIndex((pending) => pending.observation)
        if (firstObservation < 0) this.pending.push(write)
        else this.pending.splice(firstObservation, 0, write)
      }
    })
    this.schedule()
    return promise
  }

  private schedule(): void {
    if (this.scheduled || this.running) return
    this.scheduled = true
    setImmediate(() => {
      this.scheduled = false
      void this.drainOne()
    })
  }

  private async drainOne(): Promise<void> {
    if (this.running) return
    const next = this.pending.shift()
    if (!next) {
      this.resolveClose?.()
      return
    }
    this.running = true
    try {
      next.resolve(await this.executeWithRetry(next.execute))
    } catch (error) {
      next.reject(error)
    } finally {
      this.running = false
      if (this.pending.length > 0) this.schedule()
      else this.resolveClose?.()
    }
  }

  private async executeWithRetry<T>(execute: () => T): Promise<T> {
    for (let attempt = 1; attempt <= LEDGER_BUSY_RETRY_ATTEMPTS; attempt += 1) {
      try {
        this.database.exec(`PRAGMA busy_timeout=${LEDGER_BUSY_TIMEOUT_MS};`)
        return execute()
      } catch (error) {
        if (!isBusy(error) || attempt === LEDGER_BUSY_RETRY_ATTEMPTS) throw error
      } finally {
        this.database.exec('PRAGMA busy_timeout=5000;')
      }
      await waitForRetry()
    }
    throw new Error('ledger retry loop exhausted')
  }
}
