import type { DatabaseSync } from 'node:sqlite'
import { AgentGatewayErrorCode } from '../../shared/index'

const MAX_PENDING_TURN_WRITES = 256
const TURN_BUSY_TIMEOUT_MS = 25
const TURN_BUSY_RETRY_ATTEMPTS = 100

interface StartTurnWrite {
  readonly runKey: string
  readonly sessionKey: string
  readonly operation: string
  readonly workspaceScopeId: string
  readonly incarnation: string
  readonly recordJson: string
  readonly updatedAt: number
}

interface FinishTurnWrite {
  readonly runKey: string
  readonly sessionKey: string
  readonly state: 'ended' | 'error'
  readonly endedSeq: number
  readonly updatedAt: number
}

interface PendingTurnWrite {
  readonly execute: () => void
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
}

function isBusy(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /database is locked|SQLITE_BUSY/iu.test(message)
}

function conflict(message: string): Error {
  return Object.assign(new Error(message), { code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
}

function waitForRetry(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, TURN_BUSY_TIMEOUT_MS))
}

/** Bounded FIFO that defers Turn observation and yields between short SQLite lock attempts. */
export class AsyncSqliteTurnLedgerWriter {
  private readonly pending: PendingTurnWrite[] = []
  private running = false
  private scheduled = false
  private closePromise: Promise<void> | undefined
  private resolveClose: (() => void) | undefined
  private closed = false

  constructor(private readonly database: DatabaseSync) {}

  start(input: StartTurnWrite): Promise<void> {
    return this.enqueue(() => {
      this.database.prepare(`
        INSERT INTO agent_turn_ledger
          (run_key, session_key, operation, workspace_scope_id, incarnation, state, record_json, updated_at)
        VALUES (?, ?, ?, ?, ?, 'started', ?, ?)
        ON CONFLICT(run_key, session_key) DO NOTHING
      `).run(
        input.runKey,
        input.sessionKey,
        input.operation,
        input.workspaceScopeId,
        input.incarnation,
        input.recordJson,
        input.updatedAt,
      )
    })
  }

  finish(input: FinishTurnWrite): Promise<void> {
    return this.enqueue(() => {
      const row = this.database.prepare(`
        SELECT record_json FROM agent_turn_ledger WHERE run_key = ? AND session_key = ?
      `).get(input.runKey, input.sessionKey) as { record_json: string } | undefined
      if (!row) throw conflict('turn ledger record is missing')
      const record = JSON.parse(row.record_json) as Record<string, unknown>
      const next = { ...record, state: input.state, endedSeq: input.endedSeq, updatedAt: input.updatedAt }
      const changed = this.database.prepare(`
        UPDATE agent_turn_ledger SET state = ?, record_json = ?, updated_at = ?
        WHERE run_key = ? AND session_key = ? AND state = 'started'
      `).run(next.state, JSON.stringify(next), next.updatedAt, input.runKey, input.sessionKey)
      if (changed.changes !== 1) throw conflict('turn ledger transition lost its compare-and-swap race')
    })
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closed = true
    if (!this.running && this.pending.length === 0) return Promise.resolve()
    this.closePromise = new Promise<void>((resolve) => { this.resolveClose = resolve })
    return this.closePromise
  }

  private enqueue(execute: () => void): Promise<void> {
    if (this.closed) return Promise.reject(new Error('turn ledger writer is closed'))
    if (this.pending.length + Number(this.running) >= MAX_PENDING_TURN_WRITES) {
      return Promise.reject(new Error('turn ledger write buffer is full'))
    }
    const promise = new Promise<void>((resolve, reject) => {
      this.pending.push({ execute, resolve, reject })
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
      await this.executeWithRetry(next.execute)
      next.resolve()
    } catch (error) {
      next.reject(error)
    } finally {
      this.running = false
      if (this.pending.length > 0) this.schedule()
      else this.resolveClose?.()
    }
  }

  private async executeWithRetry(execute: () => void): Promise<void> {
    for (let attempt = 1; attempt <= TURN_BUSY_RETRY_ATTEMPTS; attempt += 1) {
      try {
        this.database.exec(`PRAGMA busy_timeout=${TURN_BUSY_TIMEOUT_MS};`)
        execute()
        return
      } catch (error) {
        if (!isBusy(error) || attempt === TURN_BUSY_RETRY_ATTEMPTS) throw error
      } finally {
        this.database.exec('PRAGMA busy_timeout=5000;')
      }
      await waitForRetry()
    }
  }
}
