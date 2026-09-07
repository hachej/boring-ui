import { parentPort, workerData } from 'node:worker_threads'
import { SqliteAgentRequestLedger } from '../../sqliteRequestLedger'
import type { AgentRequestKey, AgentRequestLedgerPrepareResult } from '../../types'

interface ClaimWorkerInput {
  dbPath: string
  key: AgentRequestKey
  digest: string
  barrier: SharedArrayBuffer
}

type ClaimWorkerMessage =
  | { claim: AgentRequestLedgerPrepareResult; effectStarted: boolean }
  | { error: { name: string; message: string; stack?: string } }

const input = workerData as ClaimWorkerInput
const sync = new Int32Array(input.barrier)
const ledger = new SqliteAgentRequestLedger(input.dbPath)
let message: ClaimWorkerMessage

try {
  Atomics.add(sync, 0, 1)
  Atomics.notify(sync, 0)
  Atomics.wait(sync, 1, 0)

  const claim = await ledger.prepare(input.key, input.digest)
  let effectStarted = false
  if (claim.ownership === 'reclaimed') {
    await ledger.acceptAdmission(input.key, 'parallel-admission')
    await ledger.beginEffect(input.key)
    effectStarted = true
  }
  message = { claim, effectStarted }
} catch (error) {
  message = {
    error: error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { name: 'Error', message: String(error) },
  }
} finally {
  ledger.close()
}

// Report only after closing the worker's connection, so the coordinator's
// replay check cannot race connection teardown or terminate a held lock.
parentPort?.postMessage(message)
